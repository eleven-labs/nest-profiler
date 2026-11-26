import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Topic } from '@google-cloud/pubsub';
import { ClsService } from 'nestjs-cls';
import { PROFILER_CLS_KEYS, appendCollectorEntry, tryResolve } from '@eleven-labs/nest-profiler';
import type { Profile } from '@eleven-labs/nest-profiler';
import {
  capturePublishPayload,
  extractAttributes,
  messageSize,
  parseTopicName,
  resolveMaskAttributes,
} from './pubsub-publish.util.js';
// Import the options token from the interface module, never from
// `./pubsub-publish-collector.module`: that module imports this file, and the resulting cycle
// leaves the re-exported token undefined when the decorators below run — `@Inject(undefined)`
// then silently degrades to the `@Optional()` default, so every option would be ignored.
import {
  PUBSUB_PUBLISHES_KEY,
  PUBSUB_PUBLISH_COLLECTOR_OPTIONS,
} from './pubsub-publish-collector.interface.js';
import type {
  PubSubPublishEntry,
  PubSubPublishCollectorModuleOptions,
} from './pubsub-publish-collector.interface.js';

/** The `MessageOptions` fields the patch reads — a structural subset of the client's type. */
export interface PublishedMessage {
  data?: Buffer | Uint8Array | null;
  json?: unknown;
  attributes?: Record<string, string> | null;
  orderingKey?: string | null;
}

/** The client's publish callback: an error, or the server-assigned message id. */
type PublishCallback = (error?: Error | null, messageId?: string | null) => void;

/** `Topic.prototype.publishMessage`, plus the idempotence marker the patch stamps on it. */
type PublishMessageFn = ((
  this: PublishingTopic,
  message: PublishedMessage,
  callback?: PublishCallback,
) => Promise<string> | void) & { __profilerPatched?: boolean };

/** The `Topic` instance `publishMessage` runs on — only its name is read. */
export interface PublishingTopic {
  readonly name: string;
}

/** The narrow surface the patch needs — satisfied by `Topic.prototype`. */
export interface PublishTarget {
  publishMessage: PublishMessageFn;
}

