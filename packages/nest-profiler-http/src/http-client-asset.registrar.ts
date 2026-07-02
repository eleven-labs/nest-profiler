import { join } from 'node:path';
import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ClientAssetRegistry } from '@eleven-labs/nest-profiler';

/**
 * Registers the HTTP collector's client bundle (`http.js`) with the core
 * {@link ClientAssetRegistry} so the profiler UI serves and loads it after
 * `profiler.js`. This is the pattern any package shipping browser behaviour
 * alongside a collector follows. The registry is optional: when the profiler
 * module is absent/disabled, registration is simply skipped.
 */
@Injectable()
export class HttpClientAssetRegistrar implements OnModuleInit {
  constructor(@Optional() private readonly clientAssets?: ClientAssetRegistry) {}

  onModuleInit(): void {
    this.clientAssets?.register({
      file: 'http.js',
      absPath: join(__dirname, 'public', 'scripts', 'http.js'),
    });
  }
}
