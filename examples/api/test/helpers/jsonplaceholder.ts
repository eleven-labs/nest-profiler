import nock from 'nock';

const JPH = 'https://jsonplaceholder.typicode.com';

export const MOCK_POSTS = [
  { userId: 1, id: 1, title: 'mock post one', body: 'first mock body' },
  { userId: 2, id: 2, title: 'mock post two', body: 'second mock body' },
];

export const MOCK_USER = {
  id: 1,
  name: 'Leanne Graham',
  username: 'Bret',
  email: 'leanne@example.com',
  company: { name: 'Acme Corp' },
};

export const MOCK_TODO = { userId: 1, id: 1, title: 'mock todo', completed: false };

/**
 * Intercepts every JSONPlaceholder route the example app calls. The axios collector still
 * captures these requests: nock hooks below axios, at the http layer.
 */
export function mockJsonPlaceholder(): nock.Scope {
  return nock(JPH)
    .persist()
    .get('/posts')
    .query(true) // ?_limit=N
    .reply(200, MOCK_POSTS)
    .get(/^\/users\/\d+$/)
    .reply(200, (uri) => ({ ...MOCK_USER, id: Number(uri.split('/').pop()) }))
    .get(/^\/todos\/\d+$/)
    .reply(200, (uri) => ({ ...MOCK_TODO, id: Number(uri.split('/').pop()) }))
    .post('/posts')
    .reply(201, (_uri, body) => ({ id: 101, ...(typeof body === 'object' ? body : {}) }));
}

/** Blocks real network calls while keeping supertest's loopback server reachable. */
export function lockNetwork(): void {
  nock.disableNetConnect();
  nock.enableNetConnect(/127\.0\.0\.1|\[::1\]|localhost/);
}

export function unlockNetwork(): void {
  nock.cleanAll();
  nock.enableNetConnect();
}
