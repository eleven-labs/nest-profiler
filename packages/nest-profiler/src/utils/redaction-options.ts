/**
 * Shared masking-option shapes, declared once so collector packages `extends`/`Pick` from
 * them instead of redeclaring the same field, type and TSDoc — the same pattern as
 * {@link CollectorModuleOptions} and {@link TagSeverityOptions} in
 * `collectors/collector-module-options.ts`.
 */

/** A package that redacts object keys through {@link redact} accepts this. */
export interface RedactionKeyOptions {
  /** Extra object-key names (case-insensitive) whose value is masked, on top of the built-in sensitive-key pattern. */
  maskKeys?: string[];
}

/** A package that redacts request/message headers accepts this. */
export interface RedactionHeaderOptions {
  /**
   * Extra header names (case-insensitive) whose value is replaced with `[REDACTED]`. **Merged
   * with** the built-in sensitive-header list — naming one here never stops the built-ins from
   * being masked.
   */
  maskHeaders?: string[];
}

/** A package that redacts a captured URL's query string accepts this. */
export interface RedactionQueryParamOptions {
  /**
   * Extra query-parameter names (case-insensitive, `-`/`_` insensitive) whose value is replaced
   * with `[REDACTED]`. **Merged with** the built-in sensitive list; drop it entirely with
   * {@link useDefaultMaskQueryParams}.
   */
  maskQueryParams?: string[];
  /** Mask the built-in sensitive query parameters on top of {@link maskQueryParams}. Default: `true`. */
  useDefaultMaskQueryParams?: boolean;
}

/**
 * Unified redaction configuration for the core module: one block covering every capture path
 * (headers, cookies, query string, object keys) instead of a scattered option per path. Every
 * list is **additive** over the built-ins unless {@link useDefaults} is set to `false`.
 */
export interface ProfilerRedactionOptions {
  /**
   * Apply every built-in default **list** (sensitive headers, query parameters and the
   * object-key pattern) on top of the lists below. Default: `true`. Set to `false` to take
   * masking over entirely — a captured `authorization` header or a password-reset token is a
   * replayable credential for as long as the profile lives, so opting out is deliberate and
   * total.
   *
   * The built-in **value** detectors (JWTs, PEM blocks, `sk-`/`pk-` keys, `scheme://user:pass@`
   * userinfo, Luhn-valid card numbers) are not a list you can restate name by name, and stay on
   * either way.
   */
  useDefaults?: boolean;
  /** Extra header names (case-insensitive) to mask, merged with the built-ins. */
  headers?: string[];
  /** Cookie names whose value should be replaced. */
  cookies?: string[];
  /** Extra query-parameter names (case-insensitive, `-`/`_` insensitive) to mask, merged with the built-ins. */
  queryParams?: string[];
  /** Extra object-key names (case-insensitive) to mask in bodies, session data and collector payloads. */
  keys?: string[];
  /** Extra value patterns to redact inside strings, alongside the built-in ones (DSN/JWT/API key/PEM/card). */
  patterns?: RegExp[];
  /** Sentinel written in place of a redacted value. Default `'[REDACTED]'`. */
  replacement?: string;
}
