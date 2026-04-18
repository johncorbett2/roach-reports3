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

async function fetchPage(dataset, whereClause, orderField, offset) {
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

function buildAddress(houseNum, streetName, zip) {
  const h = (houseNum || '').trim();
  const s = (streetName || '').trim();
  if (!h || !s) return null;
  const addr = `${h} ${titleCase(s)}`;
  return zip ? `${addr}, New York, NY ${zip}` : `${addr}, New York, NY`;
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

  const { data: newBuilding, error } = await supabase
    .from('buildings')
    .insert([{
      address,
      city: 'New York',
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
  // viol_desc contains strings like "INFESTATION OF ROACHES IN ENTIRE APARTMENT"
  const where = `upper(viol_desc) like '%ROACH%' AND insp_dt >= '${sinceStr}T00:00:00'`;

  let offset = 0;
  let totalFetched = 0;

  while (true) {
    let records;
    try {
      records = await fetchPage(HPD_DATASET, where, 'insp_dt', offset);
    } catch (err) {
      console.error(`\nHPD fetch error at offset ${offset}:`, err.message);
      break;
    }

    if (records.length === 0) break;
    totalFetched += records.length;
    process.stdout.write(`\r  Fetched ${totalFetched} records, inserted ${stats.reportsInserted}, skipped ${stats.reportsSkipped}...`);

    for (const r of records) {
      const houseNum = r.house_number || r.housenumber || r.apt_street_no;
      const streetName = r.street_name || r.streetname;
      const zip = r.zip_code || r.zip;
      const address = buildAddress(houseNum, streetName, zip);
      if (!address) { stats.errors++; continue; }

      const buildingId = await findOrCreateBuilding({
        address,
        bbl: r.bbl || null,
        bin: r.bin || null,
        latitude: r.latitude,
        longitude: r.longitude,
        zip,
      });
      if (!buildingId) continue;

      await upsertReport(
        buildingId,
        'hpd_violation',
        r.violationid,
        r.insp_dt || r.viol_appr_dt || null
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
  console.log('\n--- NYC 311 Residential Pest Complaints ---');
  // descriptor for roaches is typically "Roaches" or "ROACHES"
  const where = `complaint_type='Residential Pest Complaint' AND upper(descriptor) like '%ROACH%' AND created_date >= '${sinceStr}T00:00:00'`;

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
      const houseNum = r.house_number || r.housenumber;
      const streetName = r.street_name || r.streetname || r.cross_street_1;
      const zip = r.incident_zip;
      const address = buildAddress(houseNum, streetName, zip);
      if (!address) { stats.errors++; continue; }

      const buildingId = await findOrCreateBuilding({
        address,
        bbl: null,
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
