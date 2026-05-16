const { mockSupabase, mockQueryBuilder, queueResponse, resetMocks } = require('./helpers/mockSupabase');

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => require('./helpers/mockSupabase').mockSupabase,
}));

const request = require('supertest');
const app = require('../app');

beforeEach(() => resetMocks());

// ===========================================
// POST /reports
// ===========================================

describe('POST /reports', () => {
  test('returns 400 when has_roaches is missing', async () => {
    const res = await request(app)
      .post('/reports')
      .send({ building_id: 'b1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/has_roaches is required/i);
  });

  test('returns 400 when neither building_id nor address is provided', async () => {
    const res = await request(app)
      .post('/reports')
      .send({ has_roaches: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/building_id or address is required/i);
  });

  test('creates report when building_id is provided directly', async () => {
    const fakeReport = {
      id: 'r1',
      building_id: 'b1',
      has_roaches: true,
      severity: 4,
      notes: null,
      buildings: { id: 'b1', address: '1 Main St', city: 'Brooklyn', state: 'NY', zip: '11201' },
    };
    // Only one Supabase call: insert report → select → single
    queueResponse({ data: fakeReport, error: null });

    const res = await request(app)
      .post('/reports')
      .send({ building_id: 'b1', has_roaches: true, severity: 4 });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('r1');
    expect(res.body.building_id).toBe('b1');
  });

  test('finds existing building by address match and attaches the report to it', async () => {
    const fakeReport = {
      id: 'r1',
      building_id: 'b1',
      has_roaches: true,
      severity: 3,
      buildings: { id: 'b1', address: '1 Main St', city: 'Brooklyn', state: 'NY', zip: '11201' },
    };
    // Call 1: address lookup → existing building found
    queueResponse({ data: [{ id: 'b1' }], error: null });
    // Call 2: insert report
    queueResponse({ data: fakeReport, error: null });

    const res = await request(app)
      .post('/reports')
      .send({ address: '1 Main St', has_roaches: true, severity: 3 });

    expect(res.status).toBe(201);
    expect(res.body.building_id).toBe('b1');
  });

  test('finds building by coordinate proximity, updates its address, and attaches the report', async () => {
    const fakeReport = {
      id: 'r1',
      building_id: 'b2',
      has_roaches: false,
      buildings: { id: 'b2', address: '2 Broadway', city: 'Manhattan', state: 'NY', zip: '10004' },
    };
    // Call 1: address lookup → no match
    queueResponse({ data: [], error: null });
    // Call 2: proximity lookup → match found
    queueResponse({ data: [{ id: 'b2' }], error: null });
    // Call 3: update building address (result discarded by route)
    queueResponse({ data: null, error: null });
    // Call 4: insert report
    queueResponse({ data: fakeReport, error: null });

    const res = await request(app)
      .post('/reports')
      .send({
        address: '2 Broadway',
        city: 'Manhattan',
        state: 'NY',
        zip: '10004',
        latitude: 40.7074,
        longitude: -74.0113,
        has_roaches: false,
      });

    expect(res.status).toBe(201);
    expect(res.body.building_id).toBe('b2');
  });

  test('creates a new building when no address or proximity match is found', async () => {
    const fakeReport = {
      id: 'r1',
      building_id: 'b-new',
      has_roaches: true,
      severity: 2,
      buildings: { id: 'b-new', address: '99 New St', city: 'Queens', state: 'NY', zip: '11101' },
    };
    // Call 1: address lookup → no match
    queueResponse({ data: [], error: null });
    // Call 2: proximity lookup → no match
    queueResponse({ data: [], error: null });
    // Call 3: insert new building → returns id
    queueResponse({ data: { id: 'b-new' }, error: null });
    // Call 4: insert report
    queueResponse({ data: fakeReport, error: null });

    const res = await request(app)
      .post('/reports')
      .send({
        address: '99 New St',
        city: 'Queens',
        state: 'NY',
        zip: '11101',
        latitude: 40.744,
        longitude: -73.948,
        has_roaches: true,
        severity: 2,
      });

    expect(res.status).toBe(201);
    expect(res.body.building_id).toBe('b-new');
  });

  test('sets severity to null when has_roaches is false', async () => {
    const fakeReport = { id: 'r1', building_id: 'b1', has_roaches: false, severity: null };
    queueResponse({ data: fakeReport, error: null });

    await request(app)
      .post('/reports')
      .send({ building_id: 'b1', has_roaches: false, severity: 3 });

    // Verify the value passed to insert had severity: null
    const insertedRecord = mockQueryBuilder.insert.mock.calls[0][0][0];
    expect(insertedRecord.severity).toBeNull();
  });
});
