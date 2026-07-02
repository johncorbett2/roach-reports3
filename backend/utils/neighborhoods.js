const path = require('path');
const fs = require('fs');
const booleanPointInPolygon = require('@turf/boolean-point-in-polygon').default;

let neighborhoodFeatures = null;

function loadFeatures() {
  if (neighborhoodFeatures) return neighborhoodFeatures;
  const geojsonPath = path.join(__dirname, '../data/nyc_neighborhoods.geojson');
  const data = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
  neighborhoodFeatures = data.features;
  return neighborhoodFeatures;
}

// Returns { neighborhood, neighborhood_code, borough } or null if point is outside all NTAs.
function getNeighborhood(lat, lng) {
  if (lat == null || lng == null) return null;
  const features = loadFeatures();
  const point = { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] } };
  for (const feature of features) {
    if (booleanPointInPolygon(point, feature)) {
      const p = feature.properties;
      return {
        neighborhood: p.ntaname,
        neighborhood_code: p.nta2020,
        borough: p.boroname,
      };
    }
  }
  return null;
}

module.exports = { getNeighborhood };
