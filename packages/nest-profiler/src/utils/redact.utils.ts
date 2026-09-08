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
// Candidate card-shaped digit runs (optionally grouped by spaces/dashes), 13-19 digits — the
// range every real card network (Visa, Mastercard, Amex, Discover…) falls within. Each match is
// verified with `isLuhnValid` before being masked, so an ordinary numeric id of the same length
// (an order number, a phone number) is left alone unless it also happens to pass the checksum.
const CARD_NUMBER_RE = /\b(?:\d[ -]?){12,18}\d\b/g;

/**
 * Luhn (mod 10) checksum used by every major card network. Run against a digit-only string
 * (spaces/dashes already stripped by the caller) to tell a real card number apart from an
 * arbitrary 13-19 digit id before it gets masked.
 */
function isLuhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = digits.charCodeAt(i) - 48; // '0'
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * A caller's pattern, forced global and stateless. Without the `g` flag `String#replace` masks
 * only the first match — a body carrying two account ids would keep the second — and a sticky
 * (`y`) pattern carries a `lastIndex` across calls, so the same value redacts differently
 * depending on what was redacted before it.
 */
function toGlobalPattern(pattern: RegExp): RegExp {
  if (pattern.global && !pattern.sticky) return pattern;
  return new RegExp(pattern.source, `${pattern.flags.replace(/[gy]/g, '')}g`);
}

/** Masks card-shaped strings that also pass the Luhn checksum, leaving other digit runs as-is. */
function redactCardNumbers(value: string, replacement: string): string {
  return value.replace(CARD_NUMBER_RE, (match) => {
    const digits = match.replace(/[ -]/g, '');
    return isLuhnValid(digits) ? replacement : match;
  });
}

export interface RedactOptions {
  /** Extra exact key names (case-insensitive) to redact, on top of {@link DEFAULT_SECRET_KEY_RE}. */
  maskKeys?: string[];
  /** Override the sensitive-key pattern entirely. */
  keyPattern?: RegExp;
  /** Scan string values for embedded secrets (DSN credentials, JWTs, API keys, PEM). Default `true`. */
  maskValues?: boolean;
  /** Maximum recursion depth before values are returned untouched. Default `8`. */
  maxDepth?: number;
  /**
   * Extra value patterns to redact, applied alongside the built-in ones (DSN/JWT/API key/PEM/card).
   * Each is applied globally — a pattern without the `g` flag is treated as if it had one.
   */
  patterns?: RegExp[];
  /** Sentinel written in place of a redacted value. Default {@link REDACTED}. */
  replacement?: string;
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

/** Options accepted by the standalone {@link redactString}. */
export interface RedactStringOptions {
  /**
   * Extra value patterns to redact, applied alongside the built-in ones. Each is applied
   * globally — a pattern without the `g` flag is treated as if it had one.
   */
  patterns?: RegExp[];
  /** Sentinel written in place of a redacted match. Default {@link REDACTED}. */
  replacement?: string;
}

/**
 * Masks credentials embedded in a string value: URL userinfo (`scheme://user:pass@host` →
 * `scheme://[REDACTED]@host`), JWTs, `sk-/pk-/rk-` API keys, PEM private-key blocks and
 * Luhn-valid card numbers. Returns the string unchanged when nothing sensitive is detected.
 */
export function redactString(value: string, options: RedactStringOptions = {}): string {
  const replacement = options.replacement ?? REDACTED;
  // Function replacers throughout: a `replacement` is a literal sentinel, and passing it as a
  // string would let a `$&` or `$1` inside it be interpolated by `String#replace`.
  let result = value
    .replace(URL_USERINFO_RE, (_match, scheme: string) => `${scheme}${replacement}@`)
    .replace(PEM_RE, () => replacement)
    .replace(JWT_RE, () => replacement)
    .replace(SK_KEY_RE, () => replacement);
  result = redactCardNumbers(result, replacement);
  for (const pattern of options.patterns ?? []) {
    result = result.replace(toGlobalPattern(pattern), () => replacement);
  }
  return result;
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
      ? options.replacement
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
    return options.maskValues
      ? redactString(value, { patterns: options.patterns, replacement: options.replacement })
      : value;
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
 * {@link DEFAULT_SECRET_KEY_RE} (or `maskKeys`) have their value replaced by {@link REDACTED}
 * (or `replacement`), and — unless `maskValues: false` — string values are scanned for embedded
 * credentials (DSN userinfo, JWTs, API keys, PEM blocks, Luhn-valid card numbers, plus any extra
 * `patterns`). Non-string primitives are preserved as-is so numbers/booleans stay useful in the
 * profiler UI. Cyclic graphs are handled.
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
    patterns: options.patterns ?? [],
    replacement: options.replacement ?? REDACTED,
  };
  return redactInner(value, 0, new WeakSet(), resolved) as T;
}
