export interface MongooseQueryEntry {
  collection: string;
  operation: string;
  filter?: Record<string, unknown>;
  duration: number;
  isSlow: boolean;
  startedAt: number;
  count?: number;
  error?: string;
}

export const MONGOOSE_QUERIES_KEY = '__mongoose_queries';
