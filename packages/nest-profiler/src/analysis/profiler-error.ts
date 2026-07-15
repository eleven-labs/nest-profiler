import type { ExceptionEntry, Profile } from '../interfaces/profile.interface';
import type { TagSeverity } from './profiler-tag.interface';
import type { TaggableEntry } from './taggable-collector.interface';

/** Status at or above which a response is a failure when no `httpStatus` is configured. */
const DEFAULT_ERROR_STATUS = 500;

/**
 * The view of a profile handed to a {@link ProfilerErrorOptions.classify} predicate. The
 * pre-extracted fields cover the common cases; `profile` is the escape hatch for anything
 * kind-specific (a command's exit code, a message's redelivery flag…).
 */
export interface ProfileErrorInfo {
  /** Entrypoint kind — `http`, `graphql`, `command`, `rabbitmq`… */
  readonly type: string;
  /** The response status, when this kind produced one. */
  readonly statusCode?: number;
  /** The exceptions captured on the profile (GraphQL errors included). */
  readonly exceptions: readonly ExceptionEntry[];
  /** The full profile, for anything the fields above do not cover. */
  readonly profile: Profile;
}

/**
 * How an entrypoint kind decides that a profile **failed** — what earns the `error` tag and
 * what the list's `Errors` checkbox keeps.
 *
 * The layers are resolved in order and **the first that applies is decisive**:
 *
 * 1. {@link classify} — returning a boolean settles it; `undefined` defers to the next layer.
 * 2. {@link httpStatus} — when the profile carries a status and the layer is enabled, that
 *    status decides **on its own**. A 404 is not an error even though the `NotFoundException`
 *    behind it was captured: for a kind that answers with a status, the status *is* the verdict,
 *    and consulting the exceptions too would contradict it.
 * 3. {@link exceptions} — the fallback for kinds that carry no status (a consumed message), and
 *    for the kinds that disable layer 2 because their status says nothing about success (GraphQL
 *    answers `200` with the failure inside `errors`).
 *
 * The defaults — a 5xx status, or an exception when there is no status — mean 4xx responses like
 * `401`/`403`/`404` are **not** errors. Applications that consider them errors opt in with
 * `error: { httpStatus: 400 }`.
 */
export interface ProfilerErrorOptions {
  /**
   * Which statuses are failures: a lower bound (`code >= n`) or a predicate. Default: `500`.
   * Set to `false` to disable the layer entirely, so the verdict comes from {@link exceptions} —
   * what the `graphql` kind does, its transport status being `200` even for a failed operation.
   */
  readonly httpStatus?: number | ((statusCode: number) => boolean) | false;
  /**
   * Restricts the {@link exceptions} layer to these error codes ({@link ExceptionEntry.code}).
   * An exception carrying **no** code always counts — an unmapped throw is a genuine failure.
   * Mostly useful for GraphQL, whose `extensions.code` is its equivalent of a status.
   */
  readonly codes?: readonly string[];
  /**
   * Whether a captured exception is a failure: `false` disables the layer, a list of class
   * names ({@link ExceptionEntry.name}) restricts it, or a predicate decides per exception.
   * Default: `true`.
   */
  readonly exceptions?: boolean | readonly string[] | ((exception: ExceptionEntry) => boolean);
  /**
   * Decides any profile of this kind up front. Return a boolean to settle it, or `undefined`
   * to defer to {@link httpStatus}/{@link exceptions}.
   */
  readonly classify?: (info: ProfileErrorInfo) => boolean | undefined;
  /** Severity of the `error` tag on this kind. Default: `'danger'`. */
  readonly severity?: TagSeverity;
}

/**
 * How a collector decides that one of its **entries** — an outgoing HTTP call, a SQL query —
 * failed. Same shape as {@link ProfilerErrorOptions}, minus the exception layers: an entry
 * carries its own {@link TaggableEntry.error} instead.
 */
