#!/usr/bin/env node
// One-time migration: merges near-duplicate buildings and corrects city names.
//
// Usage:
//   node fix-building-cities.js           # run both phases live
//   node fix-building-cities.js --dry-run # log intended changes only
//   node fix-building-cities.js --phase a # merge duplicates only
//   node fix-building-cities.js --phase b # fix city names only

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const phaseIdx = args.indexOf('--phase');
const phaseFilter = phaseIdx >= 0 ? args[phaseIdx + 1] : 'all';

const PROXIMITY_M = 50; // meters — buildings within this radius are considered duplicates

// --- Reverse geocode lat/lng → city name ---
async function getCityFromCoords(lat, lng) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== 'OK') return null;
    const components = data.results[0]?.address_components || [];
    const sublocality = components.find(c => c.types.includes('sublocality_level_1'))?.long_name;
    const locality = components.find(c => c.types.includes('locality'))?.long_name;
    return sublocality || locality || null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Extract the leading house number from an address string, including hyphenated
// forms (e.g. "11-21" from "11-21 47th Rd" or "2070" from "2070 Arthur Ave").
// Returns null if no number found.
function extractHouseNumber(address) {
  const match = address.match(/^(\d+(?:-\d+)?)\b/);
  return match ? match[1] : null;
}

// --- Phase A: Merge near-duplicate buildings ---
async function phaseA() {
  console.log('\n=== Phase A: Merging near-duplicate buildings ===');

  const { data: buildings, error } = await supabase
    .from('buildings')
    .select('id, address, city, zip, bbl, latitude, longitude, created_at')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .order('created_at', { ascending: true });

  if (error) { console.error('Failed to load buildings:', error.message); return; }

  console.log(`Loaded ${buildings.length} buildings with coordinates.`);

  const merged = new Set(); // IDs that have already been consumed as losers
  let mergeCount = 0;
  let skippedDifferentNumber = 0;

  for (const building of buildings) {
    if (merged.has(building.id)) continue;

    const latDelta = PROXIMITY_M / 111000;
    const lngDelta = PROXIMITY_M / (111000 * Math.cos(parseFloat(building.latitude) * Math.PI / 180));

    const { data: nearby } = await supabase
      .from('buildings')
      .select('id, address, city, zip, bbl, latitude, longitude, created_at')
      .gte('latitude', building.latitude - latDelta)
      .lte('latitude', building.latitude + latDelta)
      .gte('longitude', building.longitude - lngDelta)
      .lte('longitude', building.longitude + lngDelta)
      .neq('id', building.id);

    if (!nearby?.length) continue;

    for (const duplicate of nearby) {
      if (merged.has(duplicate.id)) continue;

      // Require matching house number — proximity alone is not enough in dense NYC.
      // "11-21 47th Rd" and "11-21 47 Road" → same building (house number "11-21" matches).
      // "2070 Arthur Ave" and "2078 Arthur Ave" → different buildings (2070 ≠ 2078).
      const numA = extractHouseNumber(building.address);
      const numB = extractHouseNumber(duplicate.address);
      if (!numA || !numB || numA !== numB) {
        skippedDifferentNumber++;
        continue;
      }

      // Winner = the one with BBL; tie-break = older created_at (current `building` is always older due to ORDER BY)
      const winner = building.bbl ? building : (duplicate.bbl ? duplicate : building);
      const loser = winner.id === building.id ? duplicate : building;

      // Prefer the non-"New York" city value for the winner's final record
      const betterCity = (winner.city !== 'New York') ? winner.city
        : (loser.city !== 'New York') ? loser.city
        : winner.city;
      const betterAddress = betterCity !== winner.city
        ? winner.address.replace(/, New York, NY/i, `, ${betterCity}, NY`)
        : winner.address;

      console.log(`\nMERGE: winner=${winner.id} (${winner.address}) ← loser=${loser.id} (${loser.address})`);
      console.log(`  city: "${winner.city}" → "${betterCity}"`);

      if (!dryRun) {
        // Move reports to winner
        const { error: rErr } = await supabase
          .from('reports')
          .update({ building_id: winner.id })
          .eq('building_id', loser.id);
        if (rErr) { console.error('  Failed to move reports:', rErr.message); continue; }

        // Update winner with better values
        await supabase
          .from('buildings')
          .update({ address: betterAddress, city: betterCity, zip: winner.zip || loser.zip })
          .eq('id', winner.id);

        // Delete loser
        const { error: dErr } = await supabase
          .from('buildings')
          .delete()
          .eq('id', loser.id);
        if (dErr) { console.error('  Failed to delete loser:', dErr.message); continue; }
      }

      merged.add(loser.id);
      mergeCount++;
    }
  }

  console.log(`\nPhase A complete. ${mergeCount} duplicate(s) merged, ${skippedDifferentNumber} nearby-but-different-number pairs skipped${dryRun ? ' (dry run)' : ''}.`);
}

// --- Phase B: Fix remaining 'New York' city labels via reverse geocoding ---
async function phaseB() {
  console.log('\n=== Phase B: Fixing city names via reverse geocoding ===');

  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.error('GOOGLE_MAPS_API_KEY not set — cannot reverse geocode. Skipping Phase B.');
    return;
  }

  const { data: buildings, error } = await supabase
    .from('buildings')
    .select('id, address, city, latitude, longitude')
    .eq('city', 'New York')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null);

  if (error) { console.error('Failed to load buildings:', error.message); return; }

  console.log(`Found ${buildings.length} buildings with city = 'New York' to check.`);

  let updatedCount = 0;

  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    const city = await getCityFromCoords(b.latitude, b.longitude);

    if (city && city !== 'New York') {
      const newAddress = b.address.replace(/, New York, NY/i, `, ${city}, NY`);
      console.log(`[${i + 1}/${buildings.length}] UPDATE ${b.id}: "${b.address}" → city="${city}"`);

      if (!dryRun) {
        const { error: uErr } = await supabase
          .from('buildings')
          .update({ city, address: newAddress })
          .eq('id', b.id);
        if (uErr) console.error('  Update failed:', uErr.message);
        else updatedCount++;
      } else {
        updatedCount++;
      }
    } else {
      process.stdout.write('.');
    }

    // Rate-limit: ~10 req/sec
    await sleep(100);
  }

  console.log(`\n\nPhase B complete. ${updatedCount} building(s) updated${dryRun ? ' (dry run)' : ''}.`);
}

async function main() {
  console.log(`fix-building-cities.js${dryRun ? ' [DRY RUN]' : ''}`);

  if (phaseFilter === 'all' || phaseFilter === 'a') await phaseA();
  if (phaseFilter === 'all' || phaseFilter === 'b') await phaseB();

  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
