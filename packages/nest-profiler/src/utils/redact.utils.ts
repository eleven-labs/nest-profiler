import { getToJSON, isPlainObject, stringifyExotic } from './type.utils';

/** Sentinel written in place of a redacted value across the whole profiler ecosystem. */
export const REDACTED = '[REDACTED]';

/**
 * Default key-name pattern flagged as sensitive (matched case-insensitively against each
 * object key). Kept deliberately broad — the profiler is a debug tool and over-masking is
 * safer than leaking a credential onto disk.
 */
export const DEFAULT_SECRET_KEY_RE =
  /pass(?:word|phrase)?|secret|token|credential|api[-_]?key|apikey|authorization|auth[-_]?token|cookie|session|access[-_]?key|private[-_]?key|client[-_]?secret|dsn|connection[-_]?string/i;

// Value patterns: credentials embedded inside otherwise-innocent-looking strings.
// Quantifiers are deliberately upper-bounded: these run over uncontrolled data (headers,
// payloads, config), so unbounded `+`/`{n,}` would expose a polynomial-backtracking (ReDoS)
// vector. The caps are far above any realistic credential length.
const URL_USERINFO_RE = /([a-z][a-z0-9+.-]{0,31}:\/\/)[^/\s:@]{1,256}:[^/\s:@]{1,256}@/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{5,2048}\.[A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{1,2048}/g;
const SK_KEY_RE = /\b(?:sk|rk|pk)-[A-Za-z0-9]{16,256}/g;
const PEM_RE =
  /-----BEGIN (?:[A-Z ]{1,64} )?PRIVATE KEY-----[\s\S]{0,8192}?-----END (?:[A-Z ]{1,64} )?PRIVATE KEY-----/g;

export interface RedactOptions {
  /** Extra exact key names (case-insensitive) to redact, on top of {@link DEFAULT_SECRET_KEY_RE}. */
  maskKeys?: string[];
  /** Override the sensitive-key pattern entirely. */
  keyPattern?: RegExp;
  /** Scan string values for embedded secrets (DSN credentials, JWTs, API keys, PEM). Default `true`. */
  maskValues?: boolean;
  /** Maximum recursion depth before values are returned untouched. Default `8`. */
  maxDepth?: number;
}

/** Whether an object key looks sensitive under the given options. */
export function isSecretKey(key: string, options: RedactOptions = {}): boolean {
  const pattern = options.keyPattern ?? DEFAULT_SECRET_KEY_RE;
  if (pattern.test(key)) return true;
  const extra = options.maskKeys;
  if (!extra) return false;
  const lower = key.toLowerCase();
  return extra.some((k) => k.toLowerCase() === lower);
}

/**
 * Masks credentials embedded in a string value: URL userinfo (`scheme://user:pass@host` →
 * `scheme://[REDACTED]@host`), JWTs, `sk-/pk-/rk-` API keys and PEM private-key blocks.
 * Returns the string unchanged when nothing sensitive is detected.
 */
export function redactString(value: string): string {
  return value
    .replace(URL_USERINFO_RE, `$1${REDACTED}@`)
    .replace(PEM_RE, REDACTED)
    .replace(JWT_RE, REDACTED)
    .replace(SK_KEY_RE, REDACTED);
}

/** Redacts an object's own-enumerable entries: secret keys are masked, others recursed into. */
function redactEntries(
  entries: [string, unknown][],
  depth: number,
  seen: WeakSet<object>,
  options: Required<RedactOptions>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of entries) {
    result[key] = isSecretKey(key, options)
      ? REDACTED
      : redactInner(entry, depth + 1, seen, options);
  }
  return result;
}

function redactInner(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  options: Required<RedactOptions>,
): unknown {
  if (typeof value === 'string') {
    return options.maskValues ? redactString(value) : value;
  }
  // BigInt is not JSON-serializable; stringify it so profile serialization never throws later.
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  if (depth >= options.maxDepth) return value;

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactInner(item, depth + 1, seen, options));
    }
    // Well-known non-plain types: serialize them meaningfully instead of enumerating their
    // (usually empty) own-enumerable keys, which would collapse them to `{}` or mangle them.
    if (value instanceof Date) return value.toISOString();
    const exotic = stringifyExotic(value);
    if (exotic !== undefined) return exotic;
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack };
    }
    if (value instanceof Map) {
      const entries: [string, unknown][] = [...value].map(([key, entry]) => [String(key), entry]);
      return redactEntries(entries, depth, seen, options);
    }
    if (value instanceof Set) {
      return [...value].map((item) => redactInner(item, depth + 1, seen, options));
    }
    if (value instanceof ArrayBuffer) return `[ArrayBuffer ${value.byteLength} bytes]`;
    if (ArrayBuffer.isView(value)) {
      const ctor = value.constructor?.name ?? 'TypedArray';
      return `[${ctor} ${value.byteLength} bytes]`;
    }
    if (isPlainObject(value)) {
      return redactEntries(Object.entries(value), depth, seen, options);
    }
    // A remaining class instance: prefer its `toJSON()` projection, else enumerate its own
    // enumerable properties like a plain object (previous behavior).
    const toJSON = getToJSON(value);
    if (toJSON) return redactInner(toJSON.call(value), depth, seen, options);
    return redactEntries(Object.entries(value as Record<string, unknown>), depth, seen, options);
  } finally {
    seen.delete(value);
  }
}

/**
 * Recursively redacts sensitive data from an arbitrary value: object keys matching
 * {@link DEFAULT_SECRET_KEY_RE} (or `maskKeys`) have their value replaced by {@link REDACTED},
 * and — unless `maskValues: false` — string values are scanned for embedded credentials
 * (DSN userinfo, JWTs, API keys, PEM blocks). Non-string primitives are preserved as-is so
 * numbers/booleans stay useful in the profiler UI. Cyclic graphs are handled.
 *
 * This is the single shared redaction entry point for the whole profiler ecosystem
 * (HTTP headers, SQL parameters, config values, validator values, Mongo filters, AMQP
 * payloads, CLI options).
 */
export function redact<T>(value: T, options: RedactOptions = {}): T {
  const resolved: Required<RedactOptions> = {
    maskKeys: options.maskKeys ?? [],
    keyPattern: options.keyPattern ?? DEFAULT_SECRET_KEY_RE,
    maskValues: options.maskValues ?? true,
    maxDepth: options.maxDepth ?? 8,
  };
  return redactInner(value, 0, new WeakSet(), resolved) as T;
}
