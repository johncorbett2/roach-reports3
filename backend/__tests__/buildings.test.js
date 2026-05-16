const { mockSupabase, mockQueryBuilder, queueResponse, resetMocks } = require('./helpers/mockSupabase');

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => require('./helpers/mockSupabase').mockSupabase,
}));

const request = require('supertest');
const app = require('../app');

beforeEach(() => resetMocks());

// ===========================================
// GET /buildings/nearby — marker_status logic
// ===========================================

describe('GET /buildings/nearby', () => {
  test('returns 400 when lat is missing', async () => {
    const res = await request(app).get('/buildings/nearby?lng=-74.006');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lat and lng are required/i);
  });

  test('returns 400 when lng is missing', async () => {
    const res = await request(app).get('/buildings/nearby?lat=40.7128');
    expect(res.status).toBe(400);
  });

  test('returns recent_roach for a building with a roach report within 6 months', async () => {
    const recentDate = new Date().toISOString();
    queueResponse({
      data: [{
        id: 'b1', address: '1 Main St', city: 'Brooklyn', state: 'NY',
        latitude: 40.7128, longitude: -74.006,
        reports: [{ has_roaches: true, report_date: recentDate, created_at: recentDate }],
      }],
      error: null,
    });

    const res = await request(app).get('/buildings/nearby?lat=40.7128&lng=-74.006');
    expect(res.status).toBe(200);
    expect(res.body[0].marker_status).toBe('recent_roach');
  });

  test('returns older_roach for a building with a roach report older than 6 months', async () => {
    const oldDate = new Date('2020-01-01').toISOString();
    queueResponse({
      data: [{
        id: 'b1', address: '1 Main St', city: 'Brooklyn', state: 'NY',
        latitude: 40.7128, longitude: -74.006,
        reports: [{ has_roaches: true, report_date: oldDate, created_at: oldDate }],
      }],
      error: null,
    });

    const res = await request(app).get('/buildings/nearby?lat=40.7128&lng=-74.006');
    expect(res.status).toBe(200);
    expect(res.body[0].marker_status).toBe('older_roach');
  });

  test('returns no_roach for a building with reports but none positive', async () => {
    const recentDate = new Date().toISOString();
    queueResponse({
      data: [{
        id: 'b1', address: '1 Main St', city: 'Brooklyn', state: 'NY',
        latitude: 40.7128, longitude: -74.006,
        reports: [{ has_roaches: false, report_date: recentDate, created_at: recentDate }],
      }],
      error: null,
    });

    const res = await request(app).get('/buildings/nearby?lat=40.7128&lng=-74.006');
    expect(res.status).toBe(200);
    expect(res.body[0].marker_status).toBe('no_roach');
  });

  test('returns none for a building with no reports', async () => {
    queueResponse({
      data: [{
        id: 'b1', address: '1 Main St', city: 'Brooklyn', state: 'NY',
        latitude: 40.7128, longitude: -74.006,
        reports: [],
      }],
      error: null,
    });

    const res = await request(app).get('/buildings/nearby?lat=40.7128&lng=-74.006');
    expect(res.status).toBe(200);
    expect(res.body[0].marker_status).toBe('none');
  });

  test('correctly computes report_count and positive_count', async () => {
    const recentDate = new Date().toISOString();
    queueResponse({
      data: [{
        id: 'b1', address: '1 Main St', city: 'Brooklyn', state: 'NY',
        latitude: 40.7128, longitude: -74.006,
        reports: [
          { has_roaches: true, report_date: recentDate, created_at: recentDate },
          { has_roaches: true, report_date: recentDate, created_at: recentDate },
          { has_roaches: false, report_date: recentDate, created_at: recentDate },
        ],
      }],
      error: null,
    });

    const res = await request(app).get('/buildings/nearby?lat=40.7128&lng=-74.006');
    expect(res.status).toBe(200);
    expect(res.body[0].report_count).toBe(3);
    expect(res.body[0].positive_count).toBe(2);
  });

  test('limits response to 150 buildings when more than 150 are returned by the database', async () => {
    const buildings = Array.from({ length: 200 }, (_, i) => ({
      id: `b${i}`,
      address: `${i} Test St`,
      city: 'Brooklyn',
      state: 'NY',
      latitude: 40.7128 + i * 0.0001,
      longitude: -74.006,
      reports: [],
    }));
    queueResponse({ data: buildings, error: null });

    const res = await request(app).get('/buildings/nearby?lat=40.7128&lng=-74.006');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(150);
  });

  test('sorts buildings by distance from the request center, closest first', async () => {
    // b_far is farther from center (40.7128, -74.006); b_close is closer.
    // They are returned from the DB in far-first order to verify sorting flips them.
    queueResponse({
      data: [
        {
          id: 'b_far', address: '2 Far St', city: 'Brooklyn', state: 'NY',
          latitude: 40.72, longitude: -74.006,
          reports: [],
        },
        {
          id: 'b_close', address: '1 Close St', city: 'Brooklyn', state: 'NY',
          latitude: 40.7129, longitude: -74.006,
          reports: [],
        },
      ],
      error: null,
    });

    const res = await request(app).get('/buildings/nearby?lat=40.7128&lng=-74.006');
    expect(res.status).toBe(200);
    expect(res.body[0].id).toBe('b_close');
    expect(res.body[1].id).toBe('b_far');
  });
});

