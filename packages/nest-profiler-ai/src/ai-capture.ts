import {
  DEFAULT_MASK_QUERY_PARAMS,
  REDACTED,
  buildMaskedQueryParams,
  redact,
  redactQueryString,
  redactString,
} from '@eleven-labs/nest-profiler';
import type { RedactOptions, RedactStringOptions } from '@eleven-labs/nest-profiler';
import type { AiMessageRole } from './ai-call.interface';

/**
 * How much of one kind of AI content reaches a stored profile.
 *
 * A prompt is not a SQL query: it carries whatever the application put in front of the model —
 * the user's own words, the documents retrieved for them, the keys a tool was handed. Each level
 * below keeps strictly less than the one before it:
 *
 * - `none` — the field never leaves the process. The figures around it (model, tokens, cost,
 *   timings, tool names, finish reasons) are unaffected.
 * - `metadata` — the shape without the content: how long the text was, how many items the payload
 *   held, which keys it had. Enough to read a trace, nothing to leak.
 * - `redacted` — the content, with credentials and personal data masked (**the default**).
 * - `full` — verbatim, masking off. For a local machine, not for anything shared.
 */
export type AiCaptureLevel = 'none' | 'metadata' | 'redacted' | 'full';

/** The content fields a capture level can be set on, each recorded independently. */
export const AI_CAPTURE_FIELDS = [
  'instructions',
  'messages',
  'completion',
  'reasoning',
  'toolDefinitions',
  'toolArguments',
  'toolResults',
  'output',
  'runtimeContext',
] as const;

export type AiCaptureField = (typeof AI_CAPTURE_FIELDS)[number];

/**
 * Shorthands that set several fields at once, for the two decisions usually taken as a whole:
 * what went to the model, and what the tools moved around. A field named on its own always wins
 * over the group it belongs to.
 */
export const AI_CAPTURE_GROUPS = {
  prompt: ['instructions', 'messages'],
  tools: ['toolDefinitions', 'toolArguments', 'toolResults'],
} as const satisfies Record<string, readonly AiCaptureField[]>;

export type AiCaptureGroup = keyof typeof AI_CAPTURE_GROUPS;

/**
 * A capture level per content field, for the setups where one field is more sensitive than the
 * rest — a conversation that must never be stored while the completions still are, reasoning
 * dropped because a thinking model restates the whole prompt to itself, a tool that answers with
 * a whole customer record while its arguments stay readable.
 *
 * Resolution runs from the narrowest: a field, then the group it belongs to (`prompt`, `tools`),
 * then {@link AiCaptureFieldLevels.default}.
 */
export interface AiCaptureFieldLevels {
  /** Level for every field not named below, and not covered by a group. Default: `'redacted'`. */
  default?: AiCaptureLevel;
  /** Shorthand for `instructions` and `messages` — everything that went to the model. */
  prompt?: AiCaptureLevel;
  /** Shorthand for `toolDefinitions`, `toolArguments` and `toolResults`. */
  tools?: AiCaptureLevel;
  /** The system prompt, which the SDK keeps apart from the conversation. */
  instructions?: AiCaptureLevel;
  /** The conversation sent to the model. Tool payloads inside it follow their own fields. */
  messages?: AiCaptureLevel;
  /** The model's answer. */
  completion?: AiCaptureLevel;
  /** The model's thinking, when it exposed any — often a restatement of the whole prompt. */
  reasoning?: AiCaptureLevel;
  /** The tools declared to the model: their descriptions and input schemas, never their data. */
  toolDefinitions?: AiCaptureLevel;
  /** What a tool was called with: the model's arguments, and the reason of an approval on them. */
  toolArguments?: AiCaptureLevel;
  /** What a tool answered — the field that carries whatever the application's data sources hold. */
  toolResults?: AiCaptureLevel;
  /** `generateObject`'s parsed object and the schema it had to satisfy. */
  output?: AiCaptureLevel;
  /**
   * The context the application threads through a generation: the AI SDK's `runtimeContext` on
   * the call, and each tool's `toolContext` on its execution — the user, the tenant, a token a
   * tool needs. **Not captured unless it is named here**: it is the one field that holds the
   * application's own state rather than what was said, and it is not worth storing by accident.
   * Default: `'none'`.
   */
  runtimeContext?: AiCaptureLevel;
}

