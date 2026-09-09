import { HTTP_INSTRUMENTATIONS } from './http-collector.constants';

/**
 * See the core's `di-tokens.spec.ts`: a DI token created with a bare `Symbol()` is unique per
 * module instance, so two copies of this package in one dependency tree would register the
 * instrumentations under one token and inject them under another.
 */
describe('cross-instance DI tokens', () => {
  it('HTTP_INSTRUMENTATIONS is registered in the global symbol registry', () => {
    const key = Symbol.keyFor(HTTP_INSTRUMENTATIONS);
    expect(key).toBe('nest_profiler_http_instrumentations');
    expect(Symbol.for(key as string)).toBe(HTTP_INSTRUMENTATIONS);
  });
});
