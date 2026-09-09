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
export type { HttpPhases, HttpPhaseName } from './http-phases.interface';
export {
  HTTP_PHASE_SEQUENCE,
  HTTP_PHASE_LABELS,
  HTTP_PHASE_HINTS,
  sumHttpPhases,
  hasHttpPhases,
  formatPhaseDuration,
} from './http-phases.interface';
export { readHttpPhases } from './phases/read-http-phases';
export { instrumentClientRequest, phasesOfClientRequest } from './phases/client-request-timer';
export {
  openPhaseSlot,
  activePhaseSlot,
  phaseSlotsEnabled,
  registerPhaseSlotProvider,
} from './phases/phase-slot';
export type { HttpPhaseSlot } from './phases/phase-slot';
export { DEFAULT_MASK_HEADERS, extractHeaders, formatHeaderValue } from './http-redaction.util';
export {
  DEFAULT_MASK_QUERY_PARAMS,
  redactQueryString,
  resolveMaskedQueryParams,
} from './http-redaction.util';

// Client adapters are NOT re-exported here — importing this barrel must never pull in a client
// library. Select an adapter from its subpath instead:
//   import { AxiosInstrumentation } from '@eleven-labs/nest-profiler-http/axios';
//   import { FetchInstrumentation } from '@eleven-labs/nest-profiler-http/fetch';
//
// The phases providers patch a Node builtin / subscribe to diagnostics channels, so they are
// selected the same explicit way:
//   import { NodeHttpPhases, UndiciPhases } from '@eleven-labs/nest-profiler-http/phases';
