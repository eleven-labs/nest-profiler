import { redact, redactString, isSecretKey, REDACTED } from './redact.utils';

describe('isSecretKey', () => {
  it('flags common sensitive key names case-insensitively', () => {
    for (const key of [
      'password',
      'API_KEY',
      'accessToken',
      'Authorization',
      'clientSecret',
      'DATABASE_DSN',
    ]) {
      expect(isSecretKey(key)).toBe(true);
    }
  });

  it('does not flag innocuous keys', () => {
    for (const key of ['name', 'count', 'email', 'createdAt']) {
      expect(isSecretKey(key)).toBe(false);
    }
  });

  it('honours extra maskKeys (case-insensitive exact match)', () => {
    expect(isSecretKey('ssn', { maskKeys: ['SSN'] })).toBe(true);
    expect(isSecretKey('ssnx', { maskKeys: ['SSN'] })).toBe(false);
  });
});

describe('redactString', () => {
  it('masks URL userinfo but keeps scheme and host', () => {
    expect(redactString('postgres://user:pass@db.example.com:5432/app')).toBe(
      `postgres://${REDACTED}@db.example.com:5432/app`,
    );
  });

  it('masks JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.abc123';
    expect(redactString(`Bearer ${jwt}`)).toBe(`Bearer ${REDACTED}`);
  });

  it('masks sk-/pk- style API keys and PEM blocks', () => {
    expect(redactString('key=sk-ABCDEFGHIJKLMNOPQRST')).toBe('key=[REDACTED]');
    expect(redactString('-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----')).toBe(
      REDACTED,
    );
  });

  it('leaves ordinary strings untouched', () => {
    expect(redactString('just a normal value')).toBe('just a normal value');
  });
});

describe('redact', () => {
  it('redacts values of sensitive keys, keeps others', () => {
    expect(redact({ username: 'bob', password: 'hunter2', age: 42 })).toEqual({
      username: 'bob',
      password: REDACTED,
      age: 42,
    });
  });

  it('recurses into nested objects and arrays', () => {
    expect(
      redact({ user: { profile: { apiKey: 'secret', name: 'bob' } }, tags: ['a', 'b'] }),
    ).toEqual({
      user: { profile: { apiKey: REDACTED, name: 'bob' } },
      tags: ['a', 'b'],
    });
  });

  it('masks an entire subtree when its own key is sensitive', () => {
    expect(redact({ credentials: { apiKey: 'secret', user: 'bob' } })).toEqual({
      credentials: REDACTED,
    });
  });

  it('masks embedded credentials in string values by default', () => {
    expect(redact({ url: 'redis://user:pw@host:6379' })).toEqual({
      url: `redis://${REDACTED}@host:6379`,
    });
  });

  it('can disable value scanning', () => {
    expect(redact({ note: 'redis://user:pw@host' }, { maskValues: false })).toEqual({
      note: 'redis://user:pw@host',
    });
  });

  it('preserves non-string primitives', () => {
    expect(redact({ n: 1, b: true, z: null })).toEqual({ n: 1, b: true, z: null });
  });

  it('handles cyclic graphs without throwing', () => {
    const value: Record<string, unknown> = { a: 1 };
    value['self'] = value;
    expect(redact(value)).toEqual({ a: 1, self: '[Circular]' });
  });
});
