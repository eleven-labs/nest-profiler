import { Injectable } from '@nestjs/common';
import { ProfilerStorageService } from './profiler-storage.service';
import { CollectorRegistry } from '../collectors/collector-registry.service';
import { RouteCollector } from '../collectors/route.collector';
import type { IContextAdapter } from '../adapters/context-adapter.interface';
import type { Profile } from '../interfaces/profile.interface';
import type {
  ProfilerFilterOption,
  ProfilerListFilter,
} from '../list-filters/profiler-list-filter.interface';
import { BUILTIN_LIST_FILTERS } from '../list-filters/builtin-filters';

/** Default display order for contributed filters with no explicit `order`. */
const DEFAULT_FILTER_ORDER = 100;

/** Bundles the three core profiler services consumed by the controller and interceptor. */
@Injectable()
export class ProfilerCoreService {
  private readonly contextAdapters: IContextAdapter[] = [];
  private readonly listFilters: ProfilerListFilter[] = [...BUILTIN_LIST_FILTERS];
  /** Options contributed to an existing `'select'` filter, keyed by filter key. */
  private readonly filterOptions = new Map<string, ProfilerFilterOption[]>();

  constructor(
    readonly storage: ProfilerStorageService,
    readonly collectorRegistry: CollectorRegistry,
    readonly routeCollector: RouteCollector,
  ) {}

  /**
   * Registers a {@link IContextAdapter} so the profiler can handle a non-HTTP
   * protocol (GraphQL, gRPC, WebSockets…). Once registered, `ProfilerInterceptor`
   * delegates any execution context whose type matches the adapter's
   * {@link IContextAdapter.contextType} to it.
   *
   * Registration is idempotent per `contextType`: a second adapter declaring an
   * already-registered type is ignored, so calling this from a module's
   * `onModuleInit` is safe across re-initialization. Most consumers never call
   * it directly — the dedicated protocol packages (e.g.
   * `@eleven-labs/nest-profiler-graphql`) register their adapter for you.
   *
   * @param adapter - The context adapter to register.
   */
  registerContextAdapter(adapter: IContextAdapter): void {
    if (!this.contextAdapters.some((a) => a.contextType === adapter.contextType)) {
      this.contextAdapters.push(adapter);
    }
  }

  /**
   * Returns the adapter registered for the given context type, or `undefined`
   * when none handles it.
   *
   * @param contextType - The execution context type to look up (e.g. `graphql`).
   */
  findContextAdapter(contextType: string): IContextAdapter | undefined {
    return this.contextAdapters.find((a) => a.contextType === contextType);
  }

  /**
   * Invokes {@link IContextAdapter.enrichHttpResponse} on every registered
   * adapter that implements it, letting adapters surface protocol-specific data
   * carried in an HTTP response body (e.g. GraphQL errors returned with status
   * 200).
   *
   * @param profile - The active profile to enrich.
   * @param req - The underlying HTTP request object.
   * @param responseBody - The response body about to be sent.
   */
  enrichHttpResponse(profile: Profile, req: object, responseBody: unknown): void {
    for (const adapter of this.contextAdapters) {
      adapter.enrichHttpResponse?.(profile, req, responseBody);
    }
  }

  /**
   * Registers a {@link ProfilerListFilter} so it appears on the profiler list
   * page and is applied to the displayed profiles. The core seeds the built-in
   * filters (type, method, search, status, duration…); packages contribute
   * their own — e.g. `@eleven-labs/nest-profiler-graphql` adds a "GraphQL only"
   * checkbox.
   *
   * Registration is idempotent per {@link ProfilerListFilter.key}: a second
   * filter declaring an already-registered key is ignored, so calling this from
   * a module's `onModuleInit` is safe across re-initialization.
   *
   * @param filter - The list filter to register.
   */
  registerListFilter(filter: ProfilerListFilter): void {
    if (!this.listFilters.some((f) => f.key === filter.key)) {
      this.listFilters.push(filter);
    }
  }

  /**
   * Adds an option to an existing `'select'` list filter — e.g.
   * `@eleven-labs/nest-profiler-graphql` adds a `graphql` option to the built-in
   * `type` filter so GraphQL operations can be selected like HTTP or commands.
   *
   * Idempotent per (`filterKey`, `option.value`): registering the same option
   * twice is a no-op, so calling this from a module's `onModuleInit` is safe.
   *
   * @param filterKey - The {@link ProfilerListFilter.key} to extend.
   * @param option - The option to append.
   */
  registerFilterOption(filterKey: string, option: ProfilerFilterOption): void {
    const existing = this.filterOptions.get(filterKey) ?? [];
    if (!existing.some((o) => o.value === option.value)) {
      this.filterOptions.set(filterKey, [...existing, option]);
    }
  }

  /**
   * Returns all registered list filters sorted by ascending display order, with
   * any contributed options merged into their `'select'` controls.
   */
  getListFilters(): ProfilerListFilter[] {
    return [...this.listFilters]
      .sort((a, b) => (a.order ?? DEFAULT_FILTER_ORDER) - (b.order ?? DEFAULT_FILTER_ORDER))
      .map((filter) => {
        const extra = this.filterOptions.get(filter.key);
        if (!extra || !filter.options) return filter;
        return { ...filter, options: [...filter.options, ...extra] };
      });
  }
}
