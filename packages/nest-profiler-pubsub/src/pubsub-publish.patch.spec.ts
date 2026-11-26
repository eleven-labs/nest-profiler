import type { ModuleRef } from '@nestjs/core';
import type { ClsService } from 'nestjs-cls';
import { ClsService as ClsServiceToken } from 'nestjs-cls';
import { PubSub, Topic } from '@google-cloud/pubsub';
import { PROFILER_CLS_KEYS } from '@eleven-labs/nest-profiler';
import type { Profile } from '@eleven-labs/nest-profiler';
import { PubSubPublishPatch, patchPubSubPublish } from './pubsub-publish.patch.js';
import type { PublishTarget, PublishedMessage, PublishingTopic } from './pubsub-publish.patch.js';
import { PUBSUB_PUBLISHES_KEY } from './pubsub-publish-collector.interface.js';
import type {
  PubSubPublishEntry,
  PubSubPublishCollectorModuleOptions,
} from './pubsub-publish-collector.interface.js';

function makeProfile(): Profile {
  return {
    token: 'test',
    traceId: 'trace-test',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'GET', url: '/', headers: {}, query: {} } },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

/** A CLS service resolving the given profile and span — or throwing, as it does outside a CLS context. */
function makeCls(profile: Profile | undefined | 'throws', activeSpanId?: string): ClsService {
  return {
    get: (key: string): unknown => {
      if (profile === 'throws') throw new Error('outside CLS context');
      if (key === PROFILER_CLS_KEYS.activeSpanId) return activeSpanId;
      return profile;
    },
  } as unknown as ClsService;
}

type Outcome = { messageId: string } | { error: Error } | { throws: Error };

/** A fake `Topic` prototype whose `publishMessage` settles with `outcome`, in both conventions. */
function makeTarget(outcome: Outcome = { messageId: 'msg-1' }): PublishTarget & {
  calls: unknown[][];
} {
  const calls: unknown[][] = [];
  return {
    calls,
    publishMessage(
      this: PublishingTopic,
      message: PublishedMessage,
      callback?: (error?: Error | null, messageId?: string | null) => void,
    ): Promise<string> | void {
      calls.push(callback ? [message, 'callback'] : [message]);
      if ('throws' in outcome) throw outcome.throws;
      if (callback) {
        setImmediate(() =>
          'error' in outcome ? callback(outcome.error) : callback(null, outcome.messageId),
        );
        return;
      }
      return 'error' in outcome
        ? Promise.reject(outcome.error)
        : Promise.resolve(outcome.messageId);
    },
  };
}

const TOPIC: PublishingTopic = { name: 'projects/my-project/topics/orders' };

function entriesOf(profile: Profile): PubSubPublishEntry[] {
  return (profile.collectors[PUBSUB_PUBLISHES_KEY] as PubSubPublishEntry[] | undefined) ?? [];
}

/** Patches a target, publishes once on {@link TOPIC} and returns the entry the patch recorded. */
async function publishEntry(
  message: PublishedMessage,
  options: PubSubPublishCollectorModuleOptions = {},
): Promise<PubSubPublishEntry> {
  const profile = makeProfile();
  const target = makeTarget();
  patchPubSubPublish(target, makeCls(profile), options);

  await target.publishMessage.call(TOPIC, message);

  const entries = entriesOf(profile);
  expect(entries).toHaveLength(1);
  const [entry] = entries;
  if (entry === undefined) throw new Error('the patch recorded no entry');
  return entry;
}

