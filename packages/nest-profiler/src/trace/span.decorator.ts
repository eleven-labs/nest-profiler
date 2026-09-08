import { ClsServiceManager } from 'nestjs-cls';
import { runInSpan } from './run-in-span';

/* eslint-disable @typescript-eslint/no-unsafe-function-type */

/** Any method the decorator can wrap. */
type AnyMethod = (this: unknown, ...args: never[]) => unknown;

/**
 * Records a method as one span of the trace, without touching its body.
 *
 * ```ts
 * @Injectable()
 * export class ProductService {
 *   @Span()
 *   async findAll(): Promise<Product[]> {
 *     return this.repo.findAll();
 *   }
 * }
 * ```
 *
 * Prefer this over `TracerService.span()` when what you want to measure *is* the method: it costs
 * one line, leaves the body at its own indentation, and — unlike a callback — cannot change what
 * `return` means inside it. Reach for `span()` when you need to time a block *within* a method, or
 * to tag the span from the work itself.
 *
 * Like everything else on the tracer, this is a no-op outside a profiled execution: the method
 * runs and returns exactly as it would without the decorator. It needs no injection either — the
 * active profile is resolved from the process-wide CLS store, the same one the profiler writes on
 * each request — so it works on a provider that has never heard of `TracerService`.
 *
 * The span becomes the **active** one for the duration of the call, so every query, outgoing call
 * and log line the method issues is recorded underneath it.
 *
 * @param name - Span label. Defaults to `ClassName.methodName`, which is what you want often
 *   enough that naming it is the exception.
 */
export function Span(name?: string): MethodDecorator {
  return <T>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>,
  ): TypedPropertyDescriptor<T> => {
    const original = descriptor.value as AnyMethod | undefined;
    if (typeof original !== 'function') return descriptor;

    // `target` is the prototype for an instance method and the constructor for a static one.
    const className =
      (target as { constructor?: { name?: string } })?.constructor?.name ??
      (target as { name?: string })?.name ??
      'Anonymous';
    const label = name ?? `${className}.${String(propertyKey)}`;

    const method = original;
    function traced(this: unknown, ...args: never[]): unknown {
      // Resolved per call, not per decoration: the store is only there once a request is in
      // flight, and the decorator is applied at class-definition time.
      const cls = tryResolveCls();
      return runInSpan(cls, label, () => method.apply(this, args));
    }

    // Nest reads its own metadata (routes, guards, pipes, `@Cron`…) off the method it finds on the
    // prototype. Replacing the function without carrying that across would silently unregister
    // whatever else decorates it — a `@Get()` below a `@Span()` would stop being a route.
    copyMetadata(original, traced);
    Object.defineProperty(traced, 'name', { value: original.name, configurable: true });
    Object.defineProperty(traced, 'length', { value: original.length, configurable: true });

    descriptor.value = traced as T;
    return descriptor;
  };
}

/**
 * The process-wide CLS service, or `undefined` when there is none.
 *
 * Never throws: a decorated method may well run before `ClsModule` is initialized (a provider
 * called during bootstrap), and a debugging aid must not be what breaks it.
 */
function tryResolveCls(): ReturnType<typeof ClsServiceManager.getClsService> | undefined {
  try {
    return ClsServiceManager.getClsService();
  } catch {
    return undefined;
  }
}

function copyMetadata(from: Function, to: Function): void {
  const reflect = Reflect as typeof Reflect & {
    getMetadataKeys?: (target: object) => unknown[];
    getMetadata?: (key: unknown, target: object) => unknown;
    defineMetadata?: (key: unknown, value: unknown, target: object) => void;
  };
  // `reflect-metadata` is a peer the host loads; guard rather than assume, so a consumer that
  // decorates a plain class without it still gets a working span.
  if (!reflect.getMetadataKeys || !reflect.getMetadata || !reflect.defineMetadata) return;
  for (const key of reflect.getMetadataKeys(from)) {
    reflect.defineMetadata(key, reflect.getMetadata(key, from), to);
  }
}
