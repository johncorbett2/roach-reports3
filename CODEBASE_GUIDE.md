# Roach Reports — Codebase Guide

A plain-English walkthrough of the project structure and key files, written for someone familiar with software products but not necessarily with writing code.

---

## Part 1 — Folder & File Structure

```
roach-reports3/
├── backend/
│   ├── index.js                   ← the entire server (one file)
│   ├── scripts/
│   │   ├── ingest-nyc-data.js     ← bulk importer for HPD & 311 data
│   │   └── fix-building-cities.js ← one-time data cleanup script
│   └── package.json               ← backend dependencies list
│
├── frontend/
│   ├── app/                       ← every screen lives here
│   │   ├── _layout.tsx            ← app-wide "wrapper" (runs on every screen)
│   │   ├── (tabs)/                ← the three tab screens
│   │   │   ├── _layout.tsx        ← tab bar config (icons, colors)
│   │   │   ├── index.tsx          ← Search tab
│   │   │   ├── map.tsx            ← Map tab
│   │   │   └── report.tsx         ← Submit Report tab
│   │   ├── building/
│   │   │   └── [id].tsx           ← Building Detail screen
│   │   ├── onboarding.tsx         ← first-launch welcome screen
│   │   └── splash.tsx             ← roach animation on launch
│   ├── components/                ← reusable UI building blocks
│   │   ├── AddressAutocomplete.tsx
│   │   ├── SplashOverlay.tsx
│   │   └── Themed.tsx             ← app-wide Text/View with color theming
│   ├── services/
│   │   ├── api.ts                 ← all calls to the backend
│   │   └── analytics.ts           ← PostHog event name constants
│   ├── types/
│   │   └── index.ts               ← shared data shape definitions
│   └── constants/
│       └── Colors.ts              ← palette (creams, browns)
│
└── database/
    └── schema.sql                 ← table definitions for Supabase
```

**Why it's split this way:**

- **Backend vs. Frontend** are completely separate processes. The backend runs on a server (or your laptop on port 4000); the frontend runs on a phone. They communicate only over HTTP. This means each can be updated independently.
- **The `app/` folder uses "file-based routing"** — the framework (Expo Router) turns the folder structure directly into navigation. `app/(tabs)/index.tsx` becomes the Search tab, `app/building/[id].tsx` becomes any building's detail page, etc. You don't write any navigation wiring by hand; the file location *is* the route.
- **`components/`** holds things that appear in multiple places. `AddressAutocomplete` is a good example — the exact same component is used on the Search tab, the Report tab, and the Map tab.
- **`services/`** centralizes all communication with the backend. Rather than scattering `fetch()` calls throughout every screen, one file (`api.ts`) owns all of them. If the backend URL or data format ever changes, there's only one place to fix it.
- **`types/`** is a contract document. It defines the shape of data objects like `Building` and `Report` in one place, so every file in the app agrees on what fields exist.

---

## Part 2 — Key Files Explained

---

### `backend/index.js` — The Server

This is the entire backend in one file (~540 lines). It uses a framework called **Express**, which lets you declare "if someone asks for this URL, run this code and send back this data."

The file can be read in four sections:

**1. Setup**
```js
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
```
Right at the top, the server connects to Supabase (the database). `process.env` reads from the `.env` file — that's where the secret keys live so they're never checked into Git.

**2. The Places proxy endpoints**
```js
app.get('/places/autocomplete', async (req, res) => {
  const { input, sessiontoken } = req.query;
  // ...calls Google's API with our secret key...
  res.json({ predictions });
});
```
When a user types in an address field, the app doesn't call Google directly. Instead it asks *our* backend, which forwards the request to Google using the API key. This matters because the Google API key is a secret that shouldn't be embedded in the phone app (anyone could extract it). The backend acts as a secure middleman.

**3. The buildings endpoints — the most important ones**

The `GET /buildings/nearby` endpoint is what powers the map:

```js
app.get('/buildings/nearby', async (req, res) => {
  // Convert a radius (meters) into degrees of latitude/longitude
  const latDelta = parseFloat(radius) / 111000;
  const lngDelta = parseFloat(radius) / (111000 * Math.cos(...));

  // Fetch all buildings in that box from the database
  const { data } = await supabase.from('buildings')
    .select('*, reports (has_roaches, report_date, created_at)')
    .gte('latitude', lat - latDelta)
    .lte('latitude', lat + latDelta)
    // ...
    .limit(300);

  // For each building, calculate its "marker status"
  const processed = data.map(b => {
    const hasRecentRoach = reports.some(r =>
      r.has_roaches && new Date(r.report_date) > sixMonthsAgo
    );
    return {
      marker_status: hasRecentRoach ? 'recent_roach' : hasAnyRoach ? 'older_roach' : 'no_roach',
      report_count: reports.length,
      positive_count: reports.filter(r => r.has_roaches).length,
    };
  })
  .sort(/* by distance from map center */)
  .slice(0, 150); // cap at 150 markers

  res.json(processed);
});
```
In plain terms: the map sends its current center coordinates and zoom level, the server draws a bounding box around that area, pulls all buildings inside it from the database (up to 300), computes whether each building has recent/older/no roach reports in the last 6 months, sorts them by proximity, then sends back the closest 150. That's what gets turned into map markers.

