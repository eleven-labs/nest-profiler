import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { ClsService } from 'nestjs-cls';
import type { Options } from 'amqplib';
import { PROFILER_CLS_KEYS, appendCollectorEntry, tryResolve } from '@eleven-labs/nest-profiler';
import type { Profile } from '@eleven-labs/nest-profiler';
import { extractHeaders, resolveMaskHeaders } from './amqp-headers.util';
import { capturePublishPayload } from './amqp-publish.util';
// Import the options token from the interface module, never from
// `./rabbitmq-publish-collector.module`: that module imports this file, and the resulting cycle
// leaves the re-exported token undefined when the decorators below run — `@Inject(undefined)`
// then silently degrades to the `@Optional()` default, so every option would be ignored.
import {
  RABBITMQ_PUBLISHES_KEY,
  RABBITMQ_PUBLISH_COLLECTOR_OPTIONS,
} from './rabbitmq-publish-collector.interface';
import type {
  AmqpPublishEntry,
  RabbitMqPublishCollectorModuleOptions,
} from './rabbitmq-publish-collector.interface';

/** golevelup's `AmqpConnection.publish`, plus the idempotence marker the patch stamps on it. */
type PublishFn = ((
  exchange: string,
  routingKey: string,
  message: unknown,
  options?: Options.Publish,
) => Promise<boolean>) & { __profilerPatched?: boolean };

/** The narrow surface the patch needs — satisfied by `AmqpConnection.prototype`. */
export interface PublishTarget {
  publish: PublishFn;
}

/**
 * Wraps `publish` on the given target so every call made while a profile is active is recorded
 * under {@link RABBITMQ_PUBLISHES_KEY}. Idempotent: patching an already-patched target is a
 * no-op, so importing the module twice cannot double-count a publish.
 *
 * Recording never changes what `publish` does — the original result is returned and the
 * original error re-thrown, and a failure inside the recording itself is swallowed.
 *
 * Exported for unit testing; not part of the package's public API.
 */
export function patchAmqpPublish(
  target: PublishTarget,
  cls: ClsService,
  options: RabbitMqPublishCollectorModuleOptions = {},
): void {
  const original = target.publish;
  if (typeof original !== 'function' || original.__profilerPatched === true) return;

  const maskHeaders = resolveMaskHeaders(options.maskHeaders);

  const record = (
    exchange: string,
    routingKey: string,
    message: unknown,
    publishOptions: Options.Publish | undefined,
    startedAt: number,
    accepted: boolean | undefined,
    error: string | undefined,
  ): void => {
    try {
      // Throws outside a CLS context (a publish at bootstrap, from a cron job…), and returns
      // undefined when the request was not profiled — both mean "nothing to record".
      const profile = cls.get<Profile | undefined>(PROFILER_CLS_KEYS.profile);
      if (!profile) return;

      const entry: AmqpPublishEntry = {
        exchange,
        routingKey,
        startedAt,
        duration: Date.now() - startedAt,
        accepted,
        error,
      };
      if (options.captureHeaders !== false && publishOptions?.headers) {
        entry.headers = extractHeaders(publishOptions.headers, maskHeaders);
      }
      if (options.captureBody !== false) {
        entry.payload = capturePublishPayload(message, options.payloadLimits);
      }
      // amqplib types these AMQP properties as `any`.
      if (publishOptions?.messageId) entry.messageId = String(publishOptions.messageId);
      if (publishOptions?.appId) entry.appId = String(publishOptions.appId);
      if (publishOptions?.correlationId) entry.correlationId = String(publishOptions.correlationId);
      if (publishOptions?.replyTo) entry.replyTo = String(publishOptions.replyTo);

      appendCollectorEntry<AmqpPublishEntry>(profile, RABBITMQ_PUBLISHES_KEY, entry);
    } catch {
      // Outside CLS context, or an unserializable payload — never break the publish.
    }
  };

  const patched: PublishFn = async function instrumentedPublish(
    this: PublishTarget,
    exchange: string,
    routingKey: string,
    message: unknown,
    publishOptions?: Options.Publish,
  ): Promise<boolean> {
    const startedAt = Date.now();
    let accepted: boolean | undefined;
    let error: string | undefined;
    try {
      accepted = await original.call(this, exchange, routingKey, message, publishOptions);
      return accepted;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      record(exchange, routingKey, message, publishOptions, startedAt, accepted, error);
    }
  };

  patched.__profilerPatched = true;
  target.publish = patched;
}

/**
 * Instruments outgoing AMQP messages by patching `AmqpConnection.prototype.publish`.
 *
 * The prototype is the hook point: `AmqpConnection` is instantiated by
 * `@golevelup/nestjs-rabbitmq`'s own factory, so there is no instance to decorate at wiring
 * time — and patching the prototype covers every connection an application registers, plus the
 * publishes golevelup itself routes through `publish` (`AmqpConnection.request()` for RPC calls
 * and the reply of an `@RabbitRPC` handler).
 *
 * Only the caller's publish options are seen, not the connection's `defaultPublishOptions`.
 */
@Injectable()
export class AmqpPublishPatch implements OnModuleInit {
  constructor(
    private readonly moduleRef: ModuleRef,
    @Optional()
    @Inject(RABBITMQ_PUBLISH_COLLECTOR_OPTIONS)
    private readonly options: RabbitMqPublishCollectorModuleOptions = {},
  ) {}

  onModuleInit(): void {
    // Resolve lazily via ModuleRef (it traverses to the core's global ClsModule); no-op when the
    // core is disabled, so a `ProfilerNoopModule` setup leaves `publish` untouched.
    const cls = tryResolve<ClsService>(this.moduleRef, ClsService);
    if (!cls) return;
    patchAmqpPublish(AmqpConnection.prototype, cls, this.options);
  }
}
