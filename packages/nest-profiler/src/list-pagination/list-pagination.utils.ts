import type { Profile } from '../interfaces/profile.interface';

/** Per-section pagination state handed to the list template for rendering the pager. */
export interface ProfilerListPagination {
  /** Current page (1-based, clamped to `[1, pageCount]`). */
  readonly page: number;
  /** Total number of pages (at least 1, even when there are no profiles). */
  readonly pageCount: number;
  /** Profiles shown per page. */
  readonly pageSize: number;
  /** Number of profiles after filtering, across all pages. */
  readonly filteredTotal: number;
  /** 1-based index of the first row on this page (0 when the section is empty). */
  readonly rangeStart: number;
  /** 1-based index of the last row on this page (0 when the section is empty). */
  readonly rangeEnd: number;
  /** Href to the previous page, or `null` on the first page. */
  readonly prevHref: string | null;
  /** Href to the next page, or `null` on the last page. */
  readonly nextHref: string | null;
}

/** The current page of profiles plus the metadata needed to build a pager. */
export interface PaginatedProfiles {
  readonly pageProfiles: Profile[];
  readonly page: number;
  readonly pageCount: number;
  readonly rangeStart: number;
  readonly rangeEnd: number;
}

/**
 * Slices `profiles` to the requested page. `requestedPage` is clamped to
 * `[1, pageCount]`, so an out-of-range or absent page (`< 1`) lands on the first
 * page and a page past the end lands on the last. An empty list yields a single
 * page with `rangeStart`/`rangeEnd` of `0`.
 */
export function paginateProfiles(
  profiles: Profile[],
  requestedPage: number,
  pageSize: number,
): PaginatedProfiles {
  const pageCount = Math.max(1, Math.ceil(profiles.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const start = (page - 1) * pageSize;
  const pageProfiles = profiles.slice(start, start + pageSize);
  return {
    pageProfiles,
    page,
    pageCount,
    rangeStart: pageProfiles.length === 0 ? 0 : start + 1,
    rangeEnd: start + pageProfiles.length,
  };
}

/**
 * Builds an href to `page` of the section identified by `prefix`, preserving
 * every other query param — the active filters and the pages of other sections.
 * `page === 1` omits the `<prefix>_page` param entirely for a clean canonical URL.
 */
export function buildPageHref(
  basePath: string,
  query: Record<string, string | string[] | undefined>,
  prefix: string,
  page: number,
): string {
  const pageKey = `${prefix}_page`;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === pageKey) continue;
    const v = Array.isArray(value) ? value[0] : value;
    if (typeof v === 'string' && v.length > 0) params.set(key, v);
  }
  if (page > 1) params.set(pageKey, String(page));
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
