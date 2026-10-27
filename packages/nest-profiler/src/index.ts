export { NEST_PROFILER_MODULE_OPTIONS } from './nest-profiler.builder.js';
export type {
  ProfilerModuleAsyncOptions,
  ProfilerModuleOptions,
  ProfilerSecurityOptions,
  ProfilerAuthorize,
  ProfilerAuthContext,
} from './nest-profiler.builder.js';
export { ProfilerModule } from './nest-profiler.module.js';
export { ProfilerGuard } from './guards/profiler.guard.js';
export type { PlatformRequest, PlatformResponse } from './types/http.js';
export { ProfilerNoopModule } from './nest-profiler-noop.module.js';
export { buildCollectorModule } from './collector-module.builder.js';
export type { CollectorModuleShape } from './collector-module.builder.js';
export { TracerService } from './services/tracer.service.js';
export { TraceSpanDelegate } from './trace/trace-span.delegate.js';
export type { SpanOutcome } from './trace/trace-span.delegate.js';
export { DEFAULT_TRACE_ID_HEADER, isAdoptableTraceId } from './trace/trace-id.js';
export type { RawSpan, TraceContributor } from './trace/build-trace.js';
export { Span } from './trace/span.decorator.js';
export { createProfilerInstrument } from './instrument/profiler-instrument.js';
export { markInternal, isInternal } from './instrument/internal-marker.js';
export type { ProfilerInstrumentOptions } from './instrument/profiler-instrument.js';
export { runInSpan, runAsSpanParent } from './trace/run-in-span.js';
export { entriesToSpans } from './trace/entries-to-spans.js';
export type { EntrySpanOptions } from './trace/entries-to-spans.js';
export {
  createProfilerLogger,
  DEFAULT_LOG_METHODS,
  parseLogArgs,
} from './services/profiler-logger-adapter.js';
export type {
  LogArgsParser,
  LogMethodMap,
  ParsedLogCall,
  ProfilerLoggerOptions,
} from './services/profiler-logger-adapter.js';
export { ProfilerStorageService } from './services/profiler-storage.service.js';
export { ProfilerCoreService } from './services/profiler-core.service.js';
export { TemplateRendererService } from './services/template-renderer.service.js';
export {
  ClientAssetRegistry,
  CORE_CLIENT_SCRIPT,
} from './services/client-asset-registry.service.js';
export type { ClientAssetRegistration } from './services/client-asset-registry.service.js';
export { CollectorRegistry } from './collectors/collector-registry.service.js';
export type {
  CollectorPanelInfo,
  GlobalPanelInfo,
} from './collectors/collector-registry.service.js';
export { ProfilerCollector } from './collectors/collector.decorator.js';
export type { ProfilerCollectorMetadata } from './collectors/collector.decorator.js';
export type {
  GlobalPanelDescriptor,
  IProfilerCollector,
} from './collectors/collector.interface.js';
export { scanHttpRoutes } from './routes/scan-http-routes.js';
export type { ScannedHttpRoute } from './routes/scan-http-routes.js';
export type {
  ProfilerDiscoverSource,
  DiscoverGroup,
  DiscoverEntry,
  DiscoverInputs,
  DiscoverInputGroup,
  DiscoverInputItem,
  DiscoverSection,
  DiscoverSectionItem,
  DiscoverDtoInfo,
  DiscoverDtoProperty,
} from './routes/discover-source.interface.js';
export { AbstractQueryCollector } from './collectors/abstract-query.collector.js';
export { AbstractSqlQueryCollector } from './collectors/sql/abstract-sql-query.collector.js';
export {
  AbstractSchemaCollector,
  SCHEMA_ICON,
} from './collectors/schema/abstract-schema.collector.js';
export { HTTP_ICON } from './views/icons.js';
export type {
  ColumnInfo,
  RelationInfo,
  IndexInfo,
  EntitySchema,
  SchemaCollectorData,
  SchemaDataModel,
} from './collectors/schema/schema.interface.js';
export { detectQueryType } from './collectors/sql/sql-query.interface.js';
export type { QueryEntry, QueryType } from './collectors/sql/sql-query.interface.js';
export { ExplainRunnerRegistry } from './collectors/sql/explain/explain-runner-registry.service.js';
export { parseExplainPlan } from './collectors/sql/explain/parse-explain.js';
export type {
  ExplainDialect,
  ExplainOptions,
  ExplainPlan,
  ExplainRawResult,
  ExplainRunner,
} from './collectors/sql/explain/explain.interface.js';
export { interpolateSql } from './collectors/sql/interpolate-sql.js';
export { formatDuration } from './views/duration.js';
export { buildCurlCommand } from './views/copy/build-curl.js';
export type { CurlInput } from './views/copy/build-curl.js';
export { analyzeProfile } from './analysis/profiler-analyzer.js';
export {
  BUILTIN_TAG_IDS,
  TAG_SEVERITY_RANK,
  maxTagSeverity,
  upsertTag,
} from './analysis/profiler-tag.interface.js';
export type { ProfilerTag, TagSeverity, BuiltinTagId } from './analysis/profiler-tag.interface.js';
export type {
  TaggableCollector,
  TaggableEntry,
  TagConfig,
} from './analysis/taggable-collector.interface.js';
export type {
  AnalyzedCollector,
  PerformanceRule,
  PerformanceRuleContext,
} from './analysis/performance-rule.interface.js';
export { BUILTIN_PERFORMANCE_RULES } from './analysis/builtin-rules.js';
export {
  resolveProfileErrorClassifier,
  resolveEntryErrorClassifier,
  resolveErrorSeverity,
} from './analysis/profiler-error.js';
export type {
  ProfilerErrorOptions,
  EntryErrorOptions,
  ProfileErrorInfo,
} from './analysis/profiler-error.js';
export { normalizeSqlFingerprint, normalizeHttpFingerprint } from './analysis/fingerprint.utils.js';
export type { ProfilerPerformanceOptions } from './nest-profiler.builder.js';
export { PROFILER_STORAGE_ADAPTER } from './storage/storage-adapter.interface.js';
export type { IProfilerStorageAdapter } from './storage/storage-adapter.interface.js';
export { MemoryStorageAdapter } from './storage/memory-storage.adapter.js';
export { getCollectorEntries, appendCollectorEntry } from './utils/collector.utils.js';
export { isPlainObject } from './utils/type.utils.js';
export { toExceptionEntry } from './analysis/to-exception-entry.js';
export type { ExceptionCaptureOptions } from './analysis/to-exception-entry.js';
export type {
  CollectorModuleOptions,
  TagSeverityOptions,
} from './collectors/collector-module-options.js';
export { tryResolve } from './utils/resolve.utils.js';
export {
  readProfile,
  readToken,
  readTraceId,
  readRequest,
  readActiveSpanId,
  setProfileContext,
} from './services/profiler-context.js';
export { monotonicNow } from './utils/clock.utils.js';
export { markProfileStart, completeProfilePerformance } from './utils/profile-metrics.util.js';
export { RuntimeMetricsService } from './runtime/runtime-metrics.service.js';
export { RuntimeCollector } from './runtime/runtime.collector.js';
export type {
  ProfilerRuntimeOptions,
  RuntimeSample,
  RuntimeCollectorData,
  RuntimeHeapStatistics,
  RuntimeProcessInfo,
} from './runtime/runtime-metrics.interface.js';
export { toSafeData, safeStringify, normalizeBody } from './utils/safe-data.utils.js';
export type { SafeDataOptions } from './utils/safe-data.utils.js';
export {
  redact,
  redactString,
  isSecretKey,
  REDACTED,
  DEFAULT_SECRET_KEY_RE,
} from './utils/redact.utils.js';
export type { RedactOptions, RedactStringOptions } from './utils/redact.utils.js';
export type {
  ProfilerRedactionOptions,
  RedactionKeyOptions,
  RedactionHeaderOptions,
  RedactionQueryParamOptions,
} from './utils/redaction-options.js';
export type {
  SourceContextOptions,
  SourceCodeFrame,
  SourceCodeLine,
  StackAnalysisOptions,
} from './utils/source-context.util.js';
export { createEditorLink } from './views/editor-link.js';
export type { EditorLink, ProfilerEditorName } from './views/editor-link.js';
export {
  DEFAULT_MASK_HEADERS,
  extractHeaders,
  formatHeaderValue,
} from './utils/redact-headers.util.js';
export type { ExtractHeadersOptions } from './utils/redact-headers.util.js';
export { loadOptionalPeer, resolveOptionalPeer } from './utils/optional-peer.util.js';
export type { OptionalPeer, OptionalPeerLogger } from './utils/optional-peer.util.js';
export {
  DEFAULT_MASK_QUERY_PARAMS,
  buildMaskedQueryParams,
  redactQueryString,
  redactQueryRecord,
} from './utils/redact-query.util.js';
export type { MemoryStorageAdapterOptions } from './storage/memory-storage.adapter.js';
export { FileStorageAdapter } from './storage/file-storage.adapter.js';
export type { FileStorageAdapterOptions } from './storage/file-storage.adapter.js';
export type {
  Profile,
  ProfileEntrypoint,
  LogEntry,
  ExceptionEntry,
  HttpRequestData,
  ResponseStreamData,
  ResponseData,
  PerformanceData,
  LogLevel,
  RouteInfo,
  TraceSpan,
  TraceSpanKind,
  TraceSpanLane,
  TraceSpanStatus,
  SecurityContext,
  GraphQLInfo,
} from './interfaces/profile.interface.js';
export { HTTP_ENTRYPOINT_TYPE } from './interfaces/profile.interface.js';
export { PROFILER_ENTRYPOINT_TYPES } from './entrypoints/profiler-entrypoint-type.interface.js';
export type {
  ProfilerEntrypointType,
  ProfilerDetailTab,
  EntrypointSummary,
  EntrypointListSection,
} from './entrypoints/profiler-entrypoint-type.interface.js';
export {
  HTTP_ENTRYPOINT_TYPE_DEF,
  buildHttpEntrypointType,
} from './entrypoints/builtin-http-entrypoint.js';
export type { IContextAdapter } from './adapters/context-adapter.interface.js';
export { PROFILER_REQ_KEY, PROFILER_CLS_KEYS, PROFILER_BASE_PATH } from './constants.js';
export { combineFilters } from './filters.js';
export type {
  ProfilerFilterRequest,
  ProfilerRequestFilter,
  ProfilerForceProfileFilter,
} from './filters.js';
export { ProfilerExceptionFilter } from './exception-filters/profiler-exception.filter.js';
export { PROFILER_LIST_FILTERS } from './list-filters/profiler-list-filter.interface.js';
export type {
  ProfilerListFilter,
  ProfilerFilterControl,
  ProfilerFilterOption,
} from './list-filters/profiler-list-filter.interface.js';
export { PROFILER_LIST_SECTIONS } from './list-sections/profiler-list-section.interface.js';
export type { ProfilerListSection } from './list-sections/profiler-list-section.interface.js';
export { sectionTypeConstraint } from './list-sections/list-section.utils.js';
export type { SectionTypeConstraint } from './list-sections/list-section.utils.js';
export {
  distinctFromSummaries,
  distinctInMemory,
  matchesCriterion,
  selectPage,
} from './storage/profiler-query.js';
export type {
  FilterCriterion,
  FilterOp,
  ProfilerPage,
  ProfilerQuery,
} from './storage/profiler-query.js';
export { summarizeProfile } from './storage/profile-summary.js';
export type {
  IndexAttributesProvider,
  ProfileSummary,
  SummaryPrimitive,
} from './storage/profile-summary.js';
