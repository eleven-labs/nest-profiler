import type { ClsService } from 'nestjs-cls';
import { PROFILER_CLS_KEYS } from '../constants';

/**
 * Reads the id of the trace span currently being resolved (a GraphQL field) from the CLS
 * store, or `undefined` outside a field or a CLS context. Never throws — a `cls.get` outside a
 * context is a safe no-op — so instrumentations can call it inline while building an entry.
 */
export function readActiveSpanId(cls: ClsService | undefined): string | undefined {
  try {
    return cls?.get<string | undefined>(PROFILER_CLS_KEYS.activeSpanId);
  } catch {
    return undefined;
  }
}
