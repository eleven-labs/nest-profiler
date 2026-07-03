import type { FilterCriterion } from '../storage/profiler-query';

/**
 * DI multi-token under which {@link ProfilerListFilter} implementations are
 * provided. Register a filter with `{ provide: PROFILER_LIST_FILTERS,
 * useValue: myFilter, multi: true }` (or call
 * {@link ProfilerCoreService.registerListFilter}) and the profiler list page
 * renders its control and applies it automatically.
 */
export const PROFILER_LIST_FILTERS = 'PROFILER_LIST_FILTERS';

/** HTML control rendered for a {@link ProfilerListFilter} on the list page. */
export type ProfilerFilterControl = 'select' | 'text' | 'number' | 'checkbox';

/** A single option for a `'select'` filter control. */
export interface ProfilerFilterOption {
  value: string;
  label: string;
}

/**
 * Contract for a filter on the profiler list page (`/_profiler`).
 *
 * Each filter is self-describing: it carries how to render its control, how to
 * parse its raw query-string value, and whether a given profile matches. The
 * core ships the universal filters (search, status, duration…) shown above every
 * list; a filter contributed by an entrypoint type's {@link ProfilerEntrypointType.listFilters}
 * is scoped to that kind and shown only above its table.
 *
 * Contribute a universal one via the {@link PROFILER_LIST_FILTERS} multi-token or
 * by calling {@link ProfilerCoreService.registerListFilter} from a module's
 * `onModuleInit`; contribute a kind-scoped one through the entrypoint type.
 *
 * @typeParam T - The parsed value type produced by {@link parse} and consumed
 *   by {@link matches}.
 */
export interface ProfilerListFilter<T = unknown> {
  /** Unique key — used both as the query-param and the form field name. */
  readonly key: string;
  /** Label shown above the control in the list form. */
  readonly label: string;
  /** Which HTML control to render. */
  readonly control: ProfilerFilterControl;
  /**
   * Static options for a `'select'` control. The first option is the "any"
   * choice. For options that depend on the captured data (the exchanges or
   * handlers actually seen, say) set {@link distinctField} instead — the profiler
   * derives the option values from the store's distinct values for that field.
   */
  readonly options?: ProfilerFilterOption[];
  /**
   * Summary field whose distinct values populate a dynamic `'select'` control, so a
   * filter can offer only the values actually present (e.g. the distinct RabbitMQ
   * exchanges or `@RabbitSubscribe` handlers) — typically an `attributes.<key>`.
   * When set, the profiler queries {@link ProfilerStorageService.distinct} and
   * prepends the "any" option; takes precedence over {@link options}.
   */
  readonly distinctField?: string;
  /** Placeholder for `'text'`/`'number'` controls. */
  readonly placeholder?: string;
  /**
   * Display order, ascending. Built-ins use 10, 20, 30…; contributed filters
   * default to 100 so they render after the built-ins.
   */
  readonly order?: number;
  /**
   * Entrypoint type(s) this filter is scoped to — a single type or a set. Set by
   * the core to the owning type when a filter is contributed through
   * {@link ProfilerEntrypointType.listFilters}: the filter is then shown and
   * applied only above that kind's list. The core also scopes its HTTP-response
   * filters (`status`, `statusClass`) to the response-producing kinds this way.
   * Absent for the universal filters that apply to every list.
   */
  readonly forType?: string | readonly string[];
  /**
   * Parses the raw query-string value into a typed value. Return `undefined` to
   * treat the filter as inactive (empty input, unchecked box, non-numeric text…)
   * so it never hides profiles.
   */
  parse(raw: string | undefined): T | undefined;
  /**
   * Translates the parsed `value` into a declarative {@link FilterCriterion} the
   * storage layer can evaluate or push down. Replaces the former JS `matches`
   * predicate so any adapter (database, Redis…) can apply the filter natively.
   */
  toCriterion(value: T): FilterCriterion;
}
