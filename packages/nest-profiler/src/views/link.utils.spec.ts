import { appendLinkQuery, linkQueryPairs } from './link.utils';

describe('appendLinkQuery', () => {
  it('returns the href unchanged for an empty query', () => {
    expect(appendLinkQuery('/_profiler', '')).toBe('/_profiler');
  });

  it('joins with `?` when the href has no query', () => {
    expect(appendLinkQuery('/_profiler/tok/data', '?token=abc')).toBe(
      '/_profiler/tok/data?token=abc',
    );
  });

  it('joins with `&` when the href already has a query', () => {
    expect(appendLinkQuery('/_profiler/tok?tab=logs', 'token=abc')).toBe(
      '/_profiler/tok?tab=logs&token=abc',
    );
  });

  it('tolerates a leading `?` or `&` on the query', () => {
    expect(appendLinkQuery('/x', '&token=abc')).toBe('/x?token=abc');
  });
});

describe('linkQueryPairs', () => {
  it('returns an empty array for an empty query', () => {
    expect(linkQueryPairs('')).toEqual([]);
  });

  it('splits a query string into name/value pairs', () => {
    expect(linkQueryPairs('?token=abc&scope=read')).toEqual([
      { name: 'token', value: 'abc' },
      { name: 'scope', value: 'read' },
    ]);
  });
});