/** What the patch knows about a publish once it settled. */
interface PublishOutcome {
  messageId?: string;
  error?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPromiseLike(value: unknown): value is PromiseLike<string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * Wraps `publishMessage` on the given target so every call made while a profile is active is
 * recorded under {@link PUBSUB_PUBLISHES_KEY}. Idempotent: patching an already-patched target is a
 * no-op, so importing the module twice cannot double-count a publish.
 *
 * Both calling conventions of the client are covered — the promise one and the `callback` one —
 * as well as the `TypeError` it throws synchronously on an invalid message.
 *
 * The profile is resolved **when `publishMessage` is called**, not when it settles: the client
 * batches messages and settles them all from the async context of the batch's first publish, so a
 * lookup at settle time could file a message under a concurrent request's profile.
 *
 * Recording never changes what `publishMessage` does — the original result is returned and the
 * original error re-thrown, and a failure inside the recording itself is swallowed.
 *
 * Exported for unit testing; not part of the package's public API.
 */
export function patchPubSubPublish(
  target: PublishTarget,
  cls: ClsService,
  options: PubSubPublishCollectorModuleOptions = {},
): void {
  const original = target.publishMessage;
  if (typeof original !== 'function' || original.__profilerPatched === true) return;

  const maskAttributes = resolveMaskAttributes(options.maskAttributes);

  /** The active profile and the span open at call time, or `undefined` outside a profile. */
  const activeContext = (): { profile: Profile; parentSpanId?: string } | undefined => {
    try {
      // Throws outside a CLS context (a publish at bootstrap, from a cron job…), and returns
      // undefined when the request was not profiled — both mean "nothing to record".
      const profile = cls.get<Profile | undefined>(PROFILER_CLS_KEYS.profile);
      if (!profile) return undefined;
      const parentSpanId = cls.get<string | undefined>(PROFILER_CLS_KEYS.activeSpanId);
      return { profile, parentSpanId };
    } catch {
      return undefined;
    }
  };

  const record = (
    context: { profile: Profile; parentSpanId?: string },
    topic: PublishingTopic,
    message: PublishedMessage | undefined,
    startedAt: number,
    outcome: PublishOutcome,
  ): void => {
    try {
      const entry: PubSubPublishEntry = {
        ...parseTopicName(topic.name),
        startedAt,
        duration: Date.now() - startedAt,
      };
      if (outcome.messageId) entry.messageId = outcome.messageId;
      if (outcome.error !== undefined) entry.error = outcome.error;
      if (message?.orderingKey) entry.orderingKey = message.orderingKey;

      const size = messageSize(message?.json, message?.data);
      if (size !== undefined) entry.size = size;
      if (options.captureAttributes !== false && message?.attributes) {
        const attributes = extractAttributes(message.attributes, maskAttributes);
        if (Object.keys(attributes).length > 0) entry.attributes = attributes;
      }
      if (options.captureBody !== false) {
        const payload = capturePublishPayload(message?.json, message?.data, options.payloadLimits);
        if (payload !== undefined) entry.payload = payload;
      }
      // Stamped from the call-time context: `appendCollectorEntry` would read the settle-time one.
      if (context.parentSpanId !== undefined) {
        (entry as PubSubPublishEntry & { parentSpanId?: string }).parentSpanId =
          context.parentSpanId;
      }

      appendCollectorEntry<PubSubPublishEntry>(context.profile, PUBSUB_PUBLISHES_KEY, entry);
    } catch {
      // An unserializable payload or a topic without a name — never break the publish.
    }
  };

  const patched: PublishMessageFn = function instrumentedPublishMessage(
    this: PublishingTopic,
    message: PublishedMessage,
    callback?: PublishCallback,
  ): Promise<string> | void {
    const context = activeContext();
    if (!context) return original.call(this, message, callback);

    const startedAt = Date.now();
    const settle = (outcome: PublishOutcome): void =>
      record(context, this, message, startedAt, outcome);

    if (typeof callback === 'function') {
      const instrumentedCallback: PublishCallback = (error, messageId) => {
        settle(error ? { error: errorMessage(error) } : { messageId: messageId ?? undefined });
        callback(error, messageId);
      };
      try {
        return original.call(this, message, instrumentedCallback);
      } catch (error) {
        settle({ error: errorMessage(error) });
        throw error;
      }
    }

    let result: Promise<string> | void;
    try {
      result = original.call(this, message);
    } catch (error) {
      settle({ error: errorMessage(error) });
      throw error;
    }
    if (!isPromiseLike(result)) return result;

    return Promise.resolve(result).then(
      (messageId) => {
        settle({ messageId });
        return messageId;
      },
      (error: unknown) => {
        settle({ error: errorMessage(error) });
        throw error;
      },
    );
  };

  patched.__profilerPatched = true;
  target.publishMessage = patched;
}

/**
 * Instruments outgoing Pub/Sub messages by patching `Topic.prototype.publishMessage`
 * (`@google-cloud/pubsub`).
 *
 * The prototype is the hook point: topics are created by the application's own `PubSub` client,
 * so there is no instance to decorate at wiring time — and patching the prototype covers every
 * topic and every client an application creates, plus `topic.publish()` and `topic.publishJSON()`,
 * which the client routes through `publishMessage`.
 */
@Injectable()
export class PubSubPublishPatch implements OnModuleInit {
  constructor(
    private readonly moduleRef: ModuleRef,
    @Optional()
    @Inject(PUBSUB_PUBLISH_COLLECTOR_OPTIONS)
    private readonly options: PubSubPublishCollectorModuleOptions = {},
  ) {}

  onModuleInit(): void {
    // Resolve lazily via ModuleRef (it traverses to the core's global ClsModule); no-op when the
    // core is disabled, so a `ProfilerNoopModule` setup leaves `publishMessage` untouched.
    const cls = tryResolve<ClsService>(this.moduleRef, ClsService);
    if (!cls) return;
    patchPubSubPublish(Topic.prototype, cls, this.options);
  }
}
