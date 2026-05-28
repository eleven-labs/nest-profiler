# @eleven-labs/nest-profiler

## 0.0.1

### Features

- Initial release: NestJS web profiler inspired by Symfony's Web Profiler
- Per-request profiling with unique token (UUID v4) and floating toolbar injected into HTML responses
- Built-in profiler UI at `/_profiler` — list, detail view, filters, and JSON export
- Built-in **Timeline** panel with `startSpan()` / `stop()` API for custom performance phases
- Built-in **Request**, **Response**, **Performance**, **Logs**, and **Exceptions** panels
- Extensible collector architecture via `@ProfilerCollector()` decorator and `IProfilerCollector` interface
- Collector grouping — share a sidebar tab across multiple independent collectors with `group` key
- Two storage backends: in-memory LRU (`storageType: 'memory'`, default) and file-based (`storageType: 'file'`)
- Custom storage via `IProfilerStorageAdapter` interface
- `ProfilerModule.forRoot()` and `ProfilerModule.forRootAsync()` configuration
- Options: `enabled`, `path`, `maxProfiles`, `ttl`, `isGlobal`, `storageType`, `storagePath`, `storage`, `collectBody`, `sampleRate`, `ignorePaths`, `maskCookies`
- Debug headers: `X-Debug-Token`, `X-Debug-Token-Link`, `X-Profiler-Token`
- Log capture via `profilerService.createLogger()`
- Platform-agnostic: supports both `@nestjs/platform-express` and `@nestjs/platform-fastify`
- Nav items grayed out when a collector has no data for the current request
