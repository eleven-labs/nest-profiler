import { zodExtractor } from './zod.extractor';

describe('zodExtractor', () => {
  it('extracts issues via a nestjs-zod exception getZodError()', () => {
    const exception = {
      getZodError: () => ({
        issues: [{ code: 'too_small', path: ['title'], message: 'Too short' }],
      }),
    };
    expect(zodExtractor.extract({ error: exception })).toEqual([
      { property: 'title', constraints: { too_small: 'Too short' } },
    ]);
  });

  it('extracts issues from a bare ZodError-like object', () => {
    const zodError = {
      issues: [{ code: 'invalid_type', path: ['price'], message: 'Expected number' }],
    };
    expect(zodExtractor.extract({ error: zodError })).toEqual([
      { property: 'price', constraints: { invalid_type: 'Expected number' } },
    ]);
  });

  it('merges multiple issues on the same path into one entry', () => {
    const zodError = {
      issues: [
        { code: 'too_small', path: ['name'], message: 'Too short' },
        { code: 'invalid_string', path: ['name'], message: 'Bad format' },
      ],
    };
    expect(zodExtractor.extract({ error: zodError })).toEqual([
      { property: 'name', constraints: { too_small: 'Too short', invalid_string: 'Bad format' } },
    ]);
  });

  it('joins string, numeric and keyed path segments', () => {
    const zodError = {
      issues: [{ code: 'custom', path: ['tags', 1, { key: 'meta' }], message: 'Invalid' }],
    };
    expect(zodExtractor.extract({ error: zodError })?.[0]?.property).toBe('tags.1.meta');
  });

  it('labels a root-level issue (empty path) as (root)', () => {
    const zodError = { issues: [{ code: 'custom', path: [], message: 'Root invalid' }] };
    expect(zodExtractor.extract({ error: zodError })?.[0]?.property).toBe('(root)');
  });

  it('falls back to the v3 `errors` field when `issues` is absent', () => {
    const zodError = {
      errors: [{ code: 'too_small', path: ['age'], message: 'Min 18' }],
    };
    expect(zodExtractor.extract({ error: zodError })).toEqual([
      { property: 'age', constraints: { too_small: 'Min 18' } },
    ]);
  });

  it('defaults missing code/message to safe placeholders', () => {
    const zodError = { issues: [{ path: ['x'] }] };
    expect(zodExtractor.extract({ error: zodError })).toEqual([
      { property: 'x', constraints: { invalid: 'Invalid value' } },
    ]);
  });

  it('skips non-object issues', () => {
    const zodError = { issues: ['nope', null, { code: 'c', path: ['ok'], message: 'm' }] };
    expect(zodExtractor.extract({ error: zodError })).toEqual([
      { property: 'ok', constraints: { c: 'm' } },
    ]);
  });

  it('returns null for non-zod errors', () => {
    expect(zodExtractor.extract({ error: new Error('boom') })).toBeNull();
    expect(zodExtractor.extract({ error: { issues: 'not-an-array' } })).toBeNull();
    expect(zodExtractor.extract({ error: 'string' })).toBeNull();
    expect(zodExtractor.extract({ error: null })).toBeNull();
  });
});