describe('patchPubSubPublish', () => {
  it('records the topic, payload, size and message id of a publish', async () => {
    const entry = await publishEntry({ json: { id: 1 } });

    expect(entry).toMatchObject({
      topic: 'orders',
      projectId: 'my-project',
      payload: { id: 1 },
      size: 8,
      messageId: 'msg-1',
    });
    expect(entry.error).toBeUndefined();
    expect(entry.duration).toBeGreaterThanOrEqual(0);
    expect(entry.startedAt).toBeGreaterThan(0);
  });

  it('forwards the message and the result untouched', async () => {
    const target = makeTarget({ messageId: 'abc' });
    patchPubSubPublish(target, makeCls(makeProfile()));
    const message = { data: Buffer.from('x'), attributes: { a: 'b' } };

    await expect(target.publishMessage.call(TOPIC, message)).resolves.toBe('abc');
    expect(target.calls).toEqual([[message]]);
  });

  it('captures the attributes (masked) and the ordering key', async () => {
    const entry = await publishEntry(
      {
        data: Buffer.from('{"id":2}'),
        attributes: { eventType: 'order.created', 'x-api-key': 'k' },
        orderingKey: 'customer-1',
      },
      { maskAttributes: ['X-API-Key'] },
    );

    expect(entry).toMatchObject({
      payload: { id: 2 },
      attributes: { eventType: 'order.created', 'x-api-key': '[REDACTED]' },
      orderingKey: 'customer-1',
    });
  });

  it('honours captureBody and captureAttributes set to false', async () => {
    const entry = await publishEntry(
      { json: { id: 1 }, attributes: { a: 'b' } },
      { captureBody: false, captureAttributes: false },
    );

    expect(entry.payload).toBeUndefined();
    expect(entry.attributes).toBeUndefined();
    expect(entry.size).toBe(8);
  });

  it('records the failure and re-throws when the publish rejects', async () => {
    const profile = makeProfile();
    const target = makeTarget({ error: new Error('PERMISSION_DENIED') });
    patchPubSubPublish(target, makeCls(profile));

    await expect(target.publishMessage.call(TOPIC, { json: {} })).rejects.toThrow(
      'PERMISSION_DENIED',
    );
    expect(entriesOf(profile)[0]).toMatchObject({ topic: 'orders', error: 'PERMISSION_DENIED' });
    expect(entriesOf(profile)[0]?.messageId).toBeUndefined();
  });

  it('records the failure and re-throws when the client throws synchronously', () => {
    const profile = makeProfile();
    const target = makeTarget({ throws: new TypeError('Data must be in the form of a Buffer') });
    patchPubSubPublish(target, makeCls(profile));

    expect(() => target.publishMessage.call(TOPIC, {})).toThrow(TypeError);
    expect(entriesOf(profile)[0]?.error).toBe('Data must be in the form of a Buffer');
  });

  describe('callback convention', () => {
    it('records the message id and hands it to the caller callback', async () => {
      const profile = makeProfile();
      const target = makeTarget({ messageId: 'cb-1' });
      patchPubSubPublish(target, makeCls(profile));

      const messageId = await new Promise((resolve, reject) => {
        void target.publishMessage.call(TOPIC, { json: { id: 1 } }, (error, id) =>
          error ? reject(error) : resolve(id),
        );
      });

      expect(messageId).toBe('cb-1');
      expect(entriesOf(profile)[0]).toMatchObject({ messageId: 'cb-1', payload: { id: 1 } });
    });

    it('records the error and hands it to the caller callback', async () => {
      const profile = makeProfile();
      const target = makeTarget({ error: new Error('UNAVAILABLE') });
      patchPubSubPublish(target, makeCls(profile));

      const error = await new Promise((resolve) => {
        void target.publishMessage.call(TOPIC, { json: {} }, (err) => resolve(err));
      });

      expect((error as Error).message).toBe('UNAVAILABLE');
      expect(entriesOf(profile)[0]?.error).toBe('UNAVAILABLE');
    });

    it('records the failure and re-throws when the client throws synchronously', () => {
      const profile = makeProfile();
      const target = makeTarget({ throws: new TypeError('bad attributes') });
      patchPubSubPublish(target, makeCls(profile));

      expect(() => target.publishMessage.call(TOPIC, {}, () => undefined)).toThrow(
        'bad attributes',
      );
      expect(entriesOf(profile)[0]?.error).toBe('bad attributes');
    });
  });

  it('files the entry under the profile and span active at call time, not at settle time', async () => {
    const callTime = makeProfile();
    const other = makeProfile();
    let current: Profile = callTime;
    let span = 'span-call';
    const cls = {
      get: (key: string): unknown => (key === PROFILER_CLS_KEYS.activeSpanId ? span : current),
    } as unknown as ClsService;
    const target = makeTarget();
    patchPubSubPublish(target, cls);

    const pending = target.publishMessage.call(TOPIC, { json: { id: 1 } });
    // A concurrent request takes over the context before the batch settles.
    current = other;
    span = 'span-other';
    await pending;

    expect(entriesOf(other)).toHaveLength(0);
    expect(entriesOf(callTime)[0]).toMatchObject({ parentSpanId: 'span-call' });
  });

  it('records nothing outside a profiled request', async () => {
    for (const cls of [makeCls(undefined), makeCls('throws')]) {
      const target = makeTarget({ messageId: 'raw' });
      const original = target.publishMessage;
      patchPubSubPublish(target, cls);

      await expect(target.publishMessage.call(TOPIC, { json: {} })).resolves.toBe('raw');
      expect(target.publishMessage).not.toBe(original);
    }
  });

  it('never breaks the publish when the recording itself fails', async () => {
    const profile = makeProfile();
    const target = makeTarget({ messageId: 'ok' });
    patchPubSubPublish(target, makeCls(profile));
    const nameless = {
      get name(): string {
        throw new Error('no name');
      },
    };

    await expect(target.publishMessage.call(nameless, { json: {} })).resolves.toBe('ok');
    expect(entriesOf(profile)).toHaveLength(0);
  });

  it('is idempotent: patching twice records a publish once', async () => {
    const profile = makeProfile();
    const target = makeTarget();
    patchPubSubPublish(target, makeCls(profile));
    const once = target.publishMessage;
    patchPubSubPublish(target, makeCls(profile));

    expect(target.publishMessage).toBe(once);
    await target.publishMessage.call(TOPIC, { json: {} });
    expect(entriesOf(profile)).toHaveLength(1);
  });

  it('passes a non-promise result through untouched', () => {
    const profile = makeProfile();
    const target = {
      publishMessage: (): void => undefined,
    } as unknown as PublishTarget;
    patchPubSubPublish(target, makeCls(profile));

    expect(target.publishMessage.call(TOPIC, {})).toBeUndefined();
  });
});

