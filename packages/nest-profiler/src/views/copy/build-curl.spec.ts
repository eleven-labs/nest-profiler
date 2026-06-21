import { buildCurlCommand } from './build-curl';

describe('buildCurlCommand', () => {
  it('builds a GET command without -X and without a body', () => {
    const curl = buildCurlCommand({
      method: 'GET',
      url: 'https://api.example.com/users?page=2',
      headers: { Accept: 'application/json' },
    });
    expect(curl).toBe(
      `curl \\\n  'https://api.example.com/users?page=2' \\\n  -H 'Accept: application/json'`,
    );
  });

  it('emits -X and --data for a POST with a JSON body', () => {
    const curl = buildCurlCommand({
      method: 'post',
      url: 'https://api.example.com/users',
      headers: { 'Content-Type': 'application/json' },
      body: { name: 'John' },
    });
    expect(curl).toContain(`-X POST`);
    expect(curl).toContain(`--data '{"name":"John"}'`);
  });

  it('builds an absolute URL from the host header when the url is relative', () => {
    const curl = buildCurlCommand({
      method: 'GET',
      url: '/orders/42',
      headers: { host: 'localhost:3000' },
    });
    expect(curl).toContain(`'http://localhost:3000/orders/42'`);
  });

  it('honours x-forwarded-proto when resolving the scheme', () => {
    const curl = buildCurlCommand({
      method: 'GET',
      url: '/secure',
      headers: { host: 'example.com', 'x-forwarded-proto': 'https' },
    });
    expect(curl).toContain(`'https://example.com/secure'`);
  });

  it('expands array header values into one -H per value', () => {
    const curl = buildCurlCommand({
      method: 'GET',
      url: 'https://x.test/',
      headers: { 'set-cookie': ['a=1', 'b=2'] },
    });
    expect(curl).toContain(`-H 'set-cookie: a=1'`);
    expect(curl).toContain(`-H 'set-cookie: b=2'`);
  });

  it('escapes single quotes in values', () => {
    const curl = buildCurlCommand({
      method: 'POST',
      url: 'https://x.test/',
      body: "it's",
    });
    expect(curl).toContain(`--data 'it'\\''s'`);
  });

  it('keeps a string body verbatim', () => {
    const curl = buildCurlCommand({ method: 'POST', url: 'https://x.test/', body: 'raw=1' });
    expect(curl).toContain(`--data 'raw=1'`);
  });
});
