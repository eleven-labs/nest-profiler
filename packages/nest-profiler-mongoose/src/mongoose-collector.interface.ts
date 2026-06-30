export interface MongooseQueryEntry {
  collection: string;
  operation: string;
  filter?: Record<string, unknown>;
  /** Aggregation pipeline stages, captured for `aggregate` operations. */
  pipeline?: unknown[];
  duration: number;
  isSlow: boolean;
  startedAt: number;
  count?: number;
  error?: string;
  /** Runnable mongosh command, precomputed by the collector for the UI copy button. */
  command?: string;
}

export const MONGOOSE_QUERIES_KEY = '__mongoose_queries';