describe('patchPubSubPublish on the real @google-cloud/pubsub Topic', () => {
  const prototype = Topic.prototype as unknown as PublishTarget;
  const original = prototype.publishMessage;

  afterEach(() => {
    prototype.publishMessage = original;
  });

  it('captures publishMessage, publishJSON and publish — they all route through publishMessage', async () => {
    const profile = makeProfile();
    patchPubSubPublish(prototype, makeCls(profile));
    const topic = new PubSub({ projectId: 'my-project' }).topic('orders');
    // Stub the network layer only: the Topic logic (json → data, routing) stays real.
    jest.spyOn(topic.publisher, 'publishMessage').mockResolvedValue('server-id' as never);

    await topic.publishMessage({ json: { via: 'publishMessage' } });
    await topic.publishJSON({ via: 'publishJSON' });
    await topic.publish(Buffer.from('raw text'), { kind: 'legacy' });

    expect(entriesOf(profile)).toEqual([
      expect.objectContaining({
        topic: 'orders',
        projectId: 'my-project',
        payload: { via: 'publishMessage' },
        messageId: 'server-id',
      }),
      expect.objectContaining({ payload: { via: 'publishJSON' } }),
      expect.objectContaining({ payload: 'raw text', attributes: { kind: 'legacy' } }),
    ]);
  });
});

describe('PubSubPublishPatch', () => {
  const prototype = Topic.prototype as unknown as PublishTarget;
  const original = prototype.publishMessage;

  afterEach(() => {
    prototype.publishMessage = original;
  });

  function moduleRefResolving(cls: ClsService | undefined): ModuleRef {
    return {
      get: (token: unknown) => {
        if (token === ClsServiceToken && cls) return cls;
        throw new Error('not found');
      },
    } as unknown as ModuleRef;
  }

  it('patches Topic.prototype.publishMessage when the CLS service is available', () => {
    new PubSubPublishPatch(moduleRefResolving(makeCls(makeProfile()))).onModuleInit();
    expect(prototype.publishMessage).not.toBe(original);
  });

  it('leaves publishMessage untouched when the core provides no CLS service', () => {
    new PubSubPublishPatch(moduleRefResolving(undefined)).onModuleInit();
    expect(prototype.publishMessage).toBe(original);
  });
});