**4. The report submission endpoint — the most complex piece of logic**

```js
app.post('/reports', async (req, res) => {
  // Step 1: Do we already have this building in our database?
  const { data: existing } = await supabase.from('buildings')
    .select('id').ilike('address', address).limit(1);

  // Step 2: If not, is there one within 50 meters (coordinates)?
  if (!existing?.length && latitude && longitude) {
    const { data: nearby } = await supabase.from('buildings')
      .select('id')
      .gte('latitude', latitude - latDelta)
      .lte('latitude', latitude + latDelta)
      // ...
  }

  // Step 3: Still nothing? Create a brand new building record.
  if (!finalBuildingId) {
    await supabase.from('buildings').insert([{ address, latitude, ... }]);
  }

  // Finally: save the report linked to that building
  await supabase.from('reports').insert([{ building_id, has_roaches, severity, notes }]);
});
```
The three-step logic exists because the same real building can appear under slightly different names in the database — maybe one entry came from a 311 complaint ("123 Main St") and the user typed "123 Main Street". The address match catches obvious duplicates; the coordinate check catches subtle ones. Without this, the same building would accumulate duplicate records and its report history would be fragmented.

---

### `frontend/app/_layout.tsx` — The App Wrapper

This file runs on every single screen. Think of it as the outer shell that everything lives inside. Its three jobs:

**1. Sentry** (error monitoring) — wraps the entire app so any crash anywhere gets captured and sent to the Sentry dashboard.
```tsx
export default Sentry.wrap(RootLayout);
```

**2. PostHog** (analytics) — wraps the navigation layer so user activity can be tracked.
```tsx
<PostHogProvider apiKey={process.env.EXPO_PUBLIC_POSTHOG_KEY}>
  <NavigationTracker />  {/* sends a "screen view" event on every navigation */}
```

