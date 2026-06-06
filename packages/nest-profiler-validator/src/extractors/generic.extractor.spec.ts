import { genericExtractor } from './generic.extractor';

describe('genericExtractor', () => {
  it('maps an array of messages to one violation each', () => {
    const exception = { getResponse: () => ({ message: ['name is required', 'price too low'] }) };
    expect(genericExtractor.extract({ error: exception })).toEqual([
      { property: '(unknown)', constraints: { error: 'name is required' } },
      { property: '(unknown)', constraints: { error: 'price too low' } },
    ]);
  });

  it('maps a single string message to one violation', () => {
    const exception = { getResponse: () => ({ message: 'Validation failed' }) };
    expect(genericExtractor.extract({ error: exception })).toEqual([
      { property: '(unknown)', constraints: { error: 'Validation failed' } },
    ]);
  });

  it('handles a string response payload', () => {
    const exception = { getResponse: () => 'Bad Request' };
    expect(genericExtractor.extract({ error: exception })).toEqual([
      { property: '(unknown)', constraints: { error: 'Bad Request' } },
    ]);
  });

  it('filters out non-string entries in the message array', () => {
    const exception = { getResponse: () => ({ message: ['ok', 42, null] }) };
    expect(genericExtractor.extract({ error: exception })).toEqual([
      { property: '(unknown)', constraints: { error: 'ok' } },
    ]);
  });

  it('returns null when the message array has no strings', () => {
    const exception = { getResponse: () => ({ message: [1, 2] }) };
    expect(genericExtractor.extract({ error: exception })).toBeNull();
  });

  it('returns null when the response carries no message', () => {
    const exception = { getResponse: () => ({ statusCode: 400 }) };
    expect(genericExtractor.extract({ error: exception })).toBeNull();
  });

  it('returns null when the error exposes no getResponse', () => {
    expect(genericExtractor.extract({ error: new Error('boom') })).toBeNull();
    expect(genericExtractor.extract({ error: 'string' })).toBeNull();
    expect(genericExtractor.extract({ error: null })).toBeNull();
  });
});
