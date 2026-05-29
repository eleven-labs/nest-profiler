export interface HttpRequestEntry {
  method: string;
  url: string;
  statusCode?: number;
  duration: number;
  startedAt: number;
  error?: string;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  responseHeaders?: Record<string, string>;
  responseBody?: unknown;
}

export const AXIOS_REQUESTS_KEY = '__axios_requests';
export const AXIOS_COLLECTOR_OPTIONS = Symbol('AXIOS_COLLECTOR_OPTIONS');

export const DEFAULT_MASK_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization',
];
