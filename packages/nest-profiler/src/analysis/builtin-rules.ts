import type { PerformanceRule } from './performance-rule.interface';
import { BUILTIN_TAG_IDS } from './profiler-tag.interface';
import type { TaggableEntry } from './taggable-collector.interface';

/** Fallback `chattyThreshold` when a collector exposes none, per domain. */
const DEFAULT_CHATTY_THRESHOLD: Record<string, number> = { query: 20, http: 10 };
const DEFAULT_CHATTY_FALLBACK = 20;

/** Structural view of an HTTP entry — the fields the error/payload rules read. */
interface HttpLikeEntry extends TaggableEntry {
  statusCode?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: unknown;
  responseBody?: unknown;
}

/** Flags any call at or above the collector's `slowThreshold`. */
export const slowRule: PerformanceRule = {
  id: BUILTIN_TAG_IDS.slow,
  evaluate(ctx) {
    for (const { entries, config } of ctx.collectors) {
      for (const entry of entries) {
        if (entry.duration >= config.slowThreshold) {
          ctx.tagEntry(entry, {
            id: BUILTIN_TAG_IDS.slow,
            label: 'Slow',
            severity: 'warning',
            detail: `${entry.duration}ms ≥ ${config.slowThreshold}ms threshold`,
          });
        }
      }
    }
  },
};

/**
 * Groups a collector's entries by `fingerprint` and flags every group repeated at
 * least `nPlusOneThreshold` times — the N+1 anti-pattern, whether it is repeated
 * SQL/Mongo queries or repeated outgoing HTTP calls. The pill reads `N+1 ×5`.
 */
export const nPlusOneRule: PerformanceRule = {
  id: BUILTIN_TAG_IDS.nPlusOne,
  evaluate(ctx) {
    for (const { entries, config, domain } of ctx.collectors) {
      const threshold = Math.max(2, config.nPlusOneThreshold);
      const groups = new Map<string, TaggableEntry[]>();
      for (const entry of entries) {
        if (!entry.fingerprint) continue;
        const group = groups.get(entry.fingerprint) ?? [];
        group.push(entry);
        groups.set(entry.fingerprint, group);
      }
      // Repeated identical calls are the N+1 anti-pattern in every domain — same label
      // for SQL/Mongo queries and outgoing HTTP calls ("N+1 API calls").
      const subject = domain === 'http' ? 'request' : 'query';
      for (const group of groups.values()) {
        if (group.length < threshold) continue;
        const label = `N+1 ×${group.length}`;
        const detail = `Same ${subject} executed ${group.length} times`;
        for (const entry of group) {
          ctx.tagEntry(entry, {
            id: BUILTIN_TAG_IDS.nPlusOne,
            label,
            severity: 'danger',
            count: group.length,
            detail,
          });
        }
        ctx.tagProfile({
          id: BUILTIN_TAG_IDS.nPlusOne,
          label: 'N+1',
          severity: 'danger',
          count: group.length,
        });
      }
    }
  },
};

/**
 * Flags failed calls — any entry carrying an `error`, or an HTTP entry with a
 * status ≥ 400 — and tags the profile when it carries unhandled exceptions. This
 * unifies the former dedicated "exceptions" list filter into the tag system.
 */
export const errorRule: PerformanceRule = {
  id: BUILTIN_TAG_IDS.error,
  evaluate(ctx) {
    for (const { entries } of ctx.collectors) {
      for (const entry of entries) {
        const statusCode = (entry as HttpLikeEntry).statusCode;
        const failed = entry.error != null || (typeof statusCode === 'number' && statusCode >= 400);
        if (failed) {
          ctx.tagEntry(entry, {
            id: BUILTIN_TAG_IDS.error,
            label: 'Error',
            severity: 'danger',
            detail: entry.error ?? `HTTP ${statusCode}`,
          });
        }
      }
    }
    if (ctx.profile.exceptions.length > 0) {
      ctx.tagProfile({
        id: BUILTIN_TAG_IDS.error,
        label: 'Error',
        severity: 'danger',
        count: ctx.profile.exceptions.length,
      });
    }
  },
};

/** Flags a profile whose call count for a domain reaches its `chattyThreshold`. */
export const chattyRule: PerformanceRule = {
  id: BUILTIN_TAG_IDS.chatty,
  evaluate(ctx) {
    for (const { entries, config, domain } of ctx.collectors) {
      const threshold =
        config.chattyThreshold ?? DEFAULT_CHATTY_THRESHOLD[domain] ?? DEFAULT_CHATTY_FALLBACK;
      if (entries.length >= threshold) {
        ctx.tagProfile({
          id: BUILTIN_TAG_IDS.chatty,
          label: 'Chatty',
          severity: 'warning',
          count: entries.length,
          detail: `${entries.length} ${domain} calls in one request`,
        });
      }
    }
  },
};

/** Byte size of an HTTP call — its `content-length` header, else its serialized body. */
function httpPayloadSize(entry: HttpLikeEntry): number {
  const fromHeader = (headers: Record<string, string> | undefined): number => {
    if (!headers) return 0;
    const key = Object.keys(headers).find((h) => h.toLowerCase() === 'content-length');
    const parsed = key ? Number.parseInt(headers[key] ?? '', 10) : NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  };
  // Plain stringify for a true size measurement — unlike safeStringify, it must not
  // truncate. A non-serializable body throws and falls back to the content-length header.
  const fromBody = (body: unknown): number => {
    if (body == null) return 0;
    try {
      return JSON.stringify(body).length;
    } catch {
      return 0;
    }
  };
  return Math.max(
    fromHeader(entry.responseHeaders),
    fromHeader(entry.requestHeaders),
    fromBody(entry.responseBody),
    fromBody(entry.requestBody),
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

/** Flags an HTTP call whose request/response payload reaches `largePayloadThreshold`. */
export const largePayloadRule: PerformanceRule = {
  id: BUILTIN_TAG_IDS.largePayload,
  evaluate(ctx) {
    for (const { entries, config, domain } of ctx.collectors) {
      if (domain !== 'http') continue;
      const threshold = config.largePayloadThreshold;
      if (threshold == null || threshold <= 0) continue;
      for (const entry of entries) {
        const size = httpPayloadSize(entry);
        if (size >= threshold) {
          ctx.tagEntry(entry, {
            id: BUILTIN_TAG_IDS.largePayload,
            label: 'Large payload',
            severity: 'warning',
            count: size,
            detail: `${formatBytes(size)} payload ≥ ${formatBytes(threshold)}`,
          });
        }
      }
    }
  },
};

/**
 * The performance rules the core evaluates by default, in order. Consumers extend
 * this set via {@link ProfilerCoreService.registerPerformanceRule} or the
 * `performance.rules` module option.
 */
export const BUILTIN_PERFORMANCE_RULES: PerformanceRule[] = [
  slowRule,
  nPlusOneRule,
  errorRule,
  chattyRule,
  largePayloadRule,
];
