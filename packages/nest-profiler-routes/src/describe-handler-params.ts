import type { Type } from '@nestjs/common';
import type { RouteDtoInfo, RouteDtoProperty, RouteInputs } from '@eleven-labs/nest-profiler';

/**
 * NestJS stores each handler's parameter decorators (`@Param`, `@Query`, `@Body`, `@Headers`…)
 * under this metadata key on the controller **constructor**, keyed by method name. The value is a
 * record keyed `"<paramtype>:<index>"`. We mirror the key and the param-type ids locally rather
 * than deep-importing `@nestjs/common` internals, so a minor bump can't break our build; the
 * {@link handlerHasRouteArgs} canary lets callers detect a shape change at runtime.
 *
 * @see `@nestjs/common` `ROUTE_ARGS_METADATA` and the `RouteParamtypes` enum.
 */
const ROUTE_ARGS_METADATA = '__routeArguments__';

/** `RouteParamtypes` ids we care about (verified against @nestjs/common v11). */
const PARAMTYPE = { BODY: 3, QUERY: 4, PARAM: 5, HEADERS: 6 } as const;

/** Defensive caps so a pathological controller can't blow up the panel. */
const MAX_NAMES = 100;
const MAX_PROPERTIES = 100;

/** JS design types that carry no useful DTO shape — treated as "no body DTO". */
const PRIMITIVE_TYPES = new Set<unknown>([String, Number, Boolean, Object, Array, Date, Function]);

interface RouteArgMeta {
  index: number;
  data?: unknown;
}

/** Minimal structural view of a class-validator `ValidationMetadata`. */
interface ValidationMetadataLike {
  propertyName?: string;
  type?: string;
  name?: string;
}

interface ClassValidatorStorage {
  getTargetValidationMetadatas(
    target: object,
    schema: string | null,
    always: boolean,
    strictGroups: boolean,
  ): ValidationMetadataLike[];
}

// Resolve class-validator's metadata storage once, lazily. `undefined` = not yet resolved,
// `null` = resolved-but-absent (package not installed). Kept optional so the package adds no
// hard dependency; the panel degrades to DTO class name only when it is missing.
let cvStorage: ClassValidatorStorage | null | undefined;

function getClassValidatorStorage(): ClassValidatorStorage | null {
  if (cvStorage !== undefined) return cvStorage;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('class-validator') as { getMetadataStorage?: () => ClassValidatorStorage };
    cvStorage = typeof mod.getMetadataStorage === 'function' ? mod.getMetadataStorage() : null;
  } catch {
    cvStorage = null;
  }
  return cvStorage;
}

/** Reads and validates the raw route-args metadata bag for a handler. */
function readRouteArgs(controllerType: Type, methodName: string): Record<string, RouteArgMeta> {
  const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, controllerType, methodName) as
    Record<string, RouteArgMeta> | undefined;
  return meta && typeof meta === 'object' ? meta : {};
}

/** `true` when the handler declared any recognised parameter decorator — the canary signal. */
export function handlerHasRouteArgs(controllerType: Type, methodName: string): boolean {
  return Object.keys(readRouteArgs(controllerType, methodName)).length > 0;
}

