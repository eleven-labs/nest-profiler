import * as path from 'path';
import { ValidatorCollector } from './validator.collector';
import { VALIDATOR_KEY } from './validator-collector.interface';
import type { Profile } from '@eleven-labs/nest-profiler';
import type { ValidationEntry } from './validator-collector.interface';

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    token: 'test',
    createdAt: Date.now(),
    request: { method: 'POST', url: '/products', headers: {}, query: {} },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
    ...overrides,
  };
}

function makeEntry(status: ValidationEntry['status'], violations = 0): ValidationEntry {
  return {
    source: 'body',
    dtoClass: 'CreateProductDto',
    status,
    violationCount: violations,
    violations:
      violations > 0
        ? [{ property: 'name', value: '', constraints: { isNotEmpty: 'name should not be empty' } }]
        : [],
    timestamp: Date.now(),
  };
}

describe('ValidatorCollector', () => {
  let collector: ValidatorCollector;

  beforeEach(() => {
    collector = new ValidatorCollector();
  });

  it('collects entries and removes the internal key', () => {
    const entry = makeEntry('valid');
    const profile = makeProfile({ collectors: { [VALIDATOR_KEY]: [entry] } });
    const result = collector.collect(profile);
    expect(result).toEqual([entry]);
    expect(profile.collectors[VALIDATOR_KEY]).toBeUndefined();
  });

  it('returns empty array when no entries', () => {
    expect(collector.collect(makeProfile())).toEqual([]);
  });

  it('getBadgeValue returns null when no entries', () => {
    expect(collector.getBadgeValue(makeProfile())).toBeNull();
  });

  it('getBadgeValue returns count when all valid', () => {
    const profile = makeProfile({
      collectors: { [VALIDATOR_KEY]: [makeEntry('valid'), makeEntry('valid')] },
    });
    expect(collector.getBadgeValue(profile)).toBe(2);
  });

  it('getBadgeValue shows violation count when invalid', () => {
    const profile = makeProfile({
      collectors: { [VALIDATOR_KEY]: [makeEntry('valid'), makeEntry('invalid', 3)] },
    });
    expect(collector.getBadgeValue(profile)).toBe(2);
  });

  it('getBadgeValue shows singular for one violation', () => {
    const profile = makeProfile({ collectors: { [VALIDATOR_KEY]: [makeEntry('invalid', 1)] } });
    expect(collector.getBadgeValue(profile)).toBe(1);
  });

  it('getBadgeValue reads from profile.collectors[name] after collect() has run', () => {
    const entry = makeEntry('valid');
    const profile = makeProfile({ collectors: { [VALIDATOR_KEY]: [entry, entry] } });
    const collected = collector.collect(profile);
    profile.collectors[collector.name] = collected;
    expect(profile.collectors[VALIDATOR_KEY]).toBeUndefined();
    expect(collector.getBadgeValue(profile)).toBe(2);
  });

  it('getTemplatePath returns absolute path to validator-panel.ejs', () => {
    const p = collector.getTemplatePath();
    expect(p).toMatch(/validator-panel\.ejs$/);
    expect(path.isAbsolute(p)).toBe(true);
  });
});
