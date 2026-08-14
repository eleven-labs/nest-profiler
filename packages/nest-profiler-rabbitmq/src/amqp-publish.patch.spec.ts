import type { ModuleRef } from '@nestjs/core';
import type { ClsService } from 'nestjs-cls';
import { ClsService as ClsServiceToken } from 'nestjs-cls';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import type { Options } from 'amqplib';
import type { Profile } from '@eleven-labs/nest-profiler';
import { AmqpPublishPatch, patchAmqpPublish } from './amqp-publish.patch';
import type { PublishTarget } from './amqp-publish.patch';
import { RABBITMQ_PUBLISHES_KEY } from './rabbitmq-publish-collector.interface';
import type {
  AmqpPublishEntry,
  RabbitMqPublishCollectorModuleOptions,
} from './rabbitmq-publish-collector.interface';

function makeProfile(): Profile {
  return {
    token: 'test',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'GET', url: '/', headers: {}, query: {} } },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

/** A CLS service resolving to the given profile — or throwing, as it does outside a CLS context. */
function makeCls(profile: Profile | undefined | 'throws'): ClsService {
  return {
    get: (): Profile | undefined => {
      if (profile === 'throws') throw new Error('outside CLS context');
      return profile;
    },
  } as unknown as ClsService;
}

/** A publish target whose `publish` resolves to `accepted` and records the calls it received. */
function makeTarget(accepted = true): PublishTarget & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    publish: (...args: unknown[]): Promise<boolean> => {
      calls.push(args);
      return Promise.resolve(accepted);
    },
  };
}

function entriesOf(profile: Profile): AmqpPublishEntry[] {
  return (profile.collectors[RABBITMQ_PUBLISHES_KEY] as AmqpPublishEntry[] | undefined) ?? [];
}

/** Patches a target, publishes once and returns the entry the patch recorded. */
async function publishEntry(
  options: RabbitMqPublishCollectorModuleOptions = {},
  message: unknown = { id: 1 },
  publishOptions?: Options.Publish,
): Promise<AmqpPublishEntry> {
  const profile = makeProfile();
  const target = makeTarget();
  patchAmqpPublish(target, makeCls(profile), options);

  await target.publish('articles.events', 'published.LEFIGARO', message, publishOptions);

  const entries = entriesOf(profile);
  expect(entries).toHaveLength(1);
  const [entry] = entries;
  if (entry === undefined) throw new Error('the patch recorded no entry');
  return entry;
}

describe('patchAmqpPublish', () => {
  it('records the exchange, routing key, payload and outcome of a publish', async () => {
    const entry = await publishEntry();

    expect(entry).toMatchObject({
      exchange: 'articles.events',
      routingKey: 'published.LEFIGARO',
      payload: { id: 1 },
      accepted: true,
    });
    expect(entry.error).toBeUndefined();
    expect(entry.duration).toBeGreaterThanOrEqual(0);
    expect(entry.startedAt).toBeGreaterThan(0);
  });

  it('forwards the arguments and the result untouched', async () => {
    const target = makeTarget(false);
    patchAmqpPublish(target, makeCls(makeProfile()));

    const accepted = await target.publish('x', 'y', { id: 1 }, { messageId: 'mid' });

    expect(accepted).toBe(false);
    expect(target.calls).toEqual([['x', 'y', { id: 1 }, { messageId: 'mid' }]]);
  });

  it('flags a publish the channel buffered', async () => {
    const profile = makeProfile();
    const target = makeTarget(false);
    patchAmqpPublish(target, makeCls(profile));

    await target.publish('articles.events', 'published.LEFIGARO', { id: 1 });

    expect(entriesOf(profile)[0]?.accepted).toBe(false);
  });

  it('records the failure and re-throws when publish rejects', async () => {
    const profile = makeProfile();
    const target = {
      publish: (): Promise<boolean> => Promise.reject(new Error('Channel closed')),
    } as unknown as PublishTarget;
    patchAmqpPublish(target, makeCls(profile));

    await expect(target.publish('articles.events', 'published.LEFIGARO', {})).rejects.toThrow(
      'Channel closed',
    );

    expect(entriesOf(profile)[0]).toMatchObject({ error: 'Channel closed', accepted: undefined });
  });

  it('captures the AMQP properties the publisher set', async () => {
    const entry = await publishEntry(
      {},
      {},
      {
        messageId: 'mid-1',
        appId: 'api-notif',
        correlationId: 'corr-1',
        replyTo: 'amq.rabbitmq.reply-to',
      },
    );

    expect(entry).toMatchObject({
      messageId: 'mid-1',
      appId: 'api-notif',
      correlationId: 'corr-1',
      replyTo: 'amq.rabbitmq.reply-to',
    });
  });

  it('masks sensitive headers and keeps the rest', async () => {
    const entry = await publishEntry(
      { maskHeaders: ['x-tenant-secret'] },
      {},
      { headers: { authorization: 'Bearer t', 'x-tenant-secret': 's', 'x-trace': 'abc' } },
    );

    expect(entry.headers).toEqual({
      authorization: '[REDACTED]',
      'x-tenant-secret': '[REDACTED]',
      'x-trace': 'abc',
    });
  });

  it('omits the headers and the payload when their capture is disabled', async () => {
    const entry = await publishEntry(
      { captureHeaders: false, captureBody: false },
      { id: 1 },
      { headers: { 'x-trace': 'abc' } },
    );

    expect(entry.headers).toBeUndefined();
    expect(entry.payload).toBeUndefined();
  });

  it('records nothing when the request was not profiled', async () => {
    const target = makeTarget();
    patchAmqpPublish(target, makeCls(undefined));

    await expect(target.publish('x', 'y', {})).resolves.toBe(true);
  });

  it('records nothing outside a CLS context — a publish at bootstrap or from a job', async () => {
    const target = makeTarget();
    patchAmqpPublish(target, makeCls('throws'));

    await expect(target.publish('x', 'y', {})).resolves.toBe(true);
  });

  it('is idempotent — patching twice does not double-count a publish', async () => {
    const profile = makeProfile();
    const target = makeTarget();
    const cls = makeCls(profile);

    patchAmqpPublish(target, cls);
    patchAmqpPublish(target, cls);
    await target.publish('articles.events', 'published.LEFIGARO', {});

    expect(entriesOf(profile)).toHaveLength(1);
  });

  it('ignores a target without a publish method', () => {
    const target = {} as unknown as PublishTarget;
    expect(() => patchAmqpPublish(target, makeCls(makeProfile()))).not.toThrow();
    expect(target.publish).toBeUndefined();
  });
});

describe('AmqpPublishPatch', () => {
  // Aliased as a plain property bag: the patch mutates golevelup's real prototype, and this spec
  // only ever snapshots, compares and restores `publish` — it never calls it.
  const prototype = AmqpConnection.prototype as { publish: unknown };
  const original = prototype.publish;

  afterEach(() => {
    prototype.publish = original;
  });

  it('patches AmqpConnection.prototype.publish when the core provides a CLS store', () => {
    const moduleRef = {
      get: (token: unknown): unknown =>
        token === ClsServiceToken ? makeCls(undefined) : undefined,
    } as unknown as ModuleRef;

    new AmqpPublishPatch(moduleRef).onModuleInit();

    expect(prototype.publish).not.toBe(original);
  });

  it('leaves publish untouched when ClsService is unavailable (core disabled)', () => {
    const moduleRef = {
      get: (): never => {
        throw new Error('provider not found');
      },
    } as unknown as ModuleRef;

    new AmqpPublishPatch(moduleRef).onModuleInit();

    expect(prototype.publish).toBe(original);
  });
});
