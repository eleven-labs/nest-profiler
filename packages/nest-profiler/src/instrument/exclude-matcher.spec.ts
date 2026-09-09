import { compileExcludeMatcher } from './exclude-matcher';

describe('compileExcludeMatcher', () => {
  it('returns undefined when there is nothing to match, so the hot path can skip it', () => {
    expect(compileExcludeMatcher(undefined)).toBeUndefined();
    expect(compileExcludeMatcher([])).toBeUndefined();
    expect(compileExcludeMatcher(['', '   '])).toBeUndefined();
  });

  it('reads a dotless string as a class name and a dotted one as a method label', () => {
    const matcher = compileExcludeMatcher(['ConfigService', 'ClockService.now']);

    expect(matcher?.matchesClass('ConfigService')).toBe(true);
    expect(matcher?.matchesClass('ClockService')).toBe(false);
    expect(matcher?.matchesMethod('ClockService.now')).toBe(true);
    expect(matcher?.matchesMethod('ClockService.resolve')).toBe(false);
  });

  it('anchors a string, so a prefix or a suffix takes nothing with it', () => {
    const matcher = compileExcludeMatcher(['Product', 'Service.get']);

    expect(matcher?.matchesClass('ProductService')).toBe(false);
    expect(matcher?.matchesClass('Product')).toBe(true);
    expect(matcher?.matchesMethod('ProductService.get')).toBe(false);
  });

  it('expands * within a name, without crossing the dot', () => {
    const matcher = compileExcludeMatcher(['Cache*', '*.getRequestId', 'ConfigService.*']);

    expect(matcher?.matchesClass('CacheManager')).toBe(true);
    expect(matcher?.matchesClass('RedisCache')).toBe(false);
    expect(matcher?.matchesMethod('ProductService.getRequestId')).toBe(true);
    expect(matcher?.matchesMethod('ConfigService.getOrThrow')).toBe(true);
    // The wildcard stops at the dot: a class pattern cannot swallow a whole label.
    expect(matcher?.matchesClass('ConfigService.getOrThrow')).toBe(false);
  });

  it('treats a dot in a string as a literal separator, not as a metacharacter', () => {
    const matcher = compileExcludeMatcher(['AppService.tick']);

    expect(matcher?.matchesMethod('AppService.tick')).toBe(true);
    expect(matcher?.matchesMethod('AppServiceXtick')).toBe(false);
  });

  it('tries a RegExp at both levels', () => {
    const matcher = compileExcludeMatcher([/Repository$/, /^AppService\.tick$/]);

    expect(matcher?.matchesClass('ProductRepository')).toBe(true);
    expect(matcher?.matchesClass('AppService')).toBe(false);
    expect(matcher?.matchesMethod('AppService.tick')).toBe(true);
    expect(matcher?.matchesMethod('AppService.run')).toBe(false);
  });

  it('strips the stateful flags off a user RegExp', () => {
    // /g/ and /y/ make `test` advance lastIndex, so the same name would match on one call and miss
    // on the next.
    const matcher = compileExcludeMatcher([/get/g]);

    expect(matcher?.matchesMethod('ConfigService.get')).toBe(true);
    expect(matcher?.matchesMethod('ConfigService.get')).toBe(true);
    expect(matcher?.matchesMethod('ConfigService.getOrThrow')).toBe(true);
  });

  it('keeps a stateless RegExp as it was given, flags included', () => {
    const matcher = compileExcludeMatcher([/^configservice$/i]);

    expect(matcher?.matchesClass('ConfigService')).toBe(true);
  });
});
