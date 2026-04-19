#!/usr/bin/env node
// Ingests cockroach complaint data from NYC HPD violations and 311 service requests.
//
// Usage:
//   node ingest-nyc-data.js                          # last 3 years, both sources
//   node ingest-nyc-data.js --since 2026-01-01       # incremental update
//   node ingest-nyc-data.js --source hpd             # HPD only
//   node ingest-nyc-data.js --source 311             # 311 only
//   node ingest-nyc-data.js --dry-run                # preview without writing
//
// Requires .env with: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional .env:      NYC_OPEN_DATA_TOKEN (raises SODA rate limit to 1000 req/hr)

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');

const SODA_BASE = 'https://data.cityofnewyork.us/resource';
const HPD_DATASET = 'wvxf-dwi5';
const NYC_311_DATASET = 'erm2-nwe9';
const PAGE_SIZE = 1000;
const PAGE_DELAY_MS = 100; // be polite to the SODA API

// --- CLI args ---
const args = process.argv.slice(2);
const sinceIdx = args.indexOf('--since');
const sinceArg = sinceIdx >= 0 ? args[sinceIdx + 1] : null;
const sourceIdx = args.indexOf('--source');
const sourceFilter = sourceIdx >= 0 ? args[sourceIdx + 1] : 'all';
const dryRun = args.includes('--dry-run');
const skipGeocode = args.includes('--skip-geocode');

const defaultSinceDate = new Date();
defaultSinceDate.setFullYear(defaultSinceDate.getFullYear() - 3);
const since = sinceArg ? new Date(sinceArg) : defaultSinceDate;
const sinceStr = since.toISOString().split('T')[0];

if (!['all', 'hpd', '311'].includes(sourceFilter)) {
  console.error('--source must be one of: hpd, 311, all');
  process.exit(1);
}

// --- Supabase ---
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --- SODA API ---
const sodaHeaders = { 'Accept': 'application/json' };
if (process.env.NYC_OPEN_DATA_TOKEN) {
  sodaHeaders['X-App-Token'] = process.env.NYC_OPEN_DATA_TOKEN;
}

