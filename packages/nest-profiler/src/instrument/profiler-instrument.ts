import { Logger } from '@nestjs/common';
import { ClsServiceManager } from 'nestjs-cls';
import { loadOptionalPeer } from '../utils/optional-peer.util';
import { runInSpan } from '../trace/run-in-span';
import { readActiveSpanDepth, setActiveSpanDepth } from '../services/profiler-context';
import { isInternal } from './internal-marker';
import {
  isCallableObject,
  isClass,
  isNativeFunction,
  isSlotBackedBuiltIn,
  usesNativePrivateMembers,
} from './skip-instrumentation';

/* eslint-disable @typescript-eslint/no-unsafe-function-type */

/** Options accepted by {@link createProfilerInstrument}. */
export interface ProfilerInstrumentOptions {
  /**
   * Also record the profiler's own providers and the CLS service. Default: `false`, and you almost
   * certainly want to leave it that way — it exists to debug the profiler itself.
   *
   * With it on, a single request goes from a dozen spans of application code to some seventy-five,
   * the rest being the interceptor, the collector registry, `ClsService.get` and — recursively —
   * the tracer opening the spans.
   */
  includeInternals?: boolean;
  /**
   * Also record instances that carry no class name of their own — the anonymous wrappers Nest
   * builds around a guard or an interceptor, which surface as `Object.canActivate` and
   * `Object.intercept`. Default: `false`.
   *
   * They are skipped because the label is the whole value of a method span: `Object.intercept`
   * names nothing a reader can act on, while sitting between the request and the controller and
   * pushing everything below it a level deeper. Skipping one does not orphan its children — they
   * reparent to whatever was active above it, which is the entrypoint.
   */
  includeAnonymous?: boolean;
  /**
   * Skip instrumenting an instance entirely. Return `true` for a provider whose calls you do not
   * want on the trace — a hot utility called thousands of times, a third-party client you do not
   * own.
   *
   * The instance is handed back untouched, so it keeps its exact identity and behaviour.
   */
  skip?: (instance: object) => boolean;
  /**
   * How deep the call tree may go before further calls stop opening spans. Default: `20`.
   *
   * Not a safety valve against runaway recursion — the re-entrancy guard covers that — but against
   * *illegibility*: a waterfall 40 levels deep answers no question, and every level past the point
   * you stopped reading still costs a span, a CLS scope and a row in the stored profile.
   */
  maxDepth?: number;
}

/** Default for {@link ProfilerInstrumentOptions.maxDepth}. */
const DEFAULT_MAX_DEPTH = 20;

/**
 * Builds the `instanceDecorator` that records **one span per provider method call**, turning the
 * waterfall into a full call tree: which service called which repository, and what each cost.
 *
 * Pass the result to `NestFactory`:
 *
 * ```ts
 * const app = await NestFactory.create(AppModule, {
 *   instrument: createProfilerInstrument(),
 * });
 * ```
 *
 * **Opt-in, and deliberately so.** It places a Proxy on every provider instance, so every property
 * access on every provider goes through a trap. That is a real cost, paid on every request whether
 * or not it is profiled — appropriate for a development or staging environment, not for production.
 *
 * Nest wraps the decorator in its own `makeSafeInstanceDecorator`, so an instance this throws on
 * degrades to the undecorated original with a warning instead of failing the bootstrap.
 *
 * @param options - Instances to skip, and how deep to record.
 */
export function createProfilerInstrument(options: ProfilerInstrumentOptions = {}): {
  instanceDecorator: (instance: unknown) => unknown;
} {
  warnIfNestTooOld();

  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const userSkip = options.skip;
  const includeInternals = options.includeInternals ?? false;

  const includeAnonymous = options.includeAnonymous ?? false;

  const skip = (instance: object): boolean => {
    if (!includeInternals && (isInternal(instance) || isClsService(instance))) return true;
    if (!includeAnonymous && isAnonymous(instance)) return true;
    return userSkip?.(instance) === true;
  };

  return {
    instanceDecorator: (instance: unknown): unknown => {
      if (typeof instance !== 'object' || instance === null) return instance;
      return instrumentInstance(instance, { skip, maxDepth });
    },
  };
}

