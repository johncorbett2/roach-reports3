const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();

// Google Maps Geocoding function
async function geocodeAddress(address) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || apiKey === 'your-google-api-key') {
    console.warn('Google Maps API key not configured, skipping geocoding');
    return null;
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 'OK' && data.results.length > 0) {
      const location = data.results[0].geometry.location;
      return {
        latitude: location.lat,
        longitude: location.lng
      };
    } else {
      console.warn('Geocoding failed:', data.status, data.error_message || '');
      return null;
    }
  } catch (error) {
    console.error('Geocoding error:', error);
    return null;
  }
}

app.use(cors({ origin: ['http://localhost:19006', 'http://localhost:8081', '*'] }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Create Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Roach Reports API',
    availableRoutes: [
      'GET /buildings/search?q=',
      'GET /buildings/:id',
      'GET /buildings/nearby?lat=&lng=&radius=',
      'POST /buildings',
      'GET /reports',
      'POST /reports',
      'POST /reports/:id/images'
    ]
  });
});

// ===================
// BUILDINGS ENDPOINTS
// ===================

// Search buildings by address
app.get('/buildings/search', async (req, res) => {
  const { q } = req.query;

  if (!q || q.length < 2) {
    return res.status(400).json({ error: 'Search query must be at least 2 characters' });
  }

  const { data, error } = await supabase
    .from('buildings')
    .select(`
      *,
      reports (id, has_roaches, severity, created_at)
    `)
    .ilike('address', `%${q}%`)
    .limit(20);

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Get buildings nearby (within radius in meters)
// NOTE: This must come BEFORE /buildings/:id to avoid "nearby" being matched as an ID
app.get('/buildings/nearby', async (req, res) => {
  const { lat, lng, radius = 1000 } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }

  // Convert radius from meters to approximate degrees
  const latDelta = parseFloat(radius) / 111000;
  const lngDelta = parseFloat(radius) / (111000 * Math.cos(parseFloat(lat) * Math.PI / 180));

  const { data, error } = await supabase
    .from('buildings')
    .select(`
      *,
      reports (id, has_roaches, severity, created_at)
    `)
    .gte('latitude', parseFloat(lat) - latDelta)
    .lte('latitude', parseFloat(lat) + latDelta)
    .gte('longitude', parseFloat(lng) - lngDelta)
    .lte('longitude', parseFloat(lng) + lngDelta)
    .limit(100);

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Get building by ID with all reports
app.get('/buildings/:id', async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from('buildings')
    .select(`
      *,
      reports (
        id,
        unit_number,
        has_roaches,
        severity,
        notes,
        created_at,
        report_images (id, image_url)
      )
    `)
    .eq('id', id)
    .single();

  if (error) return res.status(404).json({ error: 'Building not found' });

  // Calculate stats
  const reports = data.reports || [];
  const totalReports = reports.length;
  const positiveReports = reports.filter(r => r.has_roaches).length;
  const avgSeverity = totalReports > 0
    ? reports.reduce((sum, r) => sum + (r.severity || 0), 0) / totalReports
    : 0;

  res.json({
    ...data,
    stats: {
      totalReports,
      positiveReports,
      percentPositive: totalReports > 0 ? Math.round((positiveReports / totalReports) * 100) : 0,
      avgSeverity: Math.round(avgSeverity * 10) / 10
    }
  });
});

// Create building (or return existing)
app.post('/buildings', async (req, res) => {
  const { address, city = 'New York', state = 'NY', zip, latitude, longitude } = req.body;

  if (!address) {
    return res.status(400).json({ error: 'address is required' });
  }

  // Check if building already exists
  const { data: existing } = await supabase
    .from('buildings')
    .select('*')
    .ilike('address', address)
    .limit(1);

  if (existing && existing.length > 0) {
    return res.json(existing[0]);
  }

  // Geocode address if coordinates not provided
  let finalLat = latitude;
  let finalLng = longitude;
  if (!finalLat || !finalLng) {
    const coords = await geocodeAddress(address);
    if (coords) {
      finalLat = coords.latitude;
      finalLng = coords.longitude;
    }
  }

  // Create new building
  const { data, error } = await supabase
    .from('buildings')
    .insert([{ address, city, state, zip, latitude: finalLat, longitude: finalLng }])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

// ===================
// REPORTS ENDPOINTS
// ===================

// Get all reports (paginated)
app.get('/reports', async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const { data, error, count } = await supabase
    .from('reports')
    .select(`
      *,
      buildings (id, address, city, state, zip),
      report_images (id, image_url)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + parseInt(limit) - 1);

  if (error) return res.status(400).json({ error: error.message });

  res.json({
    data,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: count,
      totalPages: Math.ceil(count / parseInt(limit))
    }
  });
});

// Create a new report
app.post('/reports', async (req, res) => {
  const { building_id, address, unit_number, has_roaches, severity, notes, latitude, longitude } = req.body;

  if (has_roaches === undefined) {
    return res.status(400).json({ error: 'has_roaches is required' });
  }

  let finalBuildingId = building_id;

  // If no building_id but address provided, create/find building
  if (!building_id && address) {
    const { data: existing } = await supabase
      .from('buildings')
      .select('id')
      .ilike('address', address)
      .limit(1);

    if (existing && existing.length > 0) {
      finalBuildingId = existing[0].id;
    } else {
      // Geocode address if coordinates not provided
      let finalLat = latitude;
      let finalLng = longitude;
      if (!finalLat || !finalLng) {
        const coords = await geocodeAddress(address);
        if (coords) {
          finalLat = coords.latitude;
          finalLng = coords.longitude;
        }
      }

      const { data: newBuilding, error: buildingError } = await supabase
        .from('buildings')
        .insert([{ address, latitude: finalLat, longitude: finalLng }])
        .select('id')
        .single();

      if (buildingError) {
        return res.status(400).json({ error: 'Failed to create building: ' + buildingError.message });
      }
      finalBuildingId = newBuilding.id;
    }
  }

  if (!finalBuildingId) {
    return res.status(400).json({ error: 'building_id or address is required' });
  }

  const { data, error } = await supabase
    .from('reports')
    .insert([{
      building_id: finalBuildingId,
      unit_number,
      has_roaches,
      severity: has_roaches ? severity : null,
      notes
    }])
    .select(`
      *,
      buildings (id, address, city, state, zip)
    `)
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

// Upload image to report
app.post('/reports/:id/images', async (req, res) => {
  const { id } = req.params;
  const { image_url } = req.body;

  if (!image_url) {
    return res.status(400).json({ error: 'image_url is required' });
  }

  // Verify report exists
  const { data: report, error: reportError } = await supabase
    .from('reports')
    .select('id')
    .eq('id', id)
    .single();

  if (reportError || !report) {
    return res.status(404).json({ error: 'Report not found' });
  }

  const { data, error } = await supabase
    .from('report_images')
    .insert([{ report_id: id, image_url }])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

// Debug endpoint
app.post('/_debug', (req, res) => {
  res.json({ headers: req.headers, body: req.body });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Roach Reports API running on http://localhost:${PORT}`);
});