export interface EntryErrorOptions {
  /**
   * Which statuses are failures for an entry that has one: a lower bound (`code >= n`) or a
   * predicate. Default: `500` — a 404 from an API you call is not, by itself, a failure of the
   * call. Set to `false` to ignore statuses entirely.
   */
  readonly httpStatus?: number | ((statusCode: number) => boolean) | false;
  /** Decides an entry up front. Return `undefined` to defer to the layers above. */
  readonly classify?: (entry: TaggableEntry) => boolean | undefined;
  /** Severity of the `error` tag on this collector's entries. Default: `'danger'`. */
  readonly severity?: TagSeverity;
}

/** Structural view of an entry that carries a response status (an outgoing HTTP call). */
interface StatusBearingEntry extends TaggableEntry {
  statusCode?: number;
}

/** Turns the `httpStatus` layer into a predicate; `undefined` when the layer is off. */
function statusPredicate(
  httpStatus: number | ((statusCode: number) => boolean) | false | undefined,
): ((statusCode: number) => boolean) | undefined {
  if (httpStatus === false) return undefined;
  if (typeof httpStatus === 'function') return httpStatus;
  const floor = httpStatus ?? DEFAULT_ERROR_STATUS;
  return (statusCode) => statusCode >= floor;
}

/** Whether one exception counts, per the `exceptions` and `codes` layers. */
function exceptionCounts(
  exception: ExceptionEntry,
  exceptions: ProfilerErrorOptions['exceptions'],
  codes: readonly string[] | undefined,
): boolean {
  if (exceptions === false) return false;
  if (typeof exceptions === 'function') {
    if (!exceptions(exception)) return false;
  } else if (Array.isArray(exceptions) && !exceptions.includes(exception.name)) {
    return false;
  }
  // An exception with no code is an unmapped throw — a genuine failure, never filtered out.
  if (codes && exception.code !== undefined && !codes.includes(exception.code)) return false;
  return true;
}

/**
 * Resolves a kind's {@link ProfilerErrorOptions} into the predicate the `error` tag and the
 * `Errors` filter run on. `defaults` carries the kind's own baseline (GraphQL disables the
 * status layer and keys on `codes`); the host's `options` override it key by key.
 */
export function resolveProfileErrorClassifier(
  options?: ProfilerErrorOptions,
  defaults?: ProfilerErrorOptions,
): (profile: Profile) => boolean {
  // Key-by-key rather than a spread: an explicit `undefined` in `options` must not blank out
  // the kind's default.
  const httpStatus = options?.httpStatus ?? defaults?.httpStatus;
  const codes = options?.codes ?? defaults?.codes;
  const exceptions = options?.exceptions ?? defaults?.exceptions ?? true;
  const classify = options?.classify ?? defaults?.classify;
  const matchesStatus = statusPredicate(httpStatus);

  return (profile) => {
    if (classify) {
      const verdict = classify({
        type: profile.entrypoint.type,
        statusCode: profile.response?.statusCode,
        exceptions: profile.exceptions,
        profile,
      });
      if (verdict !== undefined) return verdict;
    }

    const statusCode = profile.response?.statusCode;
    if (matchesStatus && statusCode !== undefined) return matchesStatus(statusCode);

    return profile.exceptions.some((e) => exceptionCounts(e, exceptions, codes));
  };
}

/** Resolves the severity of the `error` tag for a kind or a collector. */
export function resolveErrorSeverity(
  options?: { severity?: TagSeverity },
  defaults?: { severity?: TagSeverity },
): TagSeverity {
  return options?.severity ?? defaults?.severity ?? 'danger';
}

/**
 * Resolves a collector's {@link EntryErrorOptions} into the predicate the `error` tag runs on
 * for its entries. An entry carrying an {@link TaggableEntry.error} always counts — a call that
 * threw never reached a status to be judged on.
 */
export function resolveEntryErrorClassifier(
  options?: EntryErrorOptions,
): (entry: TaggableEntry) => boolean {
  const matchesStatus = statusPredicate(options?.httpStatus);
  const { classify } = options ?? {};

  return (entry) => {
    if (classify) {
      const verdict = classify(entry);
      if (verdict !== undefined) return verdict;
    }
    if (entry.error != null) return true;
    const { statusCode } = entry as StatusBearingEntry;
    return matchesStatus !== undefined && statusCode !== undefined && matchesStatus(statusCode);
  };
}
