import {
  buildMaskedQueryParams,
  DEFAULT_MASK_QUERY_PARAMS,
  redactQueryRecord,
  redactQueryString,
} from './redact-query.util';

const defaults = buildMaskedQueryParams(DEFAULT_MASK_QUERY_PARAMS);

describe('redactQueryString', () => {
  it('returns a url without a query string untouched', () => {
    expect(redactQueryString('/users', defaults)).toBe('/users');
  });

  it('returns a url with nothing sensitive untouched, without re-serialising it', () => {
    expect(redactQueryString('/users?sort=name&page=2', defaults)).toBe('/users?sort=name&page=2');
  });

  it('masks the value and keeps the parameter name', () => {
    expect(redactQueryString('/reset?token=abc', defaults)).toBe('/reset?token=%5BREDACTED%5D');
  });

  it('keeps the non-sensitive parameters alongside a masked one', () => {
    const redacted = redactQueryString('/cb?code=4%2F0AY&next=%2Fhome', defaults);
    expect(redacted).toContain('code=%5BREDACTED%5D');
    expect(redacted).toContain('next=%2Fhome');
    expect(redacted).not.toContain('4%2F0AY');
  });

  it('matches names case-insensitively and ignoring - and _', () => {
    for (const name of ['access_token', 'accessToken', 'Access-Token', 'ACCESS_TOKEN']) {
      expect(redactQueryString(`/p?${name}=v`, defaults)).toBe(`/p?${name}=%5BREDACTED%5D`);
    }
  });

  it('collapses every value of a repeated sensitive parameter', () => {
    expect(redactQueryString('/p?token=a&token=b', defaults)).toBe('/p?token=%5BREDACTED%5D');
  });

  it('masks a value that itself contains an escaped separator', () => {
    const redacted = redactQueryString('/p?signature=a%26b%3Dc&page=1', defaults);
    expect(redacted).toBe('/p?signature=%5BREDACTED%5D&page=1');
  });

  it('masks an empty sensitive value rather than reporting its absence', () => {
    expect(redactQueryString('/p?token=', defaults)).toBe('/p?token=%5BREDACTED%5D');
  });

  it('preserves a fragment and keeps it out of the query parse', () => {
    expect(redactQueryString('/p?token=abc#section', defaults)).toBe(
      '/p?token=%5BREDACTED%5D#section',
    );
  });

  it('masks the extra names an application supplies', () => {
    const masked = buildMaskedQueryParams([...DEFAULT_MASK_QUERY_PARAMS, 'inviteRef']);
    expect(redactQueryString('/join?inviteRef=r-1', masked)).toBe('/join?inviteRef=%5BREDACTED%5D');
  });

  it('masks nothing when the set is empty', () => {
    expect(redactQueryString('/p?token=abc', buildMaskedQueryParams([]))).toBe('/p?token=abc');
  });

  it('covers the parameters credentials actually travel in', () => {
    for (const name of ['token', 'code', 'state', 'signature', 'sig', 'password', 'api_key']) {
      expect(redactQueryString(`/p?${name}=v`, defaults)).not.toContain('=v');
    }
  });
});

describe('redactQueryRecord', () => {
  it('returns the same object when nothing is sensitive', () => {
    const query = { sort: 'name', page: '2' };
    expect(redactQueryRecord(query, defaults)).toBe(query);
  });

  it('masks a sensitive value and leaves the others in place', () => {
    expect(redactQueryRecord({ token: 'abc', page: '2' }, defaults)).toEqual({
      token: '[REDACTED]',
      page: '2',
    });
  });

  it('masks every value of a repeated sensitive parameter', () => {
    expect(redactQueryRecord({ token: ['a', 'b'] }, defaults)).toEqual({
      token: ['[REDACTED]', '[REDACTED]'],
    });
  });

  it('masks a nested value outright rather than walking into it', () => {
    // A rich query parser can produce `?credentials[user]=x` as an object; masking the whole
    // entry is what must happen — walking in would preserve half of it.
    expect(redactQueryRecord({ credentials: { user: 'x' } }, defaults)).toEqual({
      credentials: '[REDACTED]',
    });
  });

  it('does not mutate the input', () => {
    const query = { token: 'abc' };
    redactQueryRecord(query, defaults);
    expect(query.token).toBe('abc');
  });

  it('masks nothing when the set is empty', () => {
    const query = { token: 'abc' };
    expect(redactQueryRecord(query, buildMaskedQueryParams([]))).toBe(query);
  });
});
