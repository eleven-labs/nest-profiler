import type { DynamicModule, ModuleMetadata, Provider } from '@nestjs/common';

/**
 * The collector-specific wiring merged on top of the `DynamicModule` produced by a
 * NestJS `ConfigurableModuleBuilder`. Lets every collector share one canonical
 * `forRoot`/`forRootAsync` post-processing step (see {@link buildCollectorModule}).
 */
export interface CollectorModuleShape {
  /** Extra imports for the active (enabled) path. */
  imports?: ModuleMetadata['imports'];
  /** Fixed providers always registered in the active path (the collector, its patch/adapter…). */
  providers?: Provider[];
  /** Providers/tokens re-exported (e.g. a recorder that is part of the public API). */
  exports?: ModuleMetadata['exports'];
  /**
   * The module returned when `enabled === false`. Defaults to an inert `{ module }` (no
   * providers). Collectors that must keep a public provider injectable while disabled
   * (e.g. the http recorder, the validator pipe) supply their own shape; they receive the
   * builder `base` so they can reuse its options-token provider.
   */
  disabled?: (base: DynamicModule) => DynamicModule;
}

/**
 * Post-processes the `DynamicModule` returned by a collector's generated
 * `ConfigurableModuleClass` (`super.forRoot` / `super.forRootAsync`), merging in the fixed
 * collector providers and centralizing the synchronous `enabled: false` short-circuit.
 *
 * `base` already carries the options-token provider — `{ provide: TOKEN, useValue }` for the
 * sync path, `{ provide: TOKEN, useFactory, inject }` (plus async `imports`) for the async
 * path — so callers only describe the collector-specific {@link CollectorModuleShape}.
 *
 * `enabled` stays a build-time flag (it decides which providers are registered, which an async
 * factory cannot); real per-environment gating is the host's job via
 * `ConditionalModule.registerWhen(...)`.
 */
export function buildCollectorModule(
  base: DynamicModule,
  options: { enabled?: boolean },
  shape: CollectorModuleShape = {},
): DynamicModule {
  if (options.enabled === false) {
    return shape.disabled ? shape.disabled(base) : { module: base.module };
  }

  return {
    ...base,
    module: base.module,
    imports: [...(base.imports ?? []), ...(shape.imports ?? [])],
    providers: [...(base.providers ?? []), ...(shape.providers ?? [])],
    exports: [...(base.exports ?? []), ...(shape.exports ?? [])],
  };
}
