---
'@eleven-labs/nest-profiler': patch
---

Keep the profiler's routes out of the host's Swagger document. `ProfilerController` now carries the metadata `@nestjs/swagger`'s `@ApiExcludeController()` sets, so `SwaggerModule.createDocument()` skips every `/_profiler` route without the application excluding them — and without the profiler depending on `@nestjs/swagger`.