/** Extracts the `:param` names from a route path (`/users/:id/books/:bookId` → `['id','bookId']`). */
function pathParamNames(path: string): string[] {
  const names: string[] = [];
  for (const match of path.matchAll(/:([A-Za-z0-9_]+)/g)) {
    if (match[1] && !names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

/** Collects the class type at `paramtypes[index]`, or `undefined` when it is a primitive/unknown. */
function dtoTypeAt(controllerType: Type, methodName: string, index: number): Type | undefined {
  const proto = controllerType.prototype as object;
  const paramtypes = Reflect.getMetadata('design:paramtypes', proto, methodName) as
    unknown[] | undefined;
  const candidate = paramtypes?.[index];
  if (typeof candidate !== 'function' || PRIMITIVE_TYPES.has(candidate)) return undefined;
  return candidate as Type;
}

/** Aggregates class-validator metadata for a DTO into `{ property → rules, optional }`. */
function validatedProperties(dtoClass: Type): Map<string, { rules: string[]; optional: boolean }> {
  const byProp = new Map<string, { rules: string[]; optional: boolean }>();
  const storage = getClassValidatorStorage();
  if (!storage) return byProp;

  let metas: ValidationMetadataLike[];
  try {
    metas = storage.getTargetValidationMetadatas(dtoClass, null, false, false);
  } catch {
    return byProp;
  }

  for (const meta of metas) {
    const prop = meta.propertyName;
    if (!prop) continue;
    const entry = byProp.get(prop) ?? { rules: [], optional: false };
    // `@IsOptional()` registers as a conditional-validation metadata, not a named rule.
    if (meta.type === 'conditionalValidation') {
      entry.optional = true;
    } else {
      const label = meta.name ?? meta.type;
      if (label && !entry.rules.includes(label)) entry.rules.push(label);
    }
    byProp.set(prop, entry);
  }
  return byProp;
}

/** Describes a `@Body()` DTO's top-level properties (name, TS type, class-validator rules). */
function describeDto(dtoClass: Type): RouteDtoInfo {
  const props = validatedProperties(dtoClass);
  const properties: RouteDtoProperty[] = [];
  const proto = dtoClass.prototype as object;
  for (const [name, { rules, optional }] of props) {
    if (properties.length >= MAX_PROPERTIES) break;
    const designType = Reflect.getMetadata('design:type', proto, name) as
      { name?: string } | undefined;
    properties.push({
      name,
      tsType: designType?.name ?? 'unknown',
      ...(rules.length > 0 ? { rules } : {}),
      ...(optional ? { optional: true } : {}),
    });
  }
  return { name: dtoClass.name, properties };
}

function pushName(target: string[], value: unknown): void {
  if (typeof value === 'string' && value && target.length < MAX_NAMES && !target.includes(value)) {
    target.push(value);
  }
}

/**
 * Introspects a single HTTP handler's inputs from its decorator metadata:
 * path params (from the route path), query params and headers (from `@Query`/`@Headers`), and the
 * body DTO (from `@Body()` resolved via `design:paramtypes`). Top-level only — nested DTO
 * properties surface as their class name, not expanded. Returns `undefined` when nothing is found.
 */
export function describeHandlerParams(
  controllerType: Type,
  methodName: string,
  path: string,
): RouteInputs | undefined {
  const args = readRouteArgs(controllerType, methodName);

  const params = pathParamNames(path);
  const query: string[] = [];
  const headers: string[] = [];
  let body: RouteDtoInfo | undefined;

  for (const [key, arg] of Object.entries(args)) {
    const paramtype = Number(key.split(':')[0]);
    switch (paramtype) {
      case PARAMTYPE.QUERY:
        // `@Query('name')` → a named param; `@Query()` (no data) with a DTO → its property names.
        if (arg.data) {
          pushName(query, arg.data);
        } else {
          const dto = dtoTypeAt(controllerType, methodName, arg.index);
          if (dto) for (const p of describeDto(dto).properties) pushName(query, p.name);
        }
        break;
      case PARAMTYPE.HEADERS:
        pushName(headers, arg.data);
        break;
      case PARAMTYPE.BODY:
        if (!body) {
          const dto = dtoTypeAt(controllerType, methodName, arg.index);
          if (dto) body = describeDto(dto);
        }
        break;
      default:
        break;
    }
  }

  const inputs: RouteInputs = {
    ...(params.length > 0 ? { params } : {}),
    ...(query.length > 0 ? { query } : {}),
    ...(headers.length > 0 ? { headers } : {}),
    ...(body ? { body } : {}),
  };
  return Object.keys(inputs).length > 0 ? inputs : undefined;
}

/** Test seam: reset the memoized class-validator resolution. */
export function resetClassValidatorStorageCache(): void {
  cvStorage = undefined;
}
