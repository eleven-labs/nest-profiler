import { ProfilerFiltersPipe } from './profiler-filters.pipe';

describe('ProfilerFiltersPipe', () => {
  const pipe = new ProfilerFiltersPipe();

  it('parses numeric filters and passes through string filters', () => {
    expect(
      pipe.transform({
        method: 'GET',
        statusCode: '200',
        minDuration: '5',
        maxDuration: '1000',
        url: '/users',
      }),
    ).toEqual({
      method: 'GET',
      statusCode: 200,
      minDuration: 5,
      maxDuration: 1000,
      url: '/users',
    });
  });

  it('drops non-numeric numeric filters instead of producing NaN', () => {
    expect(
      pipe.transform({ statusCode: 'not-a-number', minDuration: 'abc', maxDuration: '' }),
    ).toEqual({
      method: undefined,
      statusCode: undefined,
      minDuration: undefined,
      maxDuration: undefined,
      url: undefined,
    });
  });

  it('drops empty string filters', () => {
    expect(pipe.transform({ method: '', url: '' })).toMatchObject({
      method: undefined,
      url: undefined,
    });
  });

  it('parses zero as a valid numeric filter', () => {
    expect(pipe.transform({ minDuration: '0' }).minDuration).toBe(0);
  });

  it('ignores non-string values (e.g. repeated query params parsed as arrays)', () => {
    expect(pipe.transform({ statusCode: ['200', '404'], method: ['GET'] })).toMatchObject({
      statusCode: undefined,
      method: undefined,
    });
  });

  it('returns an all-undefined filter set for empty or nullish input', () => {
    const empty = {
      method: undefined,
      statusCode: undefined,
      minDuration: undefined,
      maxDuration: undefined,
      url: undefined,
    };
    expect(pipe.transform({})).toEqual(empty);
    expect(pipe.transform(undefined)).toEqual(empty);
    expect(pipe.transform(null)).toEqual(empty);
  });
});
