export { NEST_PROFILER_MODULE_OPTIONS } from './nest-profiler.builder';
export type {
  ProfilerModuleAsyncOptions,
  ProfilerModuleOptions,
  ProfilerSecurityOptions,
  ProfilerAuthorize,
  ProfilerAuthContext,
} from './nest-profiler.builder';
export { ProfilerModule } from './nest-profiler.module';
export { ProfilerGuard } from './guards/profiler.guard';
export type { PlatformRequest, PlatformResponse } from './types/http';
export { ProfilerNoopModule } from './nest-profiler-noop.module';
export { buildCollectorModule } from './collector-module.builder';
export type { CollectorModuleShape } from './collector-module.builder';
export { TracerService } from './services/tracer.service';
export { TraceSpanDelegate } from './trace/trace-span.delegate';
export type { SpanOutcome } from './trace/trace-span.delegate';
export { buildTrace, isTraceContributor, TRACE_ROOT_ID } from './trace/build-trace';
export { DEFAULT_TRACE_ID_HEADER, isAdoptableTraceId, resolveTraceId } from './trace/trace-id';
export type { RawSpan, TraceContributor } from './trace/build-trace';
export { Span } from './trace/span.decorator';
export { createProfilerInstrument } from './instrument/profiler-instrument';
export { markInternal, isInternal } from './instrument/internal-marker';
export type { ProfilerInstrumentOptions } from './instrument/profiler-instrument';
export { runInSpan } from './trace/run-in-span';
export { entriesToSpans } from './trace/entries-to-spans';
export type { EntrySpanOptions } from './trace/entries-to-spans';
export {
  createProfilerLogger,
  DEFAULT_LOG_METHODS,
  parseLogArgs,
} from './services/profiler-logger-adapter';
export type {
  LogArgsParser,
  LogMethodMap,
  ParsedLogCall,
  ProfilerLoggerOptions,
} from './services/profiler-logger-adapter';
export { ProfilerStorageService } from './services/profiler-storage.service';
export { ProfilerCoreService } from './services/profiler-core.service';
export { TemplateRendererService } from './services/template-renderer.service';
export { ClientAssetRegistry, CORE_CLIENT_SCRIPT } from './services/client-asset-registry.service';
export type { ClientAssetRegistration } from './services/client-asset-registry.service';
export { CollectorRegistry } from './collectors/collector-registry.service';
export type { CollectorPanelInfo, GlobalPanelInfo } from './collectors/collector-registry.service';
export { ProfilerCollector } from './collectors/collector.decorator';
export type { ProfilerCollectorMetadata } from './collectors/collector.decorator';
export type { GlobalPanelDescriptor, IProfilerCollector } from './collectors/collector.interface';
export { scanHttpRoutes } from './routes/scan-http-routes';
export type { ScannedHttpRoute } from './routes/scan-http-routes';
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
} from './routes/discover-source.interface';
export { AbstractQueryCollector } from './collectors/abstract-query.collector';
export { AbstractSqlQueryCollector } from './collectors/sql/abstract-sql-query.collector';
export {
  AbstractSchemaCollector,
  SCHEMA_ICON,
} from './collectors/schema/abstract-schema.collector';
export { HTTP_ICON } from './views/icons';
export type {
  ColumnInfo,
  RelationInfo,
  IndexInfo,
  EntitySchema,
  SchemaCollectorData,
} from './collectors/schema/schema.interface';
export { detectQueryType } from './collectors/sql/sql-query.interface';
export type { QueryEntry, QueryType } from './collectors/sql/sql-query.interface';
export { ExplainRunnerRegistry } from './collectors/sql/explain/explain-runner-registry.service';
export { parseExplainPlan } from './collectors/sql/explain/parse-explain';
export type {
  ExplainDialect,
  ExplainOptions,
  ExplainPlan,
  ExplainRawResult,
  ExplainRunner,
} from './collectors/sql/explain/explain.interface';
export { interpolateSql } from './collectors/sql/interpolate-sql';
export { formatDuration } from './views/duration';
export { buildCurlCommand } from './views/copy/build-curl';
export type { CurlInput } from './views/copy/build-curl';
export { analyzeProfile } from './analysis/profiler-analyzer';
export {
  BUILTIN_TAG_IDS,
  TAG_SEVERITY_RANK,
  maxTagSeverity,
  upsertTag,
} from './analysis/profiler-tag.interface';
export type { ProfilerTag, TagSeverity, BuiltinTagId } from './analysis/profiler-tag.interface';
export { isTaggableCollector } from './analysis/taggable-collector.interface';
export type {
  TaggableCollector,
  TaggableEntry,
  TagConfig,
} from './analysis/taggable-collector.interface';
export type {
  AnalyzedCollector,
  PerformanceRule,
  PerformanceRuleContext,
} from './analysis/performance-rule.interface';
export { BUILTIN_PERFORMANCE_RULES } from './analysis/builtin-rules';
export {
  resolveProfileErrorClassifier,
  resolveEntryErrorClassifier,
  resolveErrorSeverity,
} from './analysis/profiler-error';
export type {
  ProfilerErrorOptions,
  EntryErrorOptions,
  ProfileErrorInfo,
} from './analysis/profiler-error';
export { normalizeSqlFingerprint, normalizeHttpFingerprint } from './analysis/fingerprint.utils';
export type { ProfilerPerformanceOptions } from './nest-profiler.builder';
export { PROFILER_STORAGE_ADAPTER } from './storage/storage-adapter.interface';
export type {
  IProfilerStorageAdapter,
  StorageFindOptions,
} from './storage/storage-adapter.interface';
export { MemoryStorageAdapter } from './storage/memory-storage.adapter';
export { getCollectorEntries, appendCollectorEntry } from './utils/collector.utils';
export { isPlainObject } from './utils/type.utils';
export { toExceptionEntry } from './analysis/to-exception-entry';
export type {
  CollectorModuleOptions,
  TagSeverityOptions,
} from './collectors/collector-module-options';
export { tryResolve } from './utils/resolve.utils';
export {
  readProfile,
  readToken,
  readTraceId,
  readRequest,
  readActiveSpanId,
  setProfileContext,
} from './services/profiler-context';
export { monotonicNow, elapsedMs } from './utils/clock.utils';
export {
  markProfileStart,
  profileElapsedMs,
  completeProfilePerformance,
  registerGcCounter,
} from './utils/profile-metrics.util';
export type { GcCounter } from './utils/profile-metrics.util';
export { RuntimeMetricsService } from './runtime/runtime-metrics.service';
export { RuntimeCollector } from './runtime/runtime.collector';
export type {
  ProfilerRuntimeOptions,
  RuntimeSample,
  RuntimeCollectorData,
  RuntimeHeapStatistics,
  RuntimeProcessInfo,
} from './runtime/runtime-metrics.interface';
export {
  toSafeData,
  safeStringify,
  normalizeBody,
  DEFAULT_MAX_BODY_SIZE,
} from './utils/safe-data.utils';
export type { SafeDataOptions } from './utils/safe-data.utils';
export {
  redact,
  redactString,
  isSecretKey,
  REDACTED,
  DEFAULT_SECRET_KEY_RE,
} from './utils/redact.utils';
export type { RedactOptions, RedactStringOptions } from './utils/redact.utils';
export type {
  ProfilerRedactionOptions,
  RedactionKeyOptions,
  RedactionHeaderOptions,
  RedactionQueryParamOptions,
} from './utils/redaction-options';
export { resolveRedactionConfig } from './utils/redaction-config';
export type { ResolvedRedactionConfig } from './utils/redaction-config';
export { buildSourceContext, resolveSourceContextOptions } from './utils/source-context.util';
export type {
  SourceContextOptions,
  SourceCodeFrame,
  SourceCodeLine,
} from './utils/source-context.util';
export type { ToExceptionEntryOptions } from './analysis/to-exception-entry';
export {
  DEFAULT_MASK_HEADERS,
  extractHeaders,
  formatHeaderValue,
} from './utils/redact-headers.util';
export type { ExtractHeadersOptions } from './utils/redact-headers.util';
export { loadOptionalPeer, resolveOptionalPeer } from './utils/optional-peer.util';
export type { OptionalPeer, OptionalPeerLogger } from './utils/optional-peer.util';
export {
  DEFAULT_MASK_QUERY_PARAMS,
  buildMaskedQueryParams,
  redactQueryString,
  redactQueryRecord,
} from './utils/redact-query.util';
export type { MemoryStorageAdapterOptions } from './storage/memory-storage.adapter';
export { FileStorageAdapter } from './storage/file-storage.adapter';
export type { FileStorageAdapterOptions } from './storage/file-storage.adapter';
export type {
  Profile,
  ProfileEntrypoint,
  LogEntry,
  ExceptionEntry,
  HttpRequestData,
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
} from './interfaces/profile.interface';
export { HTTP_ENTRYPOINT_TYPE } from './interfaces/profile.interface';
export { PROFILER_ENTRYPOINT_TYPES } from './entrypoints/profiler-entrypoint-type.interface';
export type {
  ProfilerEntrypointType,
  ProfilerDetailTab,
  EntrypointSummary,
  EntrypointListSection,
} from './entrypoints/profiler-entrypoint-type.interface';
export {
  HTTP_ENTRYPOINT_TYPE_DEF,
  buildHttpEntrypointType,
} from './entrypoints/builtin-http-entrypoint';
export type { IContextAdapter } from './adapters/context-adapter.interface';
export { PROFILER_REQ_KEY, PROFILER_CLS_KEYS, PROFILER_BASE_PATH } from './constants';
export { combineFilters } from './filters';
export type {
  ProfilerFilterRequest,
  ProfilerRequestFilter,
  ProfilerForceProfileFilter,
} from './filters';
export { ProfilerExceptionFilter } from './exception-filters/profiler-exception.filter';
export { PROFILER_LIST_FILTERS } from './list-filters/profiler-list-filter.interface';
export type {
  ProfilerListFilter,
  ProfilerFilterControl,
  ProfilerFilterOption,
} from './list-filters/profiler-list-filter.interface';
export { PROFILER_LIST_SECTIONS } from './list-sections/profiler-list-section.interface';
export type { ProfilerListSection } from './list-sections/profiler-list-section.interface';
export {
  DEFAULT_SECTION_ORDER,
  sectionTypeConstraint,
  sortSections,
} from './list-sections/list-section.utils';
export type { SectionTypeConstraint } from './list-sections/list-section.utils';
export {
  applyQueryInMemory,
  distinctFromSummaries,
  distinctInMemory,
  matchesCriterion,
  matchesQuery,
  resolveField,
  selectPage,
} from './storage/profiler-query';
export type {
  FilterCriterion,
  FilterOp,
  ProfilerPage,
  ProfilerQuery,
} from './storage/profiler-query';
export { summarizeProfile } from './storage/profile-summary';
export type {
  IndexAttributesProvider,
  ProfileSummary,
  SummaryPrimitive,
} from './storage/profile-summary';
export { buildPageHref, paginateProfiles } from './list-pagination/list-pagination.utils';
export type {
  PaginatedProfiles,
  ProfilerListPagination,
} from './list-pagination/list-pagination.utils';
