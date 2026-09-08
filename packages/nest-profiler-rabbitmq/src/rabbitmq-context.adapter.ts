import { randomUUID } from 'node:crypto';
import { isAdoptableTraceId } from '@eleven-labs/nest-profiler';
import { ExecutionContext, Inject, Injectable, Optional } from '@nestjs/common';
import type { ConsumeMessage } from 'amqplib';
import { markProfileStart, redact } from '@eleven-labs/nest-profiler';
import type { IContextAdapter, Profile } from '@eleven-labs/nest-profiler';
import {
  RABBITMQ_COLLECTOR_OPTIONS,
  RABBITMQ_ENTRYPOINT_TYPE,
  RMQ_CONTEXT_TYPE,
} from './rabbitmq-collector.interface';
import type { RabbitMqInfo } from './rabbitmq-collector.interface';
import type { RabbitMqCollectorModuleOptions } from './rabbitmq-collector.interface';
import { buildRabbitMqPublish } from './build-rabbitmq-publish';
import { extractHeaders, resolveMaskHeaders } from './rabbitmq-headers.util';

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
    const profile: Profile = {
      token: randomUUID(),
      // A consumed message opens its own trace. `enrichProfile` adopts the broker's
      // `correlationId` over this one when the publisher set it, which is what links a message
      // back to the HTTP request that produced it.
      traceId: randomUUID(),
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
    // The core interceptor finalizes this profile; marking the start here is what lets it
    // measure the duration on the monotonic clock rather than the wall clock.
    markProfileStart(profile);
    return profile;
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

    // Adopt the publisher's correlation id as this trace's id when there is one — that is exactly
    // the link between the request that published the message and the consumer that handled it,
    // and it is the only propagation channel AMQP offers. Validated like any inbound id: it lands
    // in log lines and in the dashboard, so it is not trusted on the publisher's word.
    if (isAdoptableTraceId(properties?.correlationId)) {
      profile.traceId = properties.correlationId;
    }

    const data: RabbitMqInfo = {
      exchange,
      routingKey,
      handler,
      redelivered: fields?.redelivered,
      consumerTag: fields?.consumerTag,
      // amqplib types these RabbitMQ properties as `any`.
      messageId: properties?.messageId as string | undefined,
      appId: properties?.appId as string | undefined,
      deliveryTag: fields?.deliveryTag,
    };
    if (headers) data.headers = headers;
    if (opts.captureBody !== false && payload != null) data.payload = redact(payload);
    data.publishSnippet = buildRabbitMqPublish(data);

    profile.entrypoint = { type: RABBITMQ_ENTRYPOINT_TYPE, data };
  }
}
