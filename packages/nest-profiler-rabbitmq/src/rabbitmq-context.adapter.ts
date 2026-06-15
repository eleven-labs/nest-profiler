import { randomUUID } from 'node:crypto';
import { ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { ConsumeMessage } from 'amqplib';
import type { IContextAdapter, Profile } from '@eleven-labs/nest-profiler';
import {
  DEFAULT_MASK_HEADERS,
  RABBITMQ_COLLECTOR_OPTIONS,
  RABBITMQ_ENTRYPOINT_TYPE,
  RMQ_CONTEXT_TYPE,
} from './rabbitmq-collector.interface';
import type { RabbitMqInfo } from './rabbitmq-collector.interface';
import type { RabbitMqCollectorModuleOptions } from './rabbitmq-collector.module';

/**
 * Formats a single AMQP header value as a display string. Buffers are decoded
 * as UTF-8, arrays are joined, objects are JSON-stringified.
 *
 * Exported for unit testing; not part of the package's public API.
 */
export function formatHeaderValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => formatHeaderValue(item)).join(', ');
  }

  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[Unserializable object]';
    }
  }

  return '[Unknown value]';
}

/**
 * Normalizes an AMQP header bag into a flat, JSON-safe, masked record.
 *
 * Exported for unit testing; not part of the package's public API.
 */
export function extractHeaders(headers: unknown, maskHeaders: string[]): Record<string, string> {
  if (!headers || typeof headers !== 'object') return {};

  return Object.fromEntries(
    Object.entries(headers as Record<string, unknown>)
      .filter(
        ([key, value]) => !key.startsWith('_') && value != null && typeof value !== 'function',
      )
      .map(([key, value]) => [
        key,
        maskHeaders.includes(key.toLowerCase()) ? '[REDACTED]' : formatHeaderValue(value),
      ]),
  );
}

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
    @Inject(RABBITMQ_COLLECTOR_OPTIONS)
    private readonly options: RabbitMqCollectorModuleOptions,
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
    const maskHeaders = [...DEFAULT_MASK_HEADERS, ...(opts.maskHeaders ?? [])];

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
    if (opts.captureBody !== false && payload != null) data.payload = payload;

    profile.entrypoint = { type: RABBITMQ_ENTRYPOINT_TYPE, data };
  }
}