async function fetchPage(dataset, whereClause, orderField, offset, attempt = 1) {
  const params = new URLSearchParams({
    '$where': whereClause,
    '$order': `${orderField} DESC`,
    '$limit': String(PAGE_SIZE),
    '$offset': String(offset),
  });
  const url = `${SODA_BASE}/${dataset}.json?${params}`;
  const res = await fetch(url, { headers: sodaHeaders });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 503 && attempt <= 5) {
      const delay = attempt * 10000; // 10s, 20s, 30s, 40s, 50s
      process.stdout.write(`\n  SODA 503, retrying in ${delay / 1000}s (attempt ${attempt}/5)...`);
      await new Promise(r => setTimeout(r, delay));
      return fetchPage(dataset, whereClause, orderField, offset, attempt + 1);
    }
    throw new Error(`SODA ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// --- Address helpers ---
function titleCase(str) {
  return str
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function buildAddress(houseNum, streetName, zip, city = 'New York') {
  const h = (houseNum || '').trim();
  const s = (streetName || '').trim();
  if (!h || !s) return null;
  const addr = `${h} ${titleCase(s)}`;
  return zip ? `${addr}, ${city}, NY ${zip}` : `${addr}, ${city}, NY`;
}

async function getCityFromCoords(lat, lng) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || skipGeocode) return 'New York';
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== 'OK') return 'New York';
    const components = data.results[0]?.address_components || [];
    // Prefer sublocality (Long Island City, Astoria, etc.) over locality (Queens, New York)
    const sublocality = components.find(c => c.types.includes('sublocality_level_1'))?.long_name;
    const locality = components.find(c => c.types.includes('locality'))?.long_name;
    return sublocality || locality || 'New York';
  } catch {
    return 'New York';
  }
}

// --- Stats ---
const stats = {
  buildingsCreated: 0,
  buildingsFound: 0,
  reportsInserted: 0,
  reportsSkipped: 0,
  errors: 0,
};

// --- DB helpers ---
async function findOrCreateBuilding({ address, bbl, bin, latitude, longitude, zip }) {
  // Prefer BBL match — most reliable deduplication for NYC buildings
  if (bbl) {
    const { data } = await supabase
      .from('buildings')
      .select('id, bbl, bin')
      .eq('bbl', bbl)
      .limit(1);
    if (data?.length > 0) {
      // Backfill BIN if missing
      if (bin && !data[0].bin) {
        await supabase.from('buildings').update({ bin }).eq('id', data[0].id);
      }
      stats.buildingsFound++;
      return data[0].id;
    }
  }

  // Fall back to address string match
  const { data: byAddr } = await supabase
    .from('buildings')
    .select('id, bbl, bin')
    .ilike('address', address)
    .limit(1);
  if (byAddr?.length > 0) {
    if ((bbl && !byAddr[0].bbl) || (bin && !byAddr[0].bin)) {
      await supabase.from('buildings').update({
        bbl: bbl || byAddr[0].bbl,
        bin: bin || byAddr[0].bin,
      }).eq('id', byAddr[0].id);
    }
    stats.buildingsFound++;
    return byAddr[0].id;
  }

  if (dryRun) {
    stats.buildingsCreated++;
    return 'dry-run-building-id';
  }

  const city = (latitude && longitude) ? await getCityFromCoords(latitude, longitude) : 'New York';
  // If geocoding returned a different city, fix it in the address string too
  const storedAddress = city !== 'New York'
    ? address.replace(/, New York, NY/i, `, ${city}, NY`)
    : address;

  const { data: newBuilding, error } = await supabase
    .from('buildings')
    .insert([{
      address: storedAddress,
      city,
      state: 'NY',
      zip: zip || null,
      latitude: latitude ? parseFloat(latitude) : null,
      longitude: longitude ? parseFloat(longitude) : null,
      bbl: bbl || null,
      bin: bin || null,
    }])
    .select('id')
    .single();

  if (error) {
    stats.errors++;
    console.error(`\nBuilding insert error: ${error.message} | ${address}`);
    return null;
  }

  stats.buildingsCreated++;
  return newBuilding.id;
}

async function upsertReport(buildingId, source, externalId, reportDate) {
  if (dryRun) {
    stats.reportsInserted++;
    return;
  }

  const { error } = await supabase.from('reports').insert([{
    building_id: buildingId,
    has_roaches: true,
    source,
    external_id: externalId ? String(externalId) : null,
    report_date: reportDate || null,
  }]);

  if (error) {
    if (error.code === '23505') { // unique_violation — already imported
      stats.reportsSkipped++;
    } else {
      stats.errors++;
      console.error(`\nReport insert error: ${error.message}`);
    }
  } else {
    stats.reportsInserted++;
  }
}

// --- HPD violations ---
async function ingestHPD() {
  console.log('\n--- HPD Housing Maintenance Code Violations ---');
  // novdescription contains strings like "ABATE THE NUISANCE CONSISTING OF ROACHES IN THE ENTIRE APARTMENT"
  const where = `upper(novdescription) like '%ROACH%' AND inspectiondate >= '${sinceStr}T00:00:00'`;

  let offset = 0;
  let totalFetched = 0;

  while (true) {
    let records;
    try {
      records = await fetchPage(HPD_DATASET, where, 'inspectiondate', offset);
    } catch (err) {
      console.error(`\nHPD fetch error at offset ${offset}:`, err.message);
      break;
    }

    if (records.length === 0) break;
    totalFetched += records.length;
    process.stdout.write(`\r  Fetched ${totalFetched} records, inserted ${stats.reportsInserted}, skipped ${stats.reportsSkipped}...`);

    for (const r of records) {
      const address = buildAddress(r.housenumber, r.streetname, r.zip);
      if (!address) { stats.errors++; continue; }

      const buildingId = await findOrCreateBuilding({
        address,
        bbl: r.bbl || null,
        bin: r.bin || null,
        latitude: r.latitude,
        longitude: r.longitude,
        zip: r.zip,
      });
      if (!buildingId) continue;

      await upsertReport(
        buildingId,
        'hpd_violation',
        r.violationid,
        r.inspectiondate || r.approveddate || null
      );
    }

    if (records.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    await new Promise(resolve => setTimeout(resolve, PAGE_DELAY_MS));
  }

  process.stdout.write('\n');
  console.log(`  HPD done: ${totalFetched} records fetched`);
}

// --- 311 service requests ---
async function ingest311() {
  console.log('\n--- NYC 311 UNSANITARY CONDITION / ROACHES Complaints ---');
  // HPD-routed 311 complaints: complaint_type=UNSANITARY CONDITION, descriptor=PESTS, descriptor_2=ROACHES
  const where = `complaint_type='UNSANITARY CONDITION' AND descriptor='PESTS' AND descriptor_2='ROACHES' AND created_date >= '${sinceStr}T00:00:00'`;

  let offset = 0;
  let totalFetched = 0;

  while (true) {
    let records;
    try {
      records = await fetchPage(NYC_311_DATASET, where, 'created_date', offset);
    } catch (err) {
      console.error(`\n311 fetch error at offset ${offset}:`, err.message);
      break;
    }

    if (records.length === 0) break;
    totalFetched += records.length;
    process.stdout.write(`\r  Fetched ${totalFetched} records, inserted ${stats.reportsInserted}, skipped ${stats.reportsSkipped}...`);

    for (const r of records) {
      // incident_address is a full "HOUSENUMBER STREETNAME" string; street_name is street only
      const zip = r.incident_zip;
      const address = r.incident_address
        ? `${titleCase(r.incident_address)}, New York, NY${zip ? ' ' + zip : ''}`
        : null;
      if (!address) { stats.errors++; continue; }

      const buildingId = await findOrCreateBuilding({
        address,
        bbl: r.bbl || null,
        bin: null,
        latitude: r.latitude,
        longitude: r.longitude,
        zip,
      });
      if (!buildingId) continue;

      await upsertReport(
        buildingId,
        '311_complaint',
        r.unique_key,
        r.created_date || null
      );
    }

    if (records.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    await new Promise(resolve => setTimeout(resolve, PAGE_DELAY_MS));
  }

  process.stdout.write('\n');
  console.log(`  311 done: ${totalFetched} records fetched`);
}

// --- Main ---
async function main() {
  console.log('Roach Reports — NYC Data Ingestion');
  console.log(`  Since:   ${sinceStr}`);
  console.log(`  Sources: ${sourceFilter}`);
  if (dryRun) console.log('  Mode:    DRY RUN (no database writes)');

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }
  if (!process.env.NYC_OPEN_DATA_TOKEN) {
    console.warn('  Warning: NYC_OPEN_DATA_TOKEN not set — SODA rate limits will be stricter');
  }

  if (sourceFilter === 'all' || sourceFilter === 'hpd') await ingestHPD();
  if (sourceFilter === 'all' || sourceFilter === '311') await ingest311();

  console.log('\n=== Summary ===');
  console.log(`  Buildings created:        ${stats.buildingsCreated}`);
  console.log(`  Buildings found existing: ${stats.buildingsFound}`);
  console.log(`  Reports inserted:         ${stats.reportsInserted}`);
  console.log(`  Reports skipped (dups):   ${stats.reportsSkipped}`);
  console.log(`  Errors:                   ${stats.errors}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
