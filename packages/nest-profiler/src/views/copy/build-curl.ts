/**
 * Normalized input for {@link buildCurlCommand}. Accepts both the incoming
 * request shape ({@link HttpRequestData} — `headers` may carry arrays) and the
 * outgoing client shape (`HttpRequestEntry` — `headers` are flat strings).
 */
export interface CurlInput {
  method: string;
  url: string;
  headers?: Record<string, string | string[]> | undefined;
  body?: unknown;
}

/** Escapes a value for safe embedding inside single quotes in a POSIX shell. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Resolves the `host` header case-insensitively. */
function findHeader(headers: CurlInput['headers'], name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

/**
 * Turns the request `url` into an absolute one. Relative paths (the common case
 * for the incoming entrypoint) are prefixed with the scheme (`x-forwarded-proto`
 * when present, otherwise `http`) and the `host` header.
 */
function absoluteUrl(url: string, headers: CurlInput['headers']): string {
  if (/^https?:\/\//i.test(url)) return url;
  const host = findHeader(headers, 'host');
  if (!host) return url;
  const proto = findHeader(headers, 'x-forwarded-proto') ?? 'http';
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${proto}://${host}${path}`;
}

/**
 * Builds a runnable, multi-line `curl` command from captured HTTP request data,
 * mirroring the Symfony Web Profiler "Copy as cURL" feature. Header values are
 * reproduced exactly as captured; sensitive headers (`authorization`, `cookie`…)
 * were already redacted to `[REDACTED]` at capture time (see `maskHeaders`), so a
 * copied command carries the placeholder rather than a live credential.
 */
export function buildCurlCommand(input: CurlInput): string {
  const method = (input.method || 'GET').toUpperCase();
  const url = absoluteUrl(input.url, input.headers);

  const lines: string[] = ['curl'];
  if (method !== 'GET') lines.push(`-X ${method}`);
  lines.push(shellQuote(url));

  if (input.headers) {
    for (const [key, raw] of Object.entries(input.headers)) {
      const values = Array.isArray(raw) ? raw : [raw];
      for (const value of values) {
        lines.push(`-H ${shellQuote(`${key}: ${value}`)}`);
      }
    }
  }

  if (input.body !== undefined && input.body !== null && input.body !== '') {
    const body = typeof input.body === 'string' ? input.body : JSON.stringify(input.body);
    lines.push(`--data ${shellQuote(body)}`);
  }

  return lines.join(' \\\n  ');
}
