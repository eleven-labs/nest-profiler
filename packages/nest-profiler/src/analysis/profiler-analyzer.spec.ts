import { analyzeProfile } from './profiler-analyzer';
import { BUILTIN_PERFORMANCE_RULES } from './builtin-rules';
import type { PerformanceRule } from './performance-rule.interface';
import type { TagConfig, TaggableCollector, TaggableEntry } from './taggable-collector.interface';
import type { IProfilerCollector } from '../collectors/collector.interface';
import type { Profile } from '../interfaces/profile.interface';

const CONFIG: TagConfig = {
  slowThreshold: 100,
  nPlusOneThreshold: 2,
  chattyThreshold: 5,
  largePayloadThreshold: 1000,
};

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    token: 'tok',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'GET', url: '/', headers: {}, query: {} } },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
    ...overrides,
  };
}

/** Registers a taggable collector on the profile and returns it for analysis. */
function makeCollector(
  name: string,
  domain: string,
  profile: Profile,
  entries: TaggableEntry[],
  config: TagConfig = CONFIG,
): IProfilerCollector & TaggableCollector {
  profile.collectors[name] = entries;
  return {
    name,
    tagDomain: domain,
    collect: () => entries,
    getTaggableEntries: () => profile.collectors[name] as TaggableEntry[],
    getTagConfig: () => config,
  };
}

const ids = (tags: TaggableEntry['tags']): string[] => (tags ?? []).map((t) => t.id);

