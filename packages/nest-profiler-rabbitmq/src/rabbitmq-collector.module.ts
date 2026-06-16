import { DynamicModule, Module, OnModuleInit, Optional, Provider } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ProfilerCoreService, PROFILER_CONTEXT_ADAPTERS } from '@eleven-labs/nest-profiler';
import { RabbitMqContextAdapter } from './rabbitmq-context.adapter';
import { RABBITMQ_COLLECTOR_OPTIONS } from './rabbitmq-collector.interface';
import { RABBITMQ_ENTRYPOINT_TYPE_DEF } from './rabbitmq-entrypoint';

export interface RabbitMqCollectorModuleOptions {
  /** Enable the collector. Default: `true`. Set to `false` to disable (the host application decides per environment). */
  enabled?: boolean;

  /**
   * Capture incoming AMQP message headers. Default: `true`.
   * Sensitive headers are masked — see {@link maskHeaders}.
   */
  captureHeaders?: boolean;

  /**
   * Capture the deserialized message payload. Default: `true`.
   * Enable with caution — payloads can be large.
   */
  captureBody?: boolean;

  /**
   * Header names (lowercase) whose values are replaced with `[REDACTED]`.
   * Merged with the built-in list: `authorization`, `cookie`, `x-api-key`,
   * `x-auth-token`.
   */
  maskHeaders?: string[];
}

/**
 * Captures RabbitMQ messages consumed via `@RabbitSubscribe`
 * (`@golevelup/nestjs-rabbitmq`) and surfaces them in the web profiler.
 *
 * On init it registers a {@link RabbitMqContextAdapter} (so each consumed
 * message becomes its own profile) and the `rabbitmq` entrypoint type, which
 * contributes the dedicated **RabbitMQ** list table, the **Message** detail tab
 * and the `type` filter option — all in one call, without touching the core.
 */
@Module({})
export class RabbitMqCollectorModule implements OnModuleInit {
  constructor(
    private readonly moduleRef: ModuleRef,
    @Optional() private readonly adapter?: RabbitMqContextAdapter,
  ) {}

  onModuleInit(): void {
    if (!this.adapter) return;
    try {
      const core = this.moduleRef.get(ProfilerCoreService, { strict: false });
      core.registerContextAdapter(this.adapter);
      core.registerEntrypointType(RABBITMQ_ENTRYPOINT_TYPE_DEF);
    } catch {
      /* profiler core not available — no-op */
    }
  }

  static forRoot(options: RabbitMqCollectorModuleOptions = {}): DynamicModule {
    if (options.enabled === false) return { module: RabbitMqCollectorModule };
    return {
      module: RabbitMqCollectorModule,
      providers: [
        { provide: RABBITMQ_COLLECTOR_OPTIONS, useValue: options },
        RabbitMqContextAdapter,
        // `multi` is valid at runtime but absent from the NestJS Provider
        // typings for `useExisting`, hence the cast.
        {
          provide: PROFILER_CONTEXT_ADAPTERS,
          useExisting: RabbitMqContextAdapter,
          multi: true,
        } as Provider,
      ],
    };
  }
}
