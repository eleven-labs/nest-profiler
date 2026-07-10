import type { Type } from '@nestjs/common';

/**
 * NestJS stores the guards applied by `@UseGuards()` under this metadata key — on the controller
 * class and, for method-level guards, on the handler function. Mirrored locally rather than
 * deep-importing `@nestjs/common` internals.
 *
 * @see `@nestjs/common` `GUARDS_METADATA`.
 */
const GUARDS_METADATA = '__guards__';

/** Resolves a guard's display name whether it was registered as a class or an instance. */
function guardName(guard: unknown): string | undefined {
  if (typeof guard === 'function') return guard.name;
  if (guard && typeof guard === 'object') {
    return (guard as { constructor?: { name?: string } }).constructor?.name;
  }
  return undefined;
}

/**
 * Collects the guard class names protecting a route — `@UseGuards()` on the controller **and** on
 * the handler — so the panel can flag protected (e.g. authentication-guarded) routes. Only
 * route-level guards are visible here: a global `APP_GUARD` is not attached per handler, so a
 * "public unless `@Public()`" setup is not reflected.
 */
export function readRouteGuards(controllerType: Type, methodName: string): string[] {
  const proto = controllerType.prototype as Record<string, unknown>;
  const method = proto[methodName];
  const lists = [
    Reflect.getMetadata(GUARDS_METADATA, controllerType) as unknown,
    typeof method === 'function'
      ? (Reflect.getMetadata(GUARDS_METADATA, method) as unknown)
      : undefined,
  ];

  const names: string[] = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const guard of list) {
      const name = guardName(guard);
      if (name && !names.includes(name)) names.push(name);
    }
  }
  return names;
}