describe('analyzeProfile', () => {
  it('tags slow entries and aggregates the tag onto the profile', () => {
    const profile = makeProfile();
    const entries: TaggableEntry[] = [{ duration: 250 }, { duration: 10 }];
    const collector = makeCollector('typeorm', 'query', profile, entries);

    analyzeProfile(profile, [collector], BUILTIN_PERFORMANCE_RULES);

    expect(ids(entries[0]?.tags)).toContain('slow');
    expect(ids(entries[1]?.tags)).not.toContain('slow');
    expect(profile.tags?.map((t) => t.id)).toContain('slow');
  });

  it('tags repeated query groups as N+1 with a count', () => {
    const profile = makeProfile();
    const entries: TaggableEntry[] = [
      { duration: 5, fingerprint: 'q1' },
      { duration: 6, fingerprint: 'q1' },
      { duration: 7, fingerprint: 'q1' },
      { duration: 8, fingerprint: 'q2' },
    ];
    const collector = makeCollector('typeorm', 'query', profile, entries);

    analyzeProfile(profile, [collector], BUILTIN_PERFORMANCE_RULES);

    const dup = entries[0]?.tags?.find((t) => t.id === 'n-plus-one');
    expect(dup).toMatchObject({ id: 'n-plus-one', count: 3, label: 'N+1 ×3' });
    expect(ids(entries[3]?.tags)).not.toContain('n-plus-one');
  });

  it('labels repeated HTTP calls as N+1, like queries', () => {
    const profile = makeProfile();
    const entries: TaggableEntry[] = [
      { duration: 5, fingerprint: 'GET /a' },
      { duration: 6, fingerprint: 'GET /a' },
    ];
    const collector = makeCollector('http-client', 'http', profile, entries);

    analyzeProfile(profile, [collector], BUILTIN_PERFORMANCE_RULES);

    const tag = entries[0]?.tags?.find((t) => t.id === 'n-plus-one');
    expect(tag?.label).toBe('N+1 ×2');
    expect(tag?.detail).toBe('Same request executed 2 times');
  });

  it('respects a higher nPlusOneThreshold', () => {
    const profile = makeProfile();
    const entries: TaggableEntry[] = [
      { duration: 5, fingerprint: 'q1' },
      { duration: 6, fingerprint: 'q1' },
    ];
    const collector = makeCollector('typeorm', 'query', profile, entries, {
      ...CONFIG,
      nPlusOneThreshold: 3,
    });

    analyzeProfile(profile, [collector], BUILTIN_PERFORMANCE_RULES);
    expect(ids(entries[0]?.tags)).not.toContain('n-plus-one');
  });

  it('tags failed entries and profiles with exceptions as error', () => {
    const profile = makeProfile({ exceptions: [{ message: 'boom' } as never] });
    const http: TaggableEntry[] = [{ duration: 5, error: 'ECONNRESET' }, { duration: 5 }];
    (http[1] as { statusCode?: number }).statusCode = 500;
    const collector = makeCollector('http-client', 'http', profile, http);

    analyzeProfile(profile, [collector], BUILTIN_PERFORMANCE_RULES);

    expect(ids(http[0]?.tags)).toContain('error');
    expect(ids(http[1]?.tags)).toContain('error');
    expect(profile.tags?.find((t) => t.id === 'error')?.count).toBe(1);
  });

  it('tags a chatty profile when the call count reaches the threshold', () => {
    const profile = makeProfile();
    const entries: TaggableEntry[] = Array.from({ length: 5 }, () => ({ duration: 1 }));
    const collector = makeCollector('typeorm', 'query', profile, entries);

    analyzeProfile(profile, [collector], BUILTIN_PERFORMANCE_RULES);
    expect(profile.tags?.find((t) => t.id === 'chatty')?.count).toBe(5);
  });

  it('tags large HTTP payloads from the content-length header', () => {
    const profile = makeProfile();
    const entry: TaggableEntry = { duration: 5 };
    (entry as { responseHeaders?: Record<string, string> }).responseHeaders = {
      'Content-Length': '2048',
    };
    const collector = makeCollector('http-client', 'http', profile, [entry]);

    analyzeProfile(profile, [collector], BUILTIN_PERFORMANCE_RULES);
    expect(ids(entry.tags)).toContain('large-payload');
  });

  it('measures large payloads from the serialized body and formats MB in the detail', () => {
    const profile = makeProfile();
    const entry: TaggableEntry = { duration: 5 };
    (entry as { responseBody?: unknown }).responseBody = { blob: 'x'.repeat(2_000_000) };
    const collector = makeCollector('http-client', 'http', profile, [entry]);

    analyzeProfile(profile, [collector], BUILTIN_PERFORMANCE_RULES);
    const tag = entry.tags?.find((t) => t.id === 'large-payload');
    expect(tag?.detail).toMatch(/MB payload/);
  });

  it('does not tag large payload when the threshold is unset', () => {
    const profile = makeProfile();
    const entry: TaggableEntry = { duration: 5 };
    (entry as { responseHeaders?: Record<string, string> }).responseHeaders = {
      'content-length': '999999',
    };
    const collector = makeCollector('http-client', 'http', profile, [entry], {
      slowThreshold: 100,
      nPlusOneThreshold: 2,
    });

    analyzeProfile(profile, [collector], BUILTIN_PERFORMANCE_RULES);
    expect(ids(entry.tags)).not.toContain('large-payload');
  });

  it('flags a zero-row UPDATE/DELETE and aggregates zero-rows onto the profile', () => {
    const profile = makeProfile();
    const entries: TaggableEntry[] = [
      { duration: 5 },
      { duration: 6 },
      { duration: 7 },
      { duration: 8 },
    ];
    Object.assign(entries[0]!, { type: 'UPDATE', rowCount: 0 });
    Object.assign(entries[1]!, { type: 'DELETE', rowCount: 5 }); // affected rows → fine
    Object.assign(entries[2]!, { type: 'SELECT', rowCount: 0 }); // empty read → legitimate
    Object.assign(entries[3]!, { type: 'DELETE' }); // rowCount unknown → no false positive
    const collector = makeCollector('typeorm', 'query', profile, entries);

    analyzeProfile(profile, [collector], BUILTIN_PERFORMANCE_RULES);

    expect(ids(entries[0]?.tags)).toContain('zero-rows');
    expect(ids(entries[1]?.tags)).not.toContain('zero-rows');
    expect(ids(entries[2]?.tags)).not.toContain('zero-rows');
    expect(ids(entries[3]?.tags)).not.toContain('zero-rows');
    expect(profile.tags?.map((t) => t.id)).toContain('zero-rows');
  });

  it('flags a zero-count Mongoose delete/update (silent-failure parity)', () => {
    const profile = makeProfile();
    const entries: TaggableEntry[] = [{ duration: 3 }, { duration: 4 }, { duration: 5 }];
    Object.assign(entries[0]!, { operation: 'deleteMany', count: 0 });
    Object.assign(entries[1]!, { operation: 'updateOne', count: 1 }); // matched → fine
    Object.assign(entries[2]!, { operation: 'find', count: 0 }); // empty read → legitimate
    const collector = makeCollector('mongoose', 'query', profile, entries);

    analyzeProfile(profile, [collector], BUILTIN_PERFORMANCE_RULES);

    expect(ids(entries[0]?.tags)).toContain('zero-rows');
    expect(ids(entries[1]?.tags)).not.toContain('zero-rows');
    expect(ids(entries[2]?.tags)).not.toContain('zero-rows');
  });

  it('does not flag zero-row writes outside the query domain', () => {
    const profile = makeProfile();
    const entry: TaggableEntry = { duration: 5 };
    Object.assign(entry, { type: 'UPDATE', rowCount: 0 });
    const collector = makeCollector('http-client', 'http', profile, [entry]);

    analyzeProfile(profile, [collector], BUILTIN_PERFORMANCE_RULES);
    expect(ids(entry.tags)).not.toContain('zero-rows');
  });

  it('ignores non-taggable collectors', () => {
    const profile = makeProfile();
    const plain: IProfilerCollector = { name: 'logs', collect: () => [] };

    analyzeProfile(profile, [plain], BUILTIN_PERFORMANCE_RULES);
    expect(profile.tags).toEqual([]);
  });

  describe('configurable severity', () => {
    const sevOf = (tags: TaggableEntry['tags'], id: string): string | undefined =>
      (tags ?? []).find((t) => t.id === id)?.severity;

    it('emits each built-in tag with its default severity', () => {
      const profile = makeProfile();
      const entries: TaggableEntry[] = [
        { duration: 250, fingerprint: 'q1' },
        { duration: 250, fingerprint: 'q1' },
        { duration: 250, fingerprint: 'q1' },
        { duration: 250, fingerprint: 'q1' },
        { duration: 250, fingerprint: 'q1' },
      ];
      Object.assign(entries[0]!, { type: 'DELETE', rowCount: 0 });
      const collector = makeCollector('typeorm', 'query', profile, entries);

      analyzeProfile(profile, [collector], BUILTIN_PERFORMANCE_RULES);

      expect(sevOf(entries[0]?.tags, 'slow')).toBe('warning');
      expect(sevOf(entries[0]?.tags, 'n-plus-one')).toBe('danger');
      expect(sevOf(entries[0]?.tags, 'zero-rows')).toBe('warning');
      expect(sevOf(profile.tags, 'n-plus-one')).toBe('danger');
      expect(sevOf(profile.tags, 'chatty')).toBe('warning');
      expect(sevOf(profile.tags, 'zero-rows')).toBe('warning');
    });

    it('applies the default large-payload severity (warning)', () => {
      const profile = makeProfile();
      const entry: TaggableEntry = { duration: 5 };
      (entry as { responseHeaders?: Record<string, string> }).responseHeaders = {
        'content-length': '2048',
      };
      const collector = makeCollector('http-client', 'http', profile, [entry]);

      analyzeProfile(profile, [collector], BUILTIN_PERFORMANCE_RULES);
      expect(sevOf(entry.tags, 'large-payload')).toBe('warning');
    });

    it('overrides slow / chatty / zero-rows severity from the collector config', () => {
      const profile = makeProfile();
      const entries: TaggableEntry[] = Array.from({ length: 5 }, () => ({ duration: 250 }));
      Object.assign(entries[0]!, { type: 'UPDATE', rowCount: 0 });
      const collector = makeCollector('typeorm', 'query', profile, entries, {
        ...CONFIG,
        slowSeverity: 'danger',
        chattySeverity: 'danger',
        zeroRowsSeverity: 'info',
      });

      analyzeProfile(profile, [collector], BUILTIN_PERFORMANCE_RULES);

      expect(sevOf(entries[0]?.tags, 'slow')).toBe('danger');
      expect(sevOf(entries[0]?.tags, 'zero-rows')).toBe('info');
      expect(sevOf(profile.tags, 'chatty')).toBe('danger');
      expect(sevOf(profile.tags, 'zero-rows')).toBe('info');
    });

    it('overrides n-plus-one severity on both the entry and the profile tag', () => {
      const profile = makeProfile();
      const entries: TaggableEntry[] = [
        { duration: 5, fingerprint: 'q1' },
        { duration: 6, fingerprint: 'q1' },
      ];
      const collector = makeCollector('typeorm', 'query', profile, entries, {
        ...CONFIG,
        nPlusOneSeverity: 'info',
      });

      analyzeProfile(profile, [collector], BUILTIN_PERFORMANCE_RULES);

      expect(sevOf(entries[0]?.tags, 'n-plus-one')).toBe('info');
      expect(sevOf(profile.tags, 'n-plus-one')).toBe('info');
    });

    it('overrides large-payload severity from the collector config', () => {
      const profile = makeProfile();
      const entry: TaggableEntry = { duration: 5 };
      (entry as { responseHeaders?: Record<string, string> }).responseHeaders = {
        'content-length': '2048',
      };
      const collector = makeCollector('http-client', 'http', profile, [entry], {
        ...CONFIG,
        largePayloadSeverity: 'danger',
      });

      analyzeProfile(profile, [collector], BUILTIN_PERFORMANCE_RULES);
      expect(sevOf(entry.tags, 'large-payload')).toBe('danger');
    });
  });

  it('isolates a throwing rule and still applies the others', () => {
    const profile = makeProfile();
    const entries: TaggableEntry[] = [{ duration: 250 }];
    const collector = makeCollector('typeorm', 'query', profile, entries);
    const boom: PerformanceRule = {
      id: 'boom',
      evaluate: () => {
        throw new Error('nope');
      },
    };

    expect(() =>
      analyzeProfile(profile, [collector], [boom, ...BUILTIN_PERFORMANCE_RULES]),
    ).not.toThrow();
    expect(ids(entries[0]?.tags)).toContain('slow');
  });
});
