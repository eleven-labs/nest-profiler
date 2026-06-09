import type { Profile } from '../interfaces/profile.interface';

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
 * core ships the built-in filters (method, search, status, duration…) and any
 * package can contribute its own — e.g. `@eleven-labs/nest-profiler-graphql`
 * adds a "GraphQL only" checkbox — without touching the core.
 *
 * Contribute one via the {@link PROFILER_LIST_FILTERS} multi-token or by
 * calling {@link ProfilerCoreService.registerListFilter} from a module's
 * `onModuleInit` (the cross-module path used by the protocol packages).
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
  /** Options for a `'select'` control. The first option is the "any" choice. */
  readonly options?: ProfilerFilterOption[];
  /** Placeholder for `'text'`/`'number'` controls. */
  readonly placeholder?: string;
  /**
   * Display order, ascending. Built-ins use 10, 20, 30…; contributed filters
   * default to 100 so they render after the built-ins.
   */
  readonly order?: number;
  /**
   * Parses the raw query-string value into a typed value. Return `undefined` to
   * treat the filter as inactive (empty input, unchecked box, non-numeric text…)
   * so it never hides profiles.
   */
  parse(raw: string | undefined): T | undefined;
  /** Whether `profile` passes this filter for the given (already-parsed) `value`. */
  matches(profile: Profile, value: T): boolean;
}