function instrumentInstance(
  instance: object,
  options: { skip?: (instance: object) => boolean; maxDepth: number },
): object {
  if (options.skip?.(instance)) return instance;

  let requiresRawReceiver: boolean;
  let bareBuiltIn: boolean;
  try {
    const slotBacked = isSlotBackedBuiltIn(instance);
    // A bare built-in registered as a provider (`useValue: new Map()`) has no user code to trace:
    // every method on it is native, and each one would throw through the Proxy. A user *subclass*
    // of a built-in still carries methods worth tracing, so it falls through to the raw-receiver
    // path below instead.
    bareBuiltIn = slotBacked && isNativeFunction(instance.constructor);
    // Both conditions force calls to run against the raw instance: a native private field is
    // branded to it, and an inherited native method reads internal slots off it. The trade is one
    // level of nested self-call spans (`this.other()` no longer passes through the Proxy) for
    // methods that run at all.
    requiresRawReceiver = usesNativePrivateMembers(instance) || slotBacked;
  } catch {
    // Reading the prototype ran a trap that threw. An instance that cannot be inspected cannot be
    // instrumented; hand it back untouched.
    return instance;
  }

  if (bareBuiltIn) return instance;

  const cache = new WeakMap<Function, Function>();
  const tracing = new Set<string>();

  return new Proxy(instance, {
    get: (target, prop, receiver): unknown => {
      const value = Reflect.get(target, prop) as unknown;
      if (typeof value !== 'function' || prop === 'constructor') return Reflect.get(target, prop);
      if (isClass(value) || isCallableObject(value)) return Reflect.get(target, prop);

      const cached = cache.get(value);
      if (cached) return cached;

      const className = target.constructor?.name ?? 'Anonymous';
      const methodName = String(prop);
      const label = `${className}.${methodName}`;

      // For a private-member class, `Reflect.get` with the Proxy as receiver would already have
      // thrown on an accessor touching `this.#x`, so the value read against the target is reused.
      const original = (requiresRawReceiver ? value : Reflect.get(target, prop, receiver)) as
        Function | undefined;
      if (typeof original !== 'function') return Reflect.get(target, prop);
      // Traced calls run against the Proxy so a method calling into itself (`this.other()`) is
      // recorded as a nested span — except where only the raw instance satisfies a brand check.
      const receiverForCall: unknown = requiresRawReceiver ? target : receiver;

      const traced = function (this: unknown, ...args: unknown[]): unknown {
        // Re-entrancy guard: while a call to this method is being traced, a nested call to the
        // very same method runs untraced, so recursion cannot blow the tree up.
        if (tracing.has(methodName)) return original.apply(receiverForCall, args) as unknown;

        const cls = tryResolveCls();
        const depth = readActiveSpanDepth(cls);
        if (cls && depth >= options.maxDepth)
          return original.apply(receiverForCall, args) as unknown;

        tracing.add(methodName);
        try {
          const result = runInSpan(
            cls,
            label,
            () => {
              if (cls) setActiveSpanDepth(cls, depth + 1);
              return original.apply(receiverForCall, args) as unknown;
            },
            'method',
          );
          return relabelOnFailure(result, className, methodName);
        } catch (error) {
          relabelProxyFrame(error, className, methodName);
          throw error;
        } finally {
          tracing.delete(methodName);
        }
      };

      // Detached from any receiver on purpose: V8 hard-codes a stack frame's type name to "Proxy"
      // whenever the frame's receiver is one, and no trap can override it. The wrapper never reads
      // `this`, so handing it out unbound keeps *its* frame named after the class. The traced
      // method's own frame runs against the Proxy and is relabelled after the fact instead.
      const bound = traced.bind(undefined);
      Object.defineProperty(bound, 'name', { value: original.name, configurable: true });
      copyMetadata(original, bound);

      cache.set(value, bound);
      return bound;
    },
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rewrites the `Proxy.<method>` frame a traced call leaves behind into `<Class>.<method>`.
 *
 * V8 types any frame whose receiver is a Proxy as "Proxy", and no trap can override it. Traced
 * calls run against the Proxy on purpose — so a method calling into itself is recorded as a
 * nested span — which means the *original* method's frame is the one that pays for it, and that is
 * precisely the frame the Exceptions tab leads with.
 *
 * Only the topmost match is rewritten: every wrapper on the way out relabels its own frame, and
 * inner calls unwind before outer ones, so two classes sharing a method name each end up right.
 */
function relabelProxyFrame(error: unknown, className: string, methodName: string): void {
  if (!(error instanceof Error) || typeof error.stack !== 'string') return;
  // `async` prefixes the type name on a frame resumed from an await.
  const frame = new RegExp(`(\\n\\s*at (?:async )?)Proxy\\.${escapeRegExp(methodName)}\\b`);
  if (!frame.test(error.stack)) return;
  try {
    error.stack = error.stack.replace(frame, `$1${className}.${methodName}`);
  } catch {
    // Some errors ship a read-only `stack`; the label is cosmetic, so leaving it beats masking
    // the original failure.
  }
}

/** Relabels a rejected promise's error; a synchronous throw is caught at the call site. */
function relabelOnFailure<T>(result: T, className: string, methodName: string): T {
  if (typeof (result as PromiseLike<unknown> | undefined)?.then !== 'function') return result;
  return Promise.resolve(result).then(undefined, (error: unknown) => {
    relabelProxyFrame(error, className, methodName);
    throw error;
  }) as T;
}

/**
 * The process-wide CLS service, or `undefined` when there is none.
 *
 * Never throws: a provider method may well run during bootstrap, before `ClsModule` is up, and a
 * debugging aid must not be what breaks it.
 */
function tryResolveCls(): ReturnType<typeof ClsServiceManager.getClsService> | undefined {
  try {
    return ClsServiceManager.getClsService();
  } catch {
    return undefined;
  }
}

/**
 * Carries reflect-metadata across to the wrapper. Nest reads its own metadata off the method it
 * resolves, so a route, guard or pipe declared on an instrumented method must survive the wrap.
 */
function copyMetadata(from: Function, to: Function): void {
  const reflect = Reflect as typeof Reflect & {
    getMetadataKeys?: (target: object) => unknown[];
    getMetadata?: (key: unknown, target: object) => unknown;
    defineMetadata?: (key: unknown, value: unknown, target: object) => void;
  };
  if (!reflect.getMetadataKeys || !reflect.getMetadata || !reflect.defineMetadata) return;
  for (const key of reflect.getMetadataKeys(from)) {
    reflect.defineMetadata(key, reflect.getMetadata(key, from), to);
  }
}

/**
 * Whether the instance is the CLS service.
 *
 * Third-party, so it carries no internal brand, and called several times per span by the profiler
 * itself — recording it produced a dozen `ClsService.get` rows per request, one of them credited
 * with the whole duration of the work that happened to run inside the same call.
 */
function isClsService(instance: object): boolean {
  return instance.constructor?.name === 'ClsService';
}

/** First `@nestjs/core` carrying the `instrument` option on `NestFactory`. */
const MINIMUM_NEST_VERSION = [11, 1, 4] as const;

/**
 * Warns when the installed Nest predates the `instrument` option.
 *
 * The package's peer range already asks for it, but a peer range is advisory: npm and pnpm warn
 * and install anyway. On an older Nest the option is simply ignored, so the decorator built here is
 * never called and the feature is *silently* inert — the worst failure mode for a debugging tool,
 * because the trace looks merely empty rather than unavailable. Said once, at creation.
 */
function warnIfNestTooOld(): void {
  const pkg = loadOptionalPeer<{ version?: string }>('@nestjs/core/package.json');
  const version = pkg?.version;
  if (!version || !isOlderThanMinimum(version)) return;

  new Logger('ProfilerInstrument').warn(
    `Automatic instrumentation needs @nestjs/core >= ${MINIMUM_NEST_VERSION.join('.')} for the ` +
      `"instrument" option on NestFactory; found ${version}. No method spans will be recorded — ` +
      `upgrade @nestjs/core, or drop the "instrument" option to silence this.`,
  );
}

function isOlderThanMinimum(version: string): boolean {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10));
  // An unparseable version (a git or workspace specifier) is not evidence of anything; stay quiet
  // rather than warn on a setup that may well be fine.
  if (parts.some((part) => !Number.isFinite(part))) return false;
  for (const [index, minimum] of MINIMUM_NEST_VERSION.entries()) {
    const found = parts[index] ?? 0;
    if (found !== minimum) return found < minimum;
  }
  return false;
}

/**
 * Whether the instance has no class name worth putting on a bar.
 *
 * A plain object literal — which is what Nest's guard and interceptor wrappers are — reports
 * `Object` as its constructor name, so its spans read `Object.canActivate` and `Object.intercept`.
 * That names nothing, and the bar still costs a level of depth for everything under it.
 */
function isAnonymous(instance: object): boolean {
  const name = instance.constructor?.name;
  return !name || name === 'Object';
}
