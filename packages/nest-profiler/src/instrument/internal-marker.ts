/**
 * Brand set on the profiler's own provider classes so the automatic instrumentation never records
 * them.
 *
 * `Symbol.for` rather than a module-local symbol: a monorepo can legitimately resolve two copies
 * of the core (a satellite package pinned to a different version, a pnpm layout that does not
 * dedupe), and a brand that differs between them would let one copy instrument the other.
 */
const INTERNAL = Symbol.for('nest-profiler:internal');

/**
 * Marks classes as profiler internals, excluded from automatic instrumentation.
 *
 * Without this the profiler records *itself*: a single request produced 75 spans of which about a
 * dozen were application code, the rest being `ClsService.get`, the interceptor, the collector
 * registry and — recursively — the tracer opening the spans. The signal the feature exists to
 * surface was buried under the machinery surfacing it.
 *
 * Applied per module rather than per class: a module already lists its providers, so tagging them
 * there costs one call and cannot fall out of sync as providers are added.
 *
 * @param targets - Provider classes, or any provider list (non-class entries are ignored).
 */
export function markInternal(targets: readonly unknown[]): void {
  for (const target of targets) {
    if (typeof target === 'function') {
      Object.defineProperty(target, INTERNAL, { value: true, configurable: true });
    }
  }
}

/**
 * Whether an instance belongs to the profiler itself.
 *
 * Reads the brand off the constructor, so a subclass of a marked class is internal too — which is
 * what makes the ORM collectors extending `AbstractQueryCollector` excluded without each package
 * having to remember.
 */
export function isInternal(instance: object): boolean {
  const ctor = (instance as { constructor?: unknown }).constructor;
  return (
    typeof ctor === 'function' && (ctor as unknown as Record<symbol, unknown>)[INTERNAL] === true
  );
}
