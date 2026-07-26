import type { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';

// Where `@OnEvent` stores its `{ event, options }` array on the handler method. Read directly
// because @nestjs/event-emitter does not export the accessor.
export const EVENT_LISTENER_METADATA = 'EVENT_LISTENER_METADATA';

/** Raw `@OnEvent` metadata entry stored on a handler method. */
interface OnEventMeta {
  event: unknown;
  options?: { async?: boolean; prependListener?: boolean };
}

/** One discovered `@OnEvent` subscription. */
export interface DiscoveredListener {
  /** The event name (or dotted namespace) the handler subscribes to. */
  event: string;
  /** The provider or controller class holding the handler. */
  provider: string;
  /** The decorated method name. */
  method: string;
  /** `true` when registered with `{ async: true }`. */
  async: boolean;
  /** `true` when registered with `{ prependListener: true }`. */
  prepend: boolean;
  /** The instance owning the handler, used by the profiler to wrap the method. */
  instance: Record<string, unknown>;
}

export function toEventName(event: unknown): string {
  if (typeof event === 'string') return event;
  if (Array.isArray(event)) return event.join('.');
  return String(event);
}

/**
 * Finds the method on the prototype chain rather than on the instance, so discovery still sees the
 * `@OnEvent` metadata after the profiler has wrapped the instance method.
 */
export function findHandlerFn(
  instance: object,
  methodName: string,
): ((...args: unknown[]) => unknown) | undefined {
  let proto: object | null = Object.getPrototypeOf(instance) as object | null;
  while (proto && proto !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, methodName);
    if (descriptor && typeof descriptor.value === 'function') {
      return descriptor.value as (...args: unknown[]) => unknown;
    }
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  return undefined;
}

/**
 * Discovers every `@OnEvent` subscription across the DI container. Shared by the Routes source and
 * the per-execution profiler so both see the same set.
 *
 * Scans providers **and** controllers, like `@nestjs/event-emitter`'s own `EventSubscribersLoader`
 * — a `@OnEvent` handler declared on a controller is a valid subscription.
 *
 * Request-scoped subscribers are skipped: they have no static `instance`, and the loader resolves a
 * fresh instance per event through `Injector.loadPerContext`, so there is nothing stable to wrap.
 */
export function scanEventListeners(
  discovery: DiscoveryService,
  metadataScanner: MetadataScanner,
  reflector: Reflector,
): DiscoveredListener[] {
  const listeners: DiscoveredListener[] = [];
  const seen = new Set<string>();

  for (const wrapper of [...discovery.getProviders(), ...discovery.getControllers()]) {
    if (wrapper.isAlias) continue;
    const instance = wrapper.instance as Record<string, unknown> | null | undefined;
    if (!instance || typeof instance !== 'object') continue;

    const prototype = Object.getPrototypeOf(instance) as object | null;
    if (!prototype) continue;

    const provider =
      (instance as { constructor?: { name?: string } }).constructor?.name ?? 'Unknown';

    for (const methodName of metadataScanner.getAllMethodNames(prototype)) {
      const handler = findHandlerFn(instance, methodName);
      if (!handler) continue;

      const meta = reflector.get<OnEventMeta[] | undefined>(EVENT_LISTENER_METADATA, handler);
      if (!meta) continue;

      for (const { event, options } of meta) {
        const name = toEventName(event);
        const key = `${provider}.${methodName}::${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        listeners.push({
          event: name,
          provider,
          method: methodName,
          async: options?.async === true,
          prepend: options?.prependListener === true,
          instance,
        });
      }
    }
  }

  listeners.sort(
    (a, b) =>
      a.event.localeCompare(b.event) ||
      a.provider.localeCompare(b.provider) ||
      a.method.localeCompare(b.method),
  );
  return listeners;
}
