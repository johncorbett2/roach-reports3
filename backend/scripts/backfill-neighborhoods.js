#!/usr/bin/env node
// One-time script: seeds the neighborhoods reference table from the NTA 2020 GeoJSON,
// and tags existing buildings with neighborhood/borough based on their coordinates.
//
// Usage:
//   node backfill-neighborhoods.js            # run live against dev DB
//   node backfill-neighborhoods.js --dry-run  # preview without writing

require('dotenv').config({
  path: require('path').join(__dirname, process.env.NODE_ENV === 'development' ? '../.env.development' : '../.env'),
});
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { getNeighborhood } = require('../utils/neighborhoods');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const dryRun = process.argv.includes('--dry-run');
if (dryRun) console.log('[dry-run] No writes will be made.\n');

const SQ_FT_PER_SQ_MILE = 5280 * 5280;

// --- Phase A: seed neighborhoods reference table ---
async function seedNeighborhoodsTable() {
  console.log('Phase A: Seeding neighborhoods reference table...');

  const geojsonPath = path.join(__dirname, '../data/nyc_neighborhoods.geojson');
  const data = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));

  const rows = data.features.map(f => ({
    code: f.properties.nta2020,
    name: f.properties.ntaname,
    borough: f.properties.boroname,
    area_sq_miles: parseFloat(f.properties.shape_area) / SQ_FT_PER_SQ_MILE,
  }));

  console.log(`  ${rows.length} neighborhoods to upsert`);

  if (!dryRun) {
    const { error } = await supabase.from('neighborhoods').upsert(rows, { onConflict: 'code' });
    if (error) {
      console.error('  ERROR seeding neighborhoods:', error.message);
      process.exit(1);
    }
  }

  console.log(`  Done${dryRun ? ' (dry-run)' : ''}.`);
  return rows.length;
}

// --- Phase B: tag existing buildings ---
async function backfillBuildings() {
  console.log('\nPhase B: Tagging buildings without neighborhood data...');

  // Fetch all buildings with coordinates but no neighborhood, paginating past Supabase's 1000-row default cap
  const buildings = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('buildings')
      .select('id, address, latitude, longitude')
      .is('neighborhood', null)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .range(from, from + PAGE - 1);

    if (error) {
      console.error('  ERROR fetching buildings:', error.message);
      process.exit(1);
    }
    buildings.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  console.log(`  ${buildings.length} buildings to tag`);

  let tagged = 0;
  let skipped = 0;
  const BATCH = 200;

  for (let i = 0; i < buildings.length; i += BATCH) {
    const chunk = buildings.slice(i, i + BATCH);
    const updates = [];

    for (const b of chunk) {
      const result = getNeighborhood(parseFloat(b.latitude), parseFloat(b.longitude));
      if (result) {
        updates.push({ id: b.id, ...result });
        tagged++;
      } else {
        skipped++;
        console.log(`  WARN: no NTA match for ${b.address} (${b.latitude}, ${b.longitude})`);
      }
    }

    if (!dryRun && updates.length > 0) {
      // Use individual updates rather than upsert — upsert attempts an INSERT first
      // which trips the NOT NULL constraint on address for partial-column payloads.
      const results = await Promise.all(
        updates.map(u =>
          supabase.from('buildings')
            .update({ neighborhood: u.neighborhood, neighborhood_code: u.neighborhood_code, borough: u.borough })
            .eq('id', u.id)
        )
      );
      const firstErr = results.find(r => r.error);
      if (firstErr) {
        console.error('  ERROR updating buildings batch:', firstErr.error.message);
        process.exit(1);
      }
    }

    const pct = Math.round(((i + chunk.length) / buildings.length) * 100);
    process.stdout.write(`\r  Progress: ${i + chunk.length}/${buildings.length} (${pct}%)`);
  }

  console.log(`\n  Tagged: ${tagged} | Outside all NTAs: ${skipped} | ${dryRun ? '(dry-run, no writes)' : 'Done.'}`);
  return { tagged, skipped };
}

async function main() {
  const neighborhoodCount = await seedNeighborhoodsTable();
  const { tagged, skipped } = await backfillBuildings();

  console.log('\n=== Summary ===');
  console.log(`  Neighborhoods seeded: ${neighborhoodCount}`);
  console.log(`  Buildings tagged: ${tagged}`);
  console.log(`  Buildings outside all NTAs: ${skipped}`);
  if (skipped > 0) {
    const total = tagged + skipped;
    console.log(`  Tag rate: ${((tagged / total) * 100).toFixed(1)}%`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
