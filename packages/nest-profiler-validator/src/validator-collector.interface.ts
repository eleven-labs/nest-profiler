export type ValidationStatus = 'valid' | 'invalid';
export type ValidationSource = 'body' | 'query' | 'param' | 'custom';

export interface ViolationEntry {
  property: string;
  value?: unknown;
  constraints: Record<string, string>;
  children?: ViolationEntry[];
}

export interface ValidationEntry {
  source: ValidationSource;
  dtoClass: string;
  status: ValidationStatus;
  violationCount: number;
  violations: ViolationEntry[];
  timestamp: number;
}

/** Collector key under which validation entries are accumulated on the profile. */
export const VALIDATOR_KEY = '__validator_entries';
