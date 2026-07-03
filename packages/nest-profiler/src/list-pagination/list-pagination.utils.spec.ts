import { buildPageHref, paginateProfiles } from './list-pagination.utils';
import type { Profile } from '../interfaces/profile.interface';

const profiles = (n: number): Profile[] =>
  Array.from({ length: n }, (_, i) => ({
    token: `tok-${i}`,
    createdAt: i,
    entrypoint: { type: 'http', data: {} },
    performance: { startTime: 0, heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  }));

describe('paginateProfiles', () => {
  it('returns the first page and its range', () => {
    const result = paginateProfiles(profiles(60), 1, 25);
    expect(result.pageProfiles).toHaveLength(25);
    expect(result.pageProfiles[0]?.token).toBe('tok-0');
    expect(result).toMatchObject({ page: 1, pageCount: 3, rangeStart: 1, rangeEnd: 25 });
  });

  it('slices a middle page', () => {
    const result = paginateProfiles(profiles(60), 2, 25);
    expect(result.pageProfiles[0]?.token).toBe('tok-25');
    expect(result).toMatchObject({ page: 2, rangeStart: 26, rangeEnd: 50 });
  });

  it('returns a short final page', () => {
    const result = paginateProfiles(profiles(60), 3, 25);
    expect(result.pageProfiles).toHaveLength(10);
    expect(result).toMatchObject({ page: 3, rangeStart: 51, rangeEnd: 60 });
  });

  it('clamps a page below 1 up to the first page', () => {
    const result = paginateProfiles(profiles(60), 0, 25);
    expect(result.page).toBe(1);
    expect(result.pageProfiles[0]?.token).toBe('tok-0');
  });

  it('clamps a page past the end down to the last page', () => {
    const result = paginateProfiles(profiles(60), 999, 25);
    expect(result).toMatchObject({ page: 3, pageCount: 3, rangeEnd: 60 });
  });

  it('yields a single empty page with a zero range for no profiles', () => {
    const result = paginateProfiles([], 1, 25);
    expect(result.pageProfiles).toEqual([]);
    expect(result).toMatchObject({ page: 1, pageCount: 1, rangeStart: 0, rangeEnd: 0 });
  });
});

describe('buildPageHref', () => {
  it('omits the page param on page 1 and preserves other params', () => {
    const href = buildPageHref('/_profiler', { http_status: '200', gql_page: '4' }, 'http', 1);
    // `http_page` is dropped for page 1; the foreign filter and the other
    // section's page both survive.
    expect(href).toBe('/_profiler?http_status=200&gql_page=4');
  });

  it('sets the page param for pages beyond the first', () => {
    const href = buildPageHref('/_profiler', { http_status: '200' }, 'http', 3);
    expect(href).toBe('/_profiler?http_status=200&http_page=3');
  });

  it('replaces an existing page param for the same section', () => {
    const href = buildPageHref('/_profiler', { http_page: '2', q: 'foo' }, 'http', 5);
    expect(href).toBe('/_profiler?q=foo&http_page=5');
  });

  it('returns the bare base path when no params remain', () => {
    expect(buildPageHref('/_profiler', {}, 'http', 1)).toBe('/_profiler');
  });

  it('takes the first value of an array-valued param', () => {
    const href = buildPageHref('/_profiler', { q: ['a', 'b'] }, 'http', 2);
    expect(href).toBe('/_profiler?q=a&http_page=2');
  });

  it('drops empty-string and empty-array params', () => {
    const href = buildPageHref('/_profiler', { a: '', b: [] }, 'http', 2);
    expect(href).toBe('/_profiler?http_page=2');
  });
});
