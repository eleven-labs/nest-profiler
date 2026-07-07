export { HttpCollectorModule } from './http-collector.module';
export type {
  HttpCollectorModuleOptions,
  HttpCollectorModuleAsyncOptions,
} from './http-collector.module';
export { HTTP_COLLECTOR_OPTIONS, HTTP_INSTRUMENTATIONS } from './http-collector.constants';
export { HttpProfilerRecorder } from './http-profiler-recorder.service';
export { HttpClientCollector } from './http-client.collector';
export type { HttpInstrumentation } from './http-instrumentation.interface';
export { appendHttpRequestEntry } from './append-http-request-entry.util';
export { HTTP_CLIENT_REQUESTS_KEY } from './http-request.interface';
export type {
  HttpRequestEntry,
  HttpCaptureInput,
  HttpCaptureOptions,
} from './http-request.interface';
export { DEFAULT_MASK_HEADERS, extractHeaders, formatHeaderValue } from './http-redaction.util';

// Client adapters are NOT re-exported here — importing this barrel must never pull in a client
// library. Select an adapter from its subpath instead:
//   import { AxiosInstrumentation } from '@eleven-labs/nest-profiler-http/axios';
//   import { FetchInstrumentation } from '@eleven-labs/nest-profiler-http/fetch';