/** One level for every field, or a level per field and per group. */
export type AiCaptureOptions = AiCaptureLevel | AiCaptureFieldLevels;

/** What a captured value belongs to, beyond its field — the message's role, the tool's name. */
export interface AiCaptureOrigin {
  /** The role of the message the text belongs to, when it belongs to one. */
  role?: AiMessageRole;
  /** The tool the payload belongs to, when it belongs to one. */
  tool?: string;
}

/** What is being masked, handed to {@link AiRedactionOptions.sanitize}. */
export interface AiRedactionContext extends AiCaptureOrigin {
  /** The content field, or `'error'` for a provider error or warning message. */
  field: AiCaptureField | 'error';
}

/** A last-resort scrubber over every text that is kept. Runs after the built-in masking. */
export type AiSanitizer = (text: string, context: AiRedactionContext) => string;

/**
 * What the `redacted` level masks, on top of the built-in detectors.
 *
 * The built-ins come from the profiler core, so an AI payload is masked by the same rules as a
 * request body: object keys that name a secret (`password`, `apiKey`, `authorization`, …) and
 * values that look like one (JWTs, `sk-`/`pk-` keys, PEM blocks, `scheme://user:pass@` userinfo,
 * Luhn-valid card numbers).
 */
export interface AiRedactionOptions {
  /**
   * Apply the built-in sensitive **key** list on top of {@link AiRedactionOptions.keys}. Default:
   * `true`. The built-in **value** detectors are not a list you can restate name by name and stay
   * on either way — `capture: 'full'` is the way to turn masking off.
   */
  useDefaults?: boolean;
  /**
   * Mask the common personal-data shapes the credential detectors do not cover: email addresses,
   * international phone numbers, IBANs, US social-security numbers. Default: `true`.
   *
   * Detection is best-effort — a name, a street or a national id in a local format goes through.
   * Where the data is regulated, `metadata` or `none` is the answer, not a longer pattern list.
   */
  pii?: boolean;
  /** Extra object-key names (case-insensitive) whose value is masked in payloads and objects. */
  keys?: string[];
  /** Extra value patterns masked inside every captured text, alongside the built-in ones. */
  patterns?: RegExp[];
  /** Sentinel written in place of a masked value. Default: `'[REDACTED]'`. */
  replacement?: string;
  /**
   * Your own scrubber, run over every text that is kept, after the built-in masking — the hook
   * for a PII detector the patterns above cannot replace, or for dropping one tool's payload:
   *
   * ```ts
   * sanitize: (text, { field, tool }) =>
   *   field === 'toolResults' && tool === 'readPatientRecord' ? '[REDACTED]' : scrubber.run(text),
   * ```
   */
  sanitize?: AiSanitizer;
}

/** Everything the capture path reads, as the module resolves it from its options. */
export interface AiCaptureSettings {
  /** Content capture level, one for all fields or one per field. Default: `'redacted'`. */
  capture?: AiCaptureOptions;
  /** @deprecated Use {@link AiCaptureSettings.capture}: `true` is `'redacted'`, `false` is `'none'`. */
  captureContent?: boolean;
  /** What the `redacted` level masks. */
  redaction?: AiRedactionOptions;
  /** Characters kept of any one captured text before it is truncated. */
  maxTextLength?: number;
  /** Messages kept per call, counted from the most recent. */
  maxMessages?: number;
}

/** Defaults for the bounds applied before anything reaches a stored profile. */
const DEFAULT_MAX_TEXT_LENGTH = 2000;
const DEFAULT_MAX_MESSAGES = 40;