// ===========================================
// GET /buildings/:id — stats computation
// ===========================================

describe('GET /buildings/:id', () => {
  test('returns 404 for an unknown building id', async () => {
    queueResponse({ data: null, error: { message: 'Not found' } });

    const res = await request(app).get('/buildings/nonexistent-id');
    expect(res.status).toBe(404);
  });

  test('computes correct stats for a building with mixed reports', async () => {
    queueResponse({
      data: {
        id: 'b1', address: '1 Main St', city: 'Brooklyn', state: 'NY',
        reports: [
          { id: 'r1', has_roaches: true, severity: 3, notes: null, source: 'user', report_date: null, created_at: new Date().toISOString(), report_images: [] },
          { id: 'r2', has_roaches: true, severity: 5, notes: null, source: 'user', report_date: null, created_at: new Date().toISOString(), report_images: [] },
          { id: 'r3', has_roaches: false, severity: null, notes: null, source: 'user', report_date: null, created_at: new Date().toISOString(), report_images: [] },
          { id: 'r4', has_roaches: false, severity: null, notes: null, source: 'user', report_date: null, created_at: new Date().toISOString(), report_images: [] },
        ],
      },
      error: null,
    });

    const res = await request(app).get('/buildings/b1');
    expect(res.status).toBe(200);
    expect(res.body.stats.totalReports).toBe(4);
    expect(res.body.stats.positiveReports).toBe(2);
    expect(res.body.stats.percentPositive).toBe(50);
    // avgSeverity = (3 + 5 + 0 + 0) / 4 = 2.0
    expect(res.body.stats.avgSeverity).toBe(2);
  });

  test('returns zeroed stats for a building with no reports', async () => {
    queueResponse({
      data: {
        id: 'b1', address: '1 Main St', city: 'Brooklyn', state: 'NY',
        reports: [],
      },
      error: null,
    });

    const res = await request(app).get('/buildings/b1');
    expect(res.status).toBe(200);
    expect(res.body.stats.totalReports).toBe(0);
    expect(res.body.stats.positiveReports).toBe(0);
    expect(res.body.stats.percentPositive).toBe(0);
    expect(res.body.stats.avgSeverity).toBe(0);
  });
});

// ===========================================
// GET /buildings/search — input validation
// ===========================================

describe('GET /buildings/search', () => {
  test('returns 400 when query is shorter than 2 characters', async () => {
    const res = await request(app).get('/buildings/search?q=a');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 2 characters/i);
  });

  test('returns 400 when query is missing', async () => {
    const res = await request(app).get('/buildings/search');
    expect(res.status).toBe(400);
  });

  test('returns matching buildings for a valid query', async () => {
    queueResponse({
      data: [
        { id: 'b1', address: '123 Main St', city: 'Brooklyn', state: 'NY', reports: [] },
        { id: 'b2', address: '456 Main Ave', city: 'Brooklyn', state: 'NY', reports: [] },
      ],
      error: null,
    });

    const res = await request(app).get('/buildings/search?q=Main');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });
});
