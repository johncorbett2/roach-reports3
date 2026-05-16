// Supabase's query builder is a fluent/chainable API (e.g. .from().select().eq().single()).
// Making the builder "thenable" means any point in the chain can be awaited — JavaScript
// calls .then() on it, which we control here to return the next queued response.

const resolveQueue = [];

const mockQueryBuilder = {
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  ilike: jest.fn().mockReturnThis(),
  gte: jest.fn().mockReturnThis(),
  lte: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  order: jest.fn().mockReturnThis(),
  range: jest.fn().mockReturnThis(),
  single: jest.fn().mockReturnThis(),
  then: jest.fn((resolve, reject) => {
    const value = resolveQueue.length > 0
      ? resolveQueue.shift()
      : { data: null, error: null };
    return Promise.resolve(value).then(resolve, reject);
  }),
};

const mockSupabase = {
  from: jest.fn().mockReturnValue(mockQueryBuilder),
};

// Push an expected { data, error } response onto the queue.
// Responses are consumed in order — one per awaited Supabase chain.
function queueResponse(value) {
  resolveQueue.push(value);
}

// Call in beforeEach to reset call counts and drain any leftover queue items.
function resetMocks() {
  resolveQueue.length = 0;
  mockSupabase.from.mockClear();
  for (const fn of Object.values(mockQueryBuilder)) {
    if (typeof fn?.mockClear === 'function') fn.mockClear();
  }
}

module.exports = { mockSupabase, mockQueryBuilder, queueResponse, resetMocks };
