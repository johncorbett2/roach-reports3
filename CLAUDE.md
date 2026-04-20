# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This App Is

Roach Reports is a mobile app for NYC renters to report and look up cockroach sightings in apartment buildings. Users can search by address, view a map of nearby buildings, submit reports, and browse building history.

## Commands

### Backend
```bash
cd backend
npm run dev      # development with auto-reload (node --watch), port 4000
npm start        # production
```

### Frontend
```bash
cd frontend
npm start        # Expo dev server — scan QR with Expo Go, or press i/a for simulator
npm run ios      # iOS simulator directly
npm run android  # Android emulator directly
```

### Database
Schema lives in `database/schema.sql` — run it in the Supabase SQL Editor to create a fresh database. For existing databases, run `database/migrations/001_add_ingestion_fields.sql` instead.

### NYC Data Ingestion
```bash
node backend/scripts/ingest-nyc-data.js                    # last 3 years, both sources
node backend/scripts/ingest-nyc-data.js --since 2026-01-01 # incremental
node backend/scripts/ingest-nyc-data.js --source hpd       # HPD violations only
node backend/scripts/ingest-nyc-data.js --source 311       # 311 complaints only
node backend/scripts/ingest-nyc-data.js --dry-run          # preview without writing
node backend/scripts/ingest-nyc-data.js --skip-geocode     # skip reverse geocoding (faster for bulk loads)
```

### Building Data Migration
One-time (already run) script to merge duplicate buildings and fix city names:
```bash
node backend/scripts/fix-building-cities.js --dry-run      # preview both phases
node backend/scripts/fix-building-cities.js --phase a      # merge near-duplicates only
node backend/scripts/fix-building-cities.js --phase b      # fix 'New York' city labels only
```

There are no tests configured.

## Environment Variables

**Backend** (`backend/.env`):
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — Supabase project credentials
- `GOOGLE_MAPS_API_KEY` — used for geocoding, Places API, and Street View Static API
- `NYC_OPEN_DATA_TOKEN` — optional; raises SODA rate limit from ~32 to 1000 req/hr
- `PORT` — defaults to 4000

**Frontend** (`frontend/.env`):
- `EXPO_PUBLIC_API_URL` — backend URL (e.g. `http://localhost:4000`)
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` — for the map view
- `EXPO_PUBLIC_SENTRY_DSN` — Sentry DSN for error monitoring (get from sentry.io project settings)
- `EXPO_PUBLIC_POSTHOG_KEY` — PostHog API key for product analytics (get from posthog.com project settings)

## Architecture

### Stack
- **Frontend**: Expo (React Native) with Expo Router, TypeScript
- **Backend**: Node.js + Express 5, plain JS
- **Database**: Supabase (PostgreSQL), accessed via `@supabase/supabase-js` with the service role key
- **Maps/Geocoding**: Google Maps Geocoding API + Google Places API (proxied through the backend)
- **Error monitoring**: Sentry (`@sentry/react-native`) — initialized in `frontend/app/_layout.tsx`, root component wrapped with `Sentry.wrap()`
- **Product analytics**: PostHog (`posthog-react-native`) — `PostHogProvider` in `_layout.tsx`; events captured via `usePostHog()` hook in screens

### Data Flow
1. Address input → `AddressAutocomplete` component debounces and calls `/places/autocomplete` → backend proxies to Google Places → user selects → `/places/details` validates and returns lat/lng
2. Report submission → frontend calls `POST /reports` with address or building_id → backend creates building if needed (geocoding if no coords) → inserts report
3. Map view → frontend calls `GET /buildings/nearby?lat=&lng=&radius=` → backend converts radius (meters) to degree deltas → Supabase bounding box query (limit 300) → backend computes `marker_status` (`recent_roach`/`older_roach`/`no_roach`/`none`), `report_count`, `positive_count` per building → sorts by distance from viewport center → returns closest 150 buildings (no raw reports array in response)
4. Building detail → `GET /buildings/:id` → backend returns building + nested reports (including `source` and `report_date`) + images + calculated stats in one query; UI displays `report_date` for HPD/311 records, `created_at` for user submissions
5. Building street view → `GET /buildings/:id/street-view` → backend fetches from Google Street View Static API and proxies image bytes (API key stays server-side); displayed at top of Building Details screen

### Key Files
| File | Purpose |
|------|---------|
| `backend/index.js` | All Express routes and the `geocodeAddress()` helper |
| `frontend/services/api.ts` | Centralized API client (`buildingsApi`, `reportsApi`, `placesApi`) |
| `frontend/services/analytics.ts` | Sentry re-export and PostHog event name constants |
| `frontend/types/index.ts` | Shared TypeScript types for buildings, reports, images |
| `frontend/components/AddressAutocomplete.tsx` | Address input with Google Places validation and session token management |
| `database/schema.sql` | Canonical schema — source of truth for table structure |
| `backend/scripts/ingest-nyc-data.js` | Bulk/incremental import from NYC HPD and 311 SODA APIs |

### Analytics Events
Events are defined as constants in `frontend/services/analytics.ts` and captured via `usePostHog()`:
| Event | Where | Key properties |
|-------|-------|----------------|
| `onboarding_choice` | `onboarding.tsx` | `choice: 'search' \| 'submit'` |
| `building_searched` | `(tabs)/index.tsx` | `result_count` |
| `building_viewed` | `building/[id].tsx` | `building_id`, `report_count`, `has_recent_roaches` |
| `report_submitted` | `(tabs)/report.tsx` | `has_roaches`, `severity`, `has_images`, `has_notes` |

PostHog automatically tracks DAU, session length, and unique users from any event. % user-generated vs. imported records is best queried directly from Supabase: `SELECT source, COUNT(*) FROM reports GROUP BY source`.

### Database Schema
- **buildings**: `id`, `address`, `city`, `state`, `zip`, `latitude`, `longitude`, `bbl`, `bin`
- **reports**: `id`, `building_id`, `unit_number`, `has_roaches`, `severity` (1–5), `notes`, `source` (`user` | `hpd_violation` | `311_complaint`), `external_id`, `report_date`, `created_at`
- **report_images**: `id`, `report_id`, `image_url`

RLS is enabled on all tables with public read/insert (no auth layer).

### Building Deduplication
Three-layer matching when a report is submitted:
1. **BBL** (Borough-Block-Lot) — most reliable; used for HPD/311 imports
2. **Address string** — case-insensitive `ilike` match
3. **Coordinate proximity** — 50m bounding box fallback; used when a user submits via Google Places for a building that was ingested with a slightly different address (e.g. "New York" vs correct borough name). If a nearby building is found, the report attaches to it and the building's address/city fields are updated with the more accurate Google Places values.

A partial unique index on `(source, external_id) WHERE external_id IS NOT NULL` prevents duplicate ingestion runs.

**City names**: HPD/311 data hardcodes city as "New York" for all boroughs. The ingest script reverse-geocodes each new building's coordinates to get the correct locality (e.g. "Long Island City", "Brooklyn"). `fix-building-cities.js` Phase B was run to retroactively correct existing records.

### NYC Data Sources
The ingestion script pulls from two NYC Open Data SODA API datasets:
- **HPD violations** (`wvxf-dwi5`): filters `upper(novdescription) like '%ROACH%'`
- **311 complaints** (`erm2-nwe9`): filters `complaint_type='UNSANITARY CONDITION' AND descriptor='PESTS' AND descriptor_2='ROACHES'`
