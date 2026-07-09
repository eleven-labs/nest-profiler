import { normalizeSqlFingerprint, normalizeHttpFingerprint } from './fingerprint.utils';

describe('normalizeSqlFingerprint', () => {
  it('collapses bind values so the same query shares a fingerprint', () => {
    const a = normalizeSqlFingerprint("SELECT * FROM users WHERE id = 1 AND name = 'bob'");
    const b = normalizeSqlFingerprint("SELECT * FROM users WHERE id = 42 AND name = 'alice'");
    expect(a).toBe(b);
    expect(a).toBe('SELECT * FROM users WHERE id = ? AND name = ?');
  });

  it('normalizes positional and named parameters', () => {
    expect(normalizeSqlFingerprint('SELECT * FROM t WHERE a = $1 AND b = :name')).toBe(
      'SELECT * FROM t WHERE a = ? AND b = ?',
    );
  });

  it('collapses IN-lists of differing length to a single placeholder', () => {
    const two = normalizeSqlFingerprint('SELECT * FROM t WHERE id IN (1, 2)');
    const three = normalizeSqlFingerprint('SELECT * FROM t WHERE id IN (7, 8, 9)');
    expect(two).toBe(three);
    expect(two).toBe('SELECT * FROM t WHERE id IN (?)');
  });

  it('squashes whitespace', () => {
    expect(normalizeSqlFingerprint('SELECT\n  *\tFROM   users')).toBe('SELECT * FROM users');
  });
});

describe('normalizeHttpFingerprint', () => {
  it('keeps host and path but drops the query string', () => {
    expect(normalizeHttpFingerprint('get', 'https://api.example.com/users?page=2')).toBe(
      'GET api.example.com/users',
    );
  });

  it('collapses numeric and uuid path segments to :id', () => {
    const numeric = normalizeHttpFingerprint('GET', 'https://api.example.com/users/42/orders');
    const uuid = normalizeHttpFingerprint(
      'GET',
      'https://api.example.com/users/1e9d6a4b-2c3d-4e5f-8a9b-0c1d2e3f4a5b/orders',
    );
    expect(numeric).toBe('GET api.example.com/users/:id/orders');
    expect(uuid).toBe(numeric);
  });

  it('falls back to the path for relative urls, dropping query and fragment', () => {
    expect(normalizeHttpFingerprint('POST', '/webhooks/123?sig=abc')).toBe('POST /webhooks/:id');
    expect(normalizeHttpFingerprint('POST', '/webhooks/123#section')).toBe('POST /webhooks/:id');
    expect(normalizeHttpFingerprint('GET', '/health')).toBe('GET /health');
  });
});