/** A captured URL is a pointer, not a payload: 200 characters place it and no more. */
const MAX_URL_LENGTH = 200;

/**
 * How far past `maxTextLength` the masking patterns are run before the text is cut.
 *
 * A retrieved document reaches a prompt whole, and scanning megabytes of it would put the
 * profiler on the latency budget of the call it is describing. Only the first `maxTextLength`
 * characters are ever stored, and this margin is wider than the longest pattern (a PEM block, at
 * 8 KiB), so a credential that starts inside what is kept is matched in full — what lies beyond
 * the margin is dropped by the truncation anyway.
 */
const REDACTION_MARGIN = 12288;

/** Matches nothing: how the built-in sensitive-key pattern is switched off. */
const NEVER = /(?!)/;

/**
 * Personal data the credential detectors miss. Quantifiers are upper-bounded, like the core's own
 * patterns: these run over uncontrolled text, and an unbounded one is a ReDoS vector.
 *
 * Only unambiguous shapes: an international phone number carries its `+`, a card-shaped number is
 * left to the core's Luhn check. A local phone number or a postal address is not detectable
 * without mangling ordinary text, and a redactor that mangles real data is one somebody switches
 * off.
 */
export const AI_PII_PATTERNS: readonly RegExp[] = [
  /\b[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\.){1,8}[A-Za-z]{2,24}\b/g,
  /\+\d[\d .()-]{6,18}\d/g,
  /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g,
  /\b\d{3}-\d{2}-\d{4}\b/g,
];

/** The capture settings as the hot path needs them: levels looked up, patterns merged once. */
interface ResolvedCapture {
  levels: Record<AiCaptureField, AiCaptureLevel>;
  maxTextLength: number;
  maxMessages: number;
  /** Options for {@link redactString} over free text. */
  stringOptions: RedactStringOptions;
  /** Options for {@link redact} over payloads: keys masked, string values scanned. */
  valueOptions: RedactOptions;
  /** Same, for a JSON Schema: a schema's keys are field *names*, so only its strings are scanned. */
  schemaOptions: RedactOptions;
  maskedQueryParams: ReadonlySet<string>;
  sanitize?: AiSanitizer;
  /**
   * Whether a provider error or warning is masked. Those are never dropped — a failure with no
   * message is unreadable — but a provider happily quotes the offending prompt back at you.
   */
  redactDiagnostics: boolean;
}

/** The group a field belongs to, or `undefined` for one that stands alone. */
function groupOf(field: AiCaptureField): AiCaptureGroup | undefined {
  for (const [group, fields] of Object.entries(AI_CAPTURE_GROUPS)) {
    if ((fields as readonly AiCaptureField[]).includes(field)) return group as AiCaptureGroup;
  }
  return undefined;
}

function resolveLevels(settings: AiCaptureSettings): Record<AiCaptureField, AiCaptureLevel> {
  const { capture, captureContent } = settings;
  const legacy: AiCaptureLevel | undefined =
    captureContent === undefined ? undefined : captureContent ? 'redacted' : 'none';
  const perField = typeof capture === 'object' ? capture : undefined;
  const fallback: AiCaptureLevel =
    (typeof capture === 'string' ? capture : perField?.default) ?? legacy ?? 'redacted';

  const levels = {} as Record<AiCaptureField, AiCaptureLevel>;
  for (const field of AI_CAPTURE_FIELDS) {
    const group = groupOf(field);
    levels[field] =
      perField?.[field] ?? (group !== undefined ? perField?.[group] : undefined) ?? fallback;
  }
  // The runtime context is the application's own state, not what was said, so no blanket level
  // pulls it in: it is recorded only when it is asked for by name.
  levels.runtimeContext = perField?.runtimeContext ?? 'none';
  return levels;
}

