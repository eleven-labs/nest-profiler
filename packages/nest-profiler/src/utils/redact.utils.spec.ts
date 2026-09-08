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

  it('serializes a Date to an ISO string instead of collapsing it to {}', () => {
    expect(redact({ at: new Date('2026-07-01T00:00:00.000Z') })).toEqual({
      at: '2026-07-01T00:00:00.000Z',
    });
  });

  it('serializes a top-level Date', () => {
    expect(redact(new Date('2026-07-01T00:00:00.000Z'))).toBe('2026-07-01T00:00:00.000Z');
  });

  it('renders a Map as an object and redacts its sensitive keys', () => {
    expect(
      redact(
        new Map<string, unknown>([
          ['name', 'bob'],
          ['password', 'hunter2'],
        ]),
      ),
    ).toEqual({ name: 'bob', password: REDACTED });
  });

  it('renders a Set as an array', () => {
    expect(redact(new Set([1, 2, 3]))).toEqual([1, 2, 3]);
  });

  it('renders URL and RegExp as strings', () => {
    expect(redact({ u: new URL('https://x/y'), r: /foo/gi })).toEqual({
      u: 'https://x/y',
      r: '/foo/gi',
    });
  });

  it('renders an Error as { name, message, stack }', () => {
    const result = redact(new Error('boom')) as { name: string; message: string; stack?: string };
    expect(result.name).toBe('Error');
    expect(result.message).toBe('boom');
    expect(typeof result.stack).toBe('string');
  });

  it('renders a Buffer as a size placeholder rather than a byte-index map', () => {
    expect(redact({ blob: Buffer.from('hello') })).toEqual({ blob: '[Buffer 5 bytes]' });
  });

  it('renders a TypedArray as a size placeholder', () => {
    expect(redact(new Uint16Array([1, 2, 3]))).toBe('[Uint16Array 6 bytes]');
  });

  it('stringifies a BigInt so profile serialization never throws', () => {
    const result = redact({ big: 10n });
    expect(result).toEqual({ big: '10' });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('prefers a class instance toJSON() projection when available', () => {
    class Money {
      constructor(private readonly cents: number) {}
      toJSON(): { amount: number } {
        return { amount: this.cents / 100 };
      }
    }
    expect(redact({ price: new Money(1050) })).toEqual({ price: { amount: 10.5 } });
  });

  it('falls back to own-enumerable enumeration for a plain class instance', () => {
    class Point {
      constructor(
        public x: number,
        public token: string,
      ) {}
    }
    expect(redact(new Point(1, 'secret'))).toEqual({ x: 1, token: REDACTED });
  });

  it('masks a Luhn-valid card number embedded in a string', () => {
    // A well-known Luhn-valid test number (Visa test PAN).
    expect(redact({ note: 'card 4242 4242 4242 4242 on file' })).toEqual({
      note: `card ${REDACTED} on file`,
    });
  });

  it('leaves a same-length digit run alone when it fails the Luhn checksum', () => {
    expect(redact({ note: 'order 4242424242424241' })).toEqual({
      note: 'order 4242424242424241',
    });
  });

  it('applies extra value patterns on top of the built-ins', () => {
    expect(
      redact({ note: 'acct_ab12cd34ef56gh78' }, { patterns: [/acct_[a-z0-9]{16}/gi] }),
    ).toEqual({
      note: REDACTED,
    });
  });

  it('honours a custom replacement sentinel', () => {
    expect(redact({ password: 'hunter2' }, { replacement: '***' })).toEqual({
      password: '***',
    });
    expect(redact('sk-ABCDEFGHIJKLMNOPQRST', { replacement: '***' })).toBe('***');
  });
});

describe('redactString with extra options', () => {
  it('honours a custom replacement sentinel', () => {
    expect(redactString('key=sk-ABCDEFGHIJKLMNOPQRST', { replacement: '***' })).toBe('key=***');
  });

  it('applies extra patterns', () => {
    expect(redactString('acct_ab12cd34ef56gh78', { patterns: [/acct_[a-z0-9]{16}/gi] })).toBe(
      REDACTED,
    );
  });
});

describe('redactString — caller-supplied patterns', () => {
  it('masks every occurrence even when the pattern carries no g flag', () => {
    expect(
      redactString('acct_aaaaaaaaaaaaaaaa and acct_bbbbbbbbbbbbbbbb', {
        patterns: [/acct_[a-z0-9]{16}/],
      }),
    ).toBe(`${REDACTED} and ${REDACTED}`);
  });

  it('does not carry lastIndex across calls for a sticky pattern', () => {
    const sticky = /acct_[a-z0-9]{16}/gy;
    const input = 'acct_aaaaaaaaaaaaaaaa';
    expect(redactString(input, { patterns: [sticky] })).toBe(REDACTED);
    expect(redactString(input, { patterns: [sticky] })).toBe(REDACTED);
  });

  it('writes a replacement containing $ literally rather than interpolating it', () => {
    expect(redactString('token sk-ABCDEFGHIJKLMNOPQRST', { replacement: '$&' })).toBe('token $&');
  });
});