**3. First-launch routing** — checks `AsyncStorage` (the phone's local storage) for a flag called `onboarding_complete`. If it's not there, it redirects the user to onboarding before showing the main app. Once they complete onboarding, the flag is written and they never see it again.
```tsx
const value = await AsyncStorage.getItem(ONBOARDING_KEY);
if (!value) router.replace('/onboarding');
```

---

### `frontend/services/api.ts` — The API Client

This is the phone app's single point of contact with the backend. It exports three "namespaced" objects — `buildingsApi`, `reportsApi`, and `placesApi` — each with methods that correspond to backend endpoints:

```ts
export const buildingsApi = {
  getNearby: (lat, lng, radius) =>
    request(`/buildings/nearby?lat=${lat}&lng=${lng}&radius=${radius}`),

  getById: (id) =>
    request(`/buildings/${id}`),

  search: (query) =>
    request(`/buildings/search?q=${encodeURIComponent(query)}`),
};
```

The `request()` helper at the top handles the repetitive parts: prepending the base URL, setting `Content-Type: application/json`, checking whether the response was successful, and throwing a readable error if not. Every screen imports from this file rather than making raw `fetch()` calls, which means all network logic is in one place.

---

### `frontend/types/index.ts` — The Data Contracts

This file has no logic — it just defines the shape of objects that travel between the backend and the app. For example:

```ts
export interface Building {
  id: string;
  address: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  marker_status?: 'recent_roach' | 'older_roach' | 'no_roach' | 'none';
  report_count?: number;
}
```

The `?` means "optional" — `marker_status` and `report_count` only exist when the data came from the nearby endpoint (the map), not when it came from the building detail endpoint. TypeScript uses this file to catch mistakes at development time: if you try to access `building.roach_count` and the contract says the field is called `report_count`, it flags it before the code ever runs.

---

### `frontend/components/AddressAutocomplete.tsx` — The Address Input

This is the most behaviorally rich component in the app. It manages the entire "type → see suggestions → tap → validated" flow:

```tsx
const handleTextChange = (text: string) => {
  onChangeText(text);          // update the text box
  onAddressValidated(null);    // tell the parent "no valid address yet"

  // Wait 500ms after the user stops typing, then fetch suggestions
  debounceRef.current = setTimeout(() => {
    fetchPredictions(text);
  }, 500);
};
```

The **debounce** (the 500ms delay) is important — without it, every single keystroke would fire a Google API call, which is slow and expensive. Instead it waits until the user pauses typing.

```tsx
const handleSelectPrediction = async (prediction) => {
  Keyboard.dismiss();           // hide the keyboard
  onChangeText(prediction.description);

  // Now fetch the precise lat/lng for this place
  const details = await placesApi.getDetails(prediction.place_id, sessionToken);
  onAddressValidated(details);  // tell the parent "we have a real, validated address"

  sessionTokenRef.current = generateSessionToken(); // reset for next search
};
```

The **session token** is a Google billing optimization — Google charges less when all the keystrokes for one search (autocomplete calls) plus the final detail lookup are grouped under the same token. A new token is generated after each completed selection so the next search is billed as its own session.

The component doesn't know or care whether it's on the Search tab, the Map tab, or the Report tab — it just calls two callbacks (`onChangeText` and `onAddressValidated`) and lets the parent screen decide what to do with the results.

---

### `frontend/app/(tabs)/map.tsx` — The Map Screen

The map screen has two interesting technical patterns worth understanding:

**The cache check:**
```tsx
function isWithinCache(region, cache) {
  // Calculate how much of the current view overlaps with the last fetched area
  const overlapArea = ...;
  const viewportArea = region.latitudeDelta * region.longitudeDelta;
  return overlapArea / viewportArea > 0.70;
}
```
Every time the user pans, the app *could* call the backend again — but that would be wasteful if they're still mostly looking at an area we already loaded. This function calculates whether 70% or more of the current view is already covered by the last fetch. If yes, it skips the network call. The "Search this area" button appears when the user has moved enough that a fresh fetch is warranted.

**The programmatic navigation guard:**
```tsx
const isProgrammaticNavigationRef = useRef(false);

// When searching an address:
isProgrammaticNavigationRef.current = true;
mapRef.current?.animateToRegion(newRegion, 500); // move the map programmatically

// When the map finishes moving:
const handleRegionChangeComplete = (newRegion) => {
  if (!isProgrammaticNavigationRef.current) {
    setHasMoved(true);  // only show "Search this area" for USER-initiated panning
  }
  isProgrammaticNavigationRef.current = false;
};
```
When the app moves the map on the user's behalf (e.g., after they search an address), `onRegionChangeComplete` still fires — because the map did change. The flag prevents that automatic movement from being treated as "the user panned, show them the Search this area button." Without this, searching an address would immediately show "Search this area" even though the content is already fresh.

---

### `frontend/app/building/[id].tsx` — Building Detail Screen

The `[id]` in the filename is the routing mechanism — when you navigate to `/building/abc123`, Expo extracts `abc123` and makes it available inside the file:

```tsx
const { id } = useLocalSearchParams<{ id: string }>();
```

This screen fetches the full building record (address, all reports, images, calculated stats) and renders them. One interesting piece is the image lightbox — when you tap a photo, it opens full-screen with a swipe-to-dismiss gesture:

```tsx
PanResponder.create({
  onPanResponderRelease: (_, { dy, vy }) => {
    if (dy > 120 || vy > 1.2) {
      // User dragged far enough or fast enough — animate it off screen
      Animated.timing(translateY, { toValue: 600, duration: 200 }).start(
        () => setSelectedImage(null)
      );
    } else {
      // Not enough — snap back
      Animated.spring(translateY, { toValue: 0 }).start();
    }
  },
})
```
`dy` is how many pixels the user dragged downward; `vy` is the velocity of the swipe. Either a big drag or a fast flick closes the image, which matches the feel of native iOS photo viewers.

---

### `frontend/services/analytics.ts` — Analytics Event Names

This is intentionally tiny:

```ts
export const Events = {
  ONBOARDING_CHOICE: 'onboarding_choice',
  BUILDING_SEARCHED: 'building_searched',
  BUILDING_VIEWED:   'building_viewed',
  REPORT_SUBMITTED:  'report_submitted',
} as const;
```

Rather than typing the string `'building_viewed'` in multiple places (and risking a typo that would silently create a second, broken event in PostHog), all event names are defined here as constants. Any screen that fires analytics imports from this file. If you ever rename an event, you change it in one place and it updates everywhere.

---

### `backend/scripts/ingest-nyc-data.js` — The Data Importer

This is not part of the running app — it's a command-line tool you run manually (or on a schedule) to pull roach-related records from NYC's public Open Data portal into Supabase. It pulls from two city datasets:

- **HPD violations** — housing code violations where the description mentions "ROACH"
- **311 complaints** — service requests filed under "Unsanitary Condition → Pests → Roaches"

The script deduplicates buildings using BBL (Borough-Block-Lot, the city's unique property identifier) before falling back to address matching. If you ran it twice, you'd get the same database — not double the records — because a partial unique index on `(source, external_id)` in the database prevents duplicates at the database level as a final safety net.

---

## The Big Picture — How It All Connects

Here's how all the pieces connect for the most common user flow — searching an address:

1. User types on the **Search tab** → `AddressAutocomplete` debounces keystrokes → calls `placesApi.autocomplete` → `api.ts` sends `GET /places/autocomplete` to the backend → backend proxies to Google → suggestions appear.
2. User taps a suggestion → `AddressAutocomplete` calls `placesApi.getDetails` → backend proxies to Google → lat/lng returned → `onAddressValidated` fires with the full address object.
3. User taps the Search button → `index.tsx` calls `buildingsApi.search` → `api.ts` sends `GET /buildings/search?q=...` → backend queries Supabase for buildings with a matching address → list of results returned.
4. User taps a building → `expo-router` navigates to `/building/[id]` → `building/[id].tsx` calls `buildingsApi.getById` → backend fetches the full record including all reports and images from Supabase → detail screen renders.