function resolve(settings: AiCaptureSettings): ResolvedCapture {
  const redaction = settings.redaction ?? {};
  const replacement = redaction.replacement ?? REDACTED;
  const patterns = [
    ...(redaction.pii === false ? [] : AI_PII_PATTERNS),
    ...(redaction.patterns ?? []),
  ];
  const levels = resolveLevels(settings);
  const valueOptions: RedactOptions = {
    maskKeys: redaction.keys ?? [],
    patterns,
    replacement,
    ...(redaction.useDefaults === false && { keyPattern: NEVER }),
  };

  return {
    levels,
    maxTextLength: settings.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH,
    maxMessages: settings.maxMessages ?? DEFAULT_MAX_MESSAGES,
    stringOptions: { patterns, replacement },
    valueOptions,
    schemaOptions: { ...valueOptions, keyPattern: NEVER },
    maskedQueryParams: buildMaskedQueryParams(DEFAULT_MASK_QUERY_PARAMS),
    ...(redaction.sanitize !== undefined && { sanitize: redaction.sanitize }),
    // The runtime context is out of this: it is forced to `none` by default, and a host that
    // asked for everything verbatim must not find its error messages masked because of it.
    redactDiagnostics: AI_CAPTURE_FIELDS.filter((field) => field !== 'runtimeContext').some(
      (field) => levels[field] !== 'full',
    ),
  };
}

let settings: AiCaptureSettings = {};
let resolved: ResolvedCapture = resolve(settings);

/**
 * Applies the module's capture settings, merged over the ones already in force.
 *
 * Module-scoped rather than threaded through every helper: the telemetry integration is a
 * process-wide singleton (`registerTelemetry` is), so there is exactly one configuration to hold.
 */
export function configureAiCapture(next: AiCaptureSettings): void {
  settings = { ...settings, ...next };
  resolved = resolve(settings);
}

/** Restores the defaults — every field `redacted`, built-in masking on. */
export function resetAiCapture(): void {
  settings = {};
  resolved = resolve(settings);
}

/** The level in force per field, recorded on the profile so a reader knows what is missing. */
export function aiCaptureLevels(): Readonly<Record<AiCaptureField, AiCaptureLevel>> {
  return resolved.levels;
}

/** The level in force for one field. */
export function captureLevelOf(field: AiCaptureField): AiCaptureLevel {
  return resolved.levels[field];
}

/** Messages kept per call, counted from the most recent. */
export function maxCapturedMessages(): number {
  return resolved.maxMessages;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Keeps one text inside `maxTextLength`. */
export function boundText(text: string): string {
  const max = resolved.maxTextLength;
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** Keeps an arbitrary payload (a tool input, a tool result) inside a bounded size. */
function boundValue(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === 'string') return boundText(value);
  try {
    const max = resolved.maxTextLength * 2;
    const json = JSON.stringify(value);
    return json !== undefined && json.length > max ? `${json.slice(0, max)}…` : value;
  } catch {
    return '[unserializable]';
  }
}

const omitted = (what: string, detail?: string): string =>
  detail === undefined ? `[${what} omitted]` : `[${what} omitted · ${detail}]`;

/**
 * What a payload was, without what it held. The keys are named because a key is a field name from
 * the application's own schema — what makes a trace readable — while the values are its data.
 */
function describeShape(value: unknown): string {
  if (typeof value === 'string') return omitted('text', `${value.length} chars`);
  if (Array.isArray(value)) return omitted('array', `${value.length} items`);
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return omitted('object', 'no keys');
    const named = keys.slice(0, 12).join(', ');
    return omitted('object', `keys: ${named}${keys.length > 12 ? ', …' : ''}`);
  }
  return omitted(typeof value);
}

