import type { TraceSpanStatus } from '@eleven-labs/nest-profiler';

/** Private `profile.collectors` key where the field middleware accumulates field spans. */
export const GRAPHQL_FIELD_SPANS_KEY = '__graphql_field_spans';

/** One `resolveField` invocation, captured by the field middleware and drained into the trace. */
export interface GraphqlFieldSpan {
  id: string;
  /** The enclosing field span's id (or undefined at the top level). */
  parentId?: string;
  label: string;
  startedAt: number;
  duration: number;
  status: TraceSpanStatus;
}
