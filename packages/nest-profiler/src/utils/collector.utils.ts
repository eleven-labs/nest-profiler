import { ClsServiceManager } from 'nestjs-cls';
import { PROFILER_CLS_KEYS } from '../constants';
import type { Profile } from '../interfaces/profile.interface';

/**
 * Returns the typed collector entries array for the given key.
 * Returns an empty array if no entries exist yet.
 */
export function getCollectorEntries<T>(profile: Profile, key: string): T[] {
  const raw = profile.collectors[key];
  return Array.isArray(raw) ? (raw as T[]) : [];
}

/**
 * Appends a single entry to the collector list, initialising the array on first call, and stamps
 * the entry with the trace span that was open when it was captured.
 *
 * Every instrumentation in every package funnels through here — the SQL drivers, the Mongoose
 * connection, the MikroORM logger, the cache manager, the HTTP clients, the RabbitMQ publisher,
 * the validation pipe. That is why the parent is resolved *here* rather than at each call site:
 * one place to be right, and no package has to remember to pass anything.
 *
 * The span id is read from the process-wide CLS singleton rather than from an injected service,
 * which is what makes the stamping free at the call sites. It is also the correct source: the
 * active span is a property of the async context the capture happens in, and nothing else. A
 * capture outside any span is stamped with nothing and nests by time containment instead.
 */
export function appendCollectorEntry<T>(profile: Profile, key: string, entry: T): void {
  const list = getCollectorEntries<T>(profile, key);
  if (!Array.isArray(profile.collectors[key])) {
    profile.collectors[key] = list;
  }
  const parentSpanId = activeSpanId();
  if (parentSpanId !== undefined && isRecord(entry)) {
    (entry as Record<string, unknown>).parentSpanId ??= parentSpanId;
  }
  list.push(entry);
}

/**
 * The id of the span currently open, or `undefined` outside one.
 *
 * Never throws: reading the store outside an active CLS context does, and a capture must not fail
 * because the profiler could not work out where to file it.
 */
function activeSpanId(): string | undefined {
  try {
    return ClsServiceManager.getClsService().get<string | undefined>(
      PROFILER_CLS_KEYS.activeSpanId,
    );
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
