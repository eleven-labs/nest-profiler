/**
 * DI multi-token under which {@link ProfilerListSection} implementations are
 * provided. Register a section with `{ provide: PROFILER_LIST_SECTIONS,
 * useValue: mySection, multi: true }` (or call
 * {@link ProfilerCoreService.registerListSection}) and the profiler list page
 * renders it as its own table.
 */
export const PROFILER_LIST_SECTIONS = 'PROFILER_LIST_SECTIONS';

/**
 * Contract for a section on the profiler list page (`/_profiler`).
 *
 * The list page groups the captured profiles into independent tables — one per
 * section — so different kinds of profiles can show their own columns. The core
 * ships the built-in "HTTP" catch-all section, and any package can contribute its
 * own — e.g. `@eleven-labs/nest-profiler-graphql` adds a "GraphQL" table and
 * `@eleven-labs/nest-profiler-commander` a "Commands" table — without touching
 * the core.
 *
 * Each profile is assigned to exactly one section by its entrypoint type: to the
 * non-default section (by ascending {@link order}) that owns its type (see
 * {@link types}), otherwise to the single {@link isDefault} catch-all section.
 * Empty non-default sections are hidden; the default section is always shown.
 *
 * A section renders its rows through its own EJS partial ({@link templatePath}),
 * which receives `{ profiles, profilerPath }` plus the shared template helpers
 * (`methodClass`, `statusClass`, `gqlTypeClass`, `isoDate`, `toJson`, …).
 *
 * Contribute one via the {@link PROFILER_LIST_SECTIONS} multi-token or by
 * calling {@link ProfilerCoreService.registerListSection} from a module's
 * `onModuleInit` (the cross-module path used by the protocol packages).
 */
export interface ProfilerListSection {
  /** Unique key used to bucket profiles and de-duplicate registrations. */
  readonly key: string;
  /** Heading shown above the section's table. */
  readonly title: string;
  /** Sub-heading shown under the title. */
  readonly description?: string;
  /**
   * Display order, ascending. Built-ins use 10 (requests) and 20 (commands);
   * contributed sections default to 100 so they render after the built-ins.
   */
  readonly order?: number;
  /**
   * The catch-all section: it receives every profile whose entrypoint type is not
   * claimed by a non-default section, and is always rendered (even when empty).
   * Exactly one registered section should set this — the core's "HTTP" section.
   */
  readonly isDefault?: boolean;
  /**
   * Entrypoint type(s) this section owns. Defaults to `[key]` — the common case,
   * since an entrypoint-derived section's `key` is its type. Ignored for the
   * {@link isDefault} section, which claims every otherwise-unclaimed type.
   */
  readonly types?: readonly string[];
  /**
   * Singular noun for the count badge (e.g. `'profile'`, `'command'`,
   * `'message'`). Defaults to `'profile'`.
   */
  readonly itemLabel?: string;
  /**
   * Start the section folded. Every section renders inside a `<details>`/`<summary>`
   * disclosure — the summary keeps the title and count badge visible while the
   * table and filter bar fold away — and is expanded (`open`) by default; set this
   * to `true` to render it collapsed instead.
   */
  readonly defaultCollapsed?: boolean;
  /** Absolute path to the EJS partial that renders this section's table. */
  readonly templatePath: string;
}
