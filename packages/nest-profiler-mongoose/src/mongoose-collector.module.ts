import { DynamicModule, Module } from '@nestjs/common';
import { MongooseCollector } from './mongoose.collector';
import { MongooseConnectionPatch } from './mongoose-connection.patch';

export interface MongooseCollectorModuleOptions {
  /** Queries exceeding this duration (ms) are marked as slow. Default: 100 */
  slowQueryThreshold?: number;
  /** Enable the collector. Default: `true`. Set to `false` to disable (the host application decides per environment). */
  enabled?: boolean;
}

export const MONGOOSE_COLLECTOR_OPTIONS = Symbol('MONGOOSE_COLLECTOR_OPTIONS');

@Module({})
export class MongooseCollectorModule {
  static forRoot(options: MongooseCollectorModuleOptions = {}): DynamicModule {
    if (options.enabled === false) return { module: MongooseCollectorModule };
    return {
      module: MongooseCollectorModule,
      providers: [
        { provide: MONGOOSE_COLLECTOR_OPTIONS, useValue: options },
        MongooseConnectionPatch,
        MongooseCollector,
      ],
    };
  }
}
