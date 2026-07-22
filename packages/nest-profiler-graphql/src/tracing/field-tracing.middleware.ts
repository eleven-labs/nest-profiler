import { ClsServiceManager } from 'nestjs-cls';
import type { ClsService } from 'nestjs-cls';
import type { FieldMiddleware } from '@nestjs/graphql';
import { getNamedType, isCompositeType } from 'graphql';
import type { GraphQLResolveInfo } from 'graphql';
import {
  appendCollectorEntry,
  nowMs,
  PROFILER_CLS_KEYS,
  readActiveSpanId,
  sinceMs,
  TRACE_ROOT_ID,
} from '@eleven-labs/nest-profiler';
import type { Profile, TraceSpanStatus } from '@eleven-labs/nest-profiler';
import { GRAPHQL_FIELD_SPANS_KEY } from './graphql-field-span';

export interface FieldTracingOptions {
  /**
   * Which fields open a span. `'object'` (default) — fields returning a composite type
   * (object/interface/union) or resolved on a root operation type, where DB/HTTP fan-out and
   * N+1 live. `'all'` — every field, including scalar leaves. A predicate — full control.
   */
  traceFields?: 'object' | 'all' | ((info: GraphQLResolveInfo) => boolean);
  /** Drop field spans shorter than this (ms) to cut noise. Default: 0 (keep all). */
  minFieldMs?: number;
}

function makeFilter(
  traceFields: FieldTracingOptions['traceFields'],
): (info: GraphQLResolveInfo) => boolean {
  if (typeof traceFields === 'function') return traceFields;
  if (traceFields === 'all') return (info) => !info.fieldName.startsWith('__');
  return (info) => {
    if (info.fieldName.startsWith('__')) return false;
    if (isCompositeType(getNamedType(info.returnType))) return true;
    const schema = info.schema;
    return (
      info.parentType === schema.getQueryType() ||
      info.parentType === schema.getMutationType() ||
      info.parentType === schema.getSubscriptionType()
    );
  };
}

let counter = 0;

/**
 * A `@nestjs/graphql` field middleware timing each `resolveField` as a `graphql-field`
 * trace span. It runs the resolver inside a nested CLS scope carrying the span's id, so the
 * DB/HTTP calls it issues stamp it as their parent — giving deterministic nesting even when
 * sibling fields resolve in parallel. Wire it into `GraphQLModule.forRoot` via
 * `buildSchemaOptions.fieldMiddleware` (code-first only).
 *
 * `cls` is optional: omit it and the shared `nestjs-cls` instance is used, so the host can wire
 * this into `GraphQLModule.forRoot` without resolving `ClsService` from DI. With the profiler
 * off there is no active store, so every field passes straight through.
 */
export function createProfilerFieldMiddleware(
  cls?: ClsService,
  options: FieldTracingOptions = {},
): FieldMiddleware {
  const shouldTrace = makeFilter(options.traceFields);
  const minMs = options.minFieldMs ?? 0;
  const clsOf = (): ClsService => cls ?? ClsServiceManager.getClsService();

  return (mw, next): unknown => {
    const store = clsOf();
    let profile: Profile | undefined;
    try {
      profile = store.get<Profile | undefined>(PROFILER_CLS_KEYS.profile);
    } catch {
      // Outside a CLS context — nothing to trace.
    }
    if (!profile || !shouldTrace(mw.info)) return next() as unknown;
    const activeProfile = profile;

    // Explicit parent — the enclosing field span, else the root. Never left undefined, so
    // sibling fields resolving in parallel are not chained together by time containment.
    const parentId = readActiveSpanId(store) ?? TRACE_ROOT_ID;
    const spanId = `gqlfield-${Date.now().toString(36)}-${counter++}`;
    const startedAt = nowMs();
    const label = `${mw.info.parentType.name}.${mw.info.fieldName}`;

    return store.run({ ifNested: 'inherit' }, async (): Promise<unknown> => {
      store.set(PROFILER_CLS_KEYS.activeSpanId, spanId);
      let status: TraceSpanStatus = 'ok';
      try {
        return (await next()) as unknown;
      } catch (err) {
        status = 'error';
        throw err;
      } finally {
        const duration = sinceMs(startedAt);
        if (duration >= minMs) {
          appendCollectorEntry(activeProfile, GRAPHQL_FIELD_SPANS_KEY, {
            id: spanId,
            parentId,
            label,
            startedAt,
            duration,
            status,
          });
        }
      }
    });
  };
}
