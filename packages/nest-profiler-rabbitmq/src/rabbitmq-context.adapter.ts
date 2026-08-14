import { randomUUID } from 'node:crypto';
import { ExecutionContext, Inject, Injectable, Optional } from '@nestjs/common';
import type { ConsumeMessage } from 'amqplib';
import { redact } from '@eleven-labs/nest-profiler';
import type { IContextAdapter, Profile } from '@eleven-labs/nest-profiler';
import {
  RABBITMQ_COLLECTOR_OPTIONS,
  RABBITMQ_ENTRYPOINT_TYPE,
  RMQ_CONTEXT_TYPE,
} from './rabbitmq-collector.interface';
import type { RabbitMqInfo } from './rabbitmq-collector.interface';
import type { RabbitMqCollectorModuleOptions } from './rabbitmq-collector.interface';
import { buildAmqpPublish } from './build-amqp-publish';
import { extractHeaders, resolveMaskHeaders } from './amqp-headers.util';

/**
 * Context adapter that lets the profiler capture `@RabbitSubscribe` messages.
 *
 * Unlike the GraphQL adapter (which recovers the ambient HTTP profile), a
 * consumed RabbitMQ message has no surrounding HTTP request, so
 * {@link recoverProfile} **creates** a fresh profile per message. The core
 * `ProfilerInterceptor` then wraps the handler in a CLS scope and persists the
 * profile once the handler completes, so nested collectors (HTTP client,
 * database, …) capture the work the handler performs.
 */
@Injectable()
export class RabbitMqContextAdapter implements IContextAdapter {
  readonly contextType = RMQ_CONTEXT_TYPE;

  constructor(
    // @Optional() with a default: the adapter is exported for manual wiring, so a consumer that
    // provides it without forRoot() (no options token) must not hit a DI resolution error.
    @Optional()
    @Inject(RABBITMQ_COLLECTOR_OPTIONS)
    private readonly options: RabbitMqCollectorModuleOptions = {},
  ) {}

  recoverProfile(): Profile {
    const startTime = Date.now();
    return {
      token: randomUUID(),
      createdAt: startTime,
      // The `rabbitmq` entrypoint type (registered by RabbitMqCollectorModule)
      // gives this profile its dedicated list table and Message detail tab.
      // enrichProfile fills the data from the consumed message.
      entrypoint: { type: RABBITMQ_ENTRYPOINT_TYPE, data: { exchange: '', routingKey: '' } },
      performance: { startTime, heapUsed: process.memoryUsage().heapUsed },
      logs: [],
      exceptions: [],
      collectors: {},
    };
  }

  enrichProfile(profile: Profile, ctx: ExecutionContext): void {
    const opts = this.options;
    const maskHeaders = resolveMaskHeaders(opts.maskHeaders);

    const rpc = ctx.switchToRpc();
    const message = rpc.getContext<ConsumeMessage>();
    const payload = rpc.getData<unknown>();

    const fields = message?.fields;
    const properties = message?.properties;
    const exchange = fields?.exchange ?? '';
    const routingKey = fields?.routingKey ?? '';
    const handler = `${ctx.getClass().name}.${ctx.getHandler().name}`;

    const headers =
      opts.captureHeaders !== false ? extractHeaders(properties?.headers, maskHeaders) : undefined;

    const data: RabbitMqInfo = {
      exchange,
      routingKey,
      handler,
      redelivered: fields?.redelivered,
      consumerTag: fields?.consumerTag,
      // amqplib types these AMQP properties as `any`.
      messageId: properties?.messageId as string | undefined,
      appId: properties?.appId as string | undefined,
      deliveryTag: fields?.deliveryTag,
    };
    if (headers) data.headers = headers;
    if (opts.captureBody !== false && payload != null) data.payload = redact(payload);
    data.publishSnippet = buildAmqpPublish(data);

    profile.entrypoint = { type: RABBITMQ_ENTRYPOINT_TYPE, data };
  }
}
