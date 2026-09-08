export type CacheOperation = 'GET_HIT' | 'GET_MISS' | 'SET' | 'DEL';

export interface CacheOperationEntry {
  operation: CacheOperation;
  key: string;
  duration: number;
  startedAt: number;
  /**
   * The trace span open when this entry was captured (see the core's `TaggableEntry`). Stamped by
   * `appendCollectorEntry`; it nests this call under the `tracer.span()` that issued it.
   */
  parentSpanId?: string;
  /** Error message when the underlying cache operation rejected (a cache backend failure). */
  error?: string;
}

export const CACHE_OPERATIONS_KEY = '__cache_operations';