/** Runs the host's scrubber over every string of an already-masked payload. */
function sanitizeDeep(value: unknown, context: AiRedactionContext, depth = 0): unknown {
  const { sanitize } = resolved;
  if (sanitize === undefined || depth >= 8) return value;
  if (typeof value === 'string') return sanitize(value, context);
  if (Array.isArray(value)) return value.map((item) => sanitizeDeep(item, context, depth + 1));
  if (isRecord(value) && Object.getPrototypeOf(value) === Object.prototype) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = sanitizeDeep(entry, context, depth + 1);
    }
    return result;
  }
  return value;
}

/** Runs the host's scrubber over one text, when there is one. */
function scrub(text: string, context: AiRedactionContext): string {
  return resolved.sanitize === undefined ? text : resolved.sanitize(text, context);
}

/**
 * One captured text — a prompt, a completion, a reasoning block — at the level its field is set
 * to. `undefined` means the level dropped it, and the caller omits the field entirely.
 *
 * Masking runs over the whole text before it is truncated, so a credential cannot survive by
 * straddling the cut.
 */
export function captureText(
  text: string | undefined,
  field: AiCaptureField,
  origin: AiCaptureOrigin = {},
): string | undefined {
  if (text === undefined || text === '') return undefined;
  const level = resolved.levels[field];
  if (level === 'none') return undefined;
  if (level === 'metadata') return omitted('text', `${text.length} chars`);
  const window = resolved.maxTextLength + REDACTION_MARGIN;
  const scanned = level === 'full' || text.length <= window ? text : text.slice(0, window);
  const masked = level === 'full' ? scanned : redactString(scanned, resolved.stringOptions);
  return boundText(scrub(masked, { field, ...origin }));
}

/**
 * One captured payload — a tool input, a tool result, a structured output — at the level its
 * field is set to. Object keys that name a secret are masked as well as values that look like
 * one, which a free text cannot be checked for.
 */
export function captureValue(
  value: unknown,
  field: AiCaptureField,
  origin: AiCaptureOrigin = {},
): unknown {
  const level = resolved.levels[field];
  if (level === 'none') return undefined;
  if (value === undefined || value === null) return value;
  // A lone string is a text, and goes through the text path so a huge one is not scanned whole.
  if (typeof value === 'string') return value === '' ? '' : captureText(value, field, origin);
  if (level === 'metadata') return describeShape(value);
  const masked = level === 'full' ? value : redact(value, resolved.valueOptions);
  return boundValue(sanitizeDeep(masked, { field, ...origin }));
}

/**
 * A JSON Schema — a tool's input schema, the shape `generateObject` had to fill. Its keys are
 * field *names* declared in this codebase, so masking by key name would rewrite the schema rather
 * than protect anything; only its string values are scanned, in case an example carries a secret.
 */
export function captureSchema(value: unknown, field: AiCaptureField): unknown {
  const level = resolved.levels[field];
  if (level === 'none' || level === 'metadata') return undefined;
  if (value === undefined || value === null) return value;
  const masked = level === 'full' ? value : redact(value, resolved.schemaOptions);
  return boundValue(sanitizeDeep(masked, { field }));
}

/**
 * Where an attachment was pointed at. A signed URL carries its credential in the query string, so
 * the sensitive parameters go the way they go on a captured request URL.
 */
export function captureUrl(url: string, field: AiCaptureField): string | undefined {
  const level = resolved.levels[field];
  if (level === 'none') return undefined;
  if (level === 'metadata') return omitted('url');
  if (level === 'full') return url.slice(0, MAX_URL_LENGTH);
  const replacement = resolved.stringOptions.replacement;
  const query = redactQueryString(url, resolved.maskedQueryParams, replacement);
  return redactString(query, resolved.stringOptions).slice(0, MAX_URL_LENGTH);
}

/**
 * A provider error or warning. Never dropped — a failure with no message is unreadable — but
 * masked like everything else, since a provider quotes the offending prompt back at you.
 */
export function captureDiagnostic(text: string): string {
  const masked = resolved.redactDiagnostics ? redactString(text, resolved.stringOptions) : text;
  return boundText(scrub(masked, { field: 'error' }));
}
