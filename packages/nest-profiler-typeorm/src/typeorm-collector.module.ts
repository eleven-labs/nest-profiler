import { DynamicModule, Module } from '@nestjs/common';
import { TypeOrmCollector } from './typeorm.collector';
import { TypeOrmDriverPatch } from './typeorm-driver.patch';

export interface TypeOrmCollectorModuleOptions {
  /** Queries exceeding this duration (ms) are marked as slow. Default: 100 */
  slowQueryThreshold?: number;
  /** Enable the collector. Default: `true`. Set to `false` to disable (the host application decides per environment). */
  enabled?: boolean;
}

export const TYPEORM_COLLECTOR_OPTIONS = Symbol('TYPEORM_COLLECTOR_OPTIONS');

@Module({})
export class TypeOrmCollectorModule {
  static forRoot(options: TypeOrmCollectorModuleOptions = {}): DynamicModule {
    if (options.enabled === false) return { module: TypeOrmCollectorModule };
    return {
      module: TypeOrmCollectorModule,
      providers: [
        { provide: TYPEORM_COLLECTOR_OPTIONS, useValue: options },
        TypeOrmDriverPatch,
        TypeOrmCollector,
      ],
    };
  }
}
