import { BUILTIN_LIST_FILTERS } from './builtin-filters';
import type { ProfilerListFilter } from './profiler-list-filter.interface';
import type {
  GraphQLInfo,
  ExceptionEntry,
  ProfileEntrypoint,
  Profile,
} from '../interfaces/profile.interface';

/** Shape of the generic `command` entrypoint a protocol package would register. */
interface CommandData {
  name: string;
  arguments: string[];
  exitCode: number;
  success: boolean;
}

function makeProfile(overrides: {
  method?: string;
  url?: string;
  statusCode?: number;
  duration?: number;
  graphql?: Partial<GraphQLInfo>;
  command?: Partial<CommandData>;
  exceptions?: ExceptionEntry[];
}): Profile {
  // Each kind is matched generically by its `entrypoint.type`: a command profile
  // is `command`, a GraphQL operation is `graphql` (its own kind, carried on HTTP),
  // and a plain REST request is `http`.
  let entrypoint: ProfileEntrypoint;
  if (overrides.command) {
    entrypoint = {
      type: 'command',
      data: {
        name: 'sync:posts',
        arguments: [],
        exitCode: 0,
        success: true,
        ...overrides.command,
      } satisfies CommandData,
    };
  } else if (overrides.graphql) {
    entrypoint = {
      type: 'graphql',
      data: {
        method: overrides.method ?? 'POST',
        url: overrides.url ?? '/graphql',
        headers: {},
        query: {},
        graphql: { operationType: 'query', fieldName: 'books', ...overrides.graphql },
      },
    };
  } else {
    entrypoint = {
      type: 'http',
      data: {
        method: overrides.method ?? 'GET',
        url: overrides.url ?? '/',
        headers: {},
        query: {},
      },
    };
  }

  return {
    token: Math.random().toString(36).slice(2),
    createdAt: Date.now(),
    entrypoint,
    response:
      overrides.statusCode !== undefined
        ? { statusCode: overrides.statusCode, headers: {} }
        : undefined,
    performance: { startTime: 0, heapUsed: 0, duration: overrides.duration },
    logs: [],
    exceptions: overrides.exceptions ?? [],
    collectors: {},
  };
}

function filter(key: string): ProfilerListFilter {
  const found = BUILTIN_LIST_FILTERS.find((f) => f.key === key);
  if (!found) throw new Error(`no built-in filter "${key}"`);
  return found;
}

/** Parses then matches in one step, mirroring how the controller applies a filter. */
function applies(key: string, raw: string | undefined, profile: Profile): boolean | 'inactive' {
  const def = filter(key);
  const value = def.parse(raw);
  if (value === undefined) return 'inactive';
  return def.matches(profile, value);
}

describe('built-in list filters', () => {
  it('are all registered with a unique key and ascending order', () => {
    const keys = BUILTIN_LIST_FILTERS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('contains only the universal filters (kind-specific ones live on their entrypoint type)', () => {
    const keys = BUILTIN_LIST_FILTERS.map((f) => f.key);
    expect(keys).not.toContain('type');
    expect(keys).not.toContain('method');
    expect(BUILTIN_LIST_FILTERS.every((f) => f.forType === undefined)).toBe(true);
  });

  describe('q (global search)', () => {
    it('matches the URL case-insensitively', () => {
      expect(applies('q', 'USERS', makeProfile({ url: '/api/users' }))).toBe(true);
    });

    it('matches a GraphQL operation or field name', () => {
      const gql = makeProfile({ graphql: { operationName: 'GetBooks', fieldName: 'books' } });
      expect(applies('q', 'getbooks', gql)).toBe(true);
      expect(applies('q', 'books', gql)).toBe(true);
    });

    it('matches a command name', () => {
      expect(applies('q', 'sync', makeProfile({ command: { name: 'sync:posts' } }))).toBe(true);
    });

    it('is inactive when empty', () => {
      expect(applies('q', '', makeProfile({}))).toBe('inactive');
    });
  });

  describe('status (exact)', () => {
    it('matches the exact status code', () => {
      expect(applies('status', '404', makeProfile({ statusCode: 404 }))).toBe(true);
      expect(applies('status', '404', makeProfile({ statusCode: 200 }))).toBe(false);
    });

    it('excludes profiles without a response', () => {
      expect(applies('status', '200', makeProfile({}))).toBe(false);
    });

    it('is inactive for non-numeric input', () => {
      expect(applies('status', 'abc', makeProfile({ statusCode: 200 }))).toBe('inactive');
    });
  });

  describe('statusClass', () => {
    it('matches the status class boundaries', () => {
      expect(applies('statusClass', '2', makeProfile({ statusCode: 201 }))).toBe(true);
      expect(applies('statusClass', '4', makeProfile({ statusCode: 404 }))).toBe(true);
      expect(applies('statusClass', '5', makeProfile({ statusCode: 503 }))).toBe(true);
      expect(applies('statusClass', '2', makeProfile({ statusCode: 404 }))).toBe(false);
    });

    it('excludes profiles without a response', () => {
      expect(applies('statusClass', '2', makeProfile({}))).toBe(false);
    });

    it('is inactive for empty or out-of-range values', () => {
      expect(applies('statusClass', '', makeProfile({ statusCode: 200 }))).toBe('inactive');
      expect(applies('statusClass', '9', makeProfile({ statusCode: 200 }))).toBe('inactive');
    });
  });

  describe('duration', () => {
    it('minDuration keeps profiles at or above the threshold', () => {
      expect(applies('minDuration', '50', makeProfile({ duration: 100 }))).toBe(true);
      expect(applies('minDuration', '50', makeProfile({ duration: 10 }))).toBe(false);
    });

    it('maxDuration keeps profiles at or below the threshold', () => {
      expect(applies('maxDuration', '50', makeProfile({ duration: 10 }))).toBe(true);
      expect(applies('maxDuration', '50', makeProfile({ duration: 100 }))).toBe(false);
    });

    it('treats an undefined duration as 0', () => {
      expect(applies('minDuration', '1', makeProfile({ duration: undefined }))).toBe(false);
      expect(applies('maxDuration', '0', makeProfile({ duration: undefined }))).toBe(true);
    });
  });

  describe('hasExceptions', () => {
    const withException = makeProfile({
      exceptions: [{ name: 'Error', message: 'boom', timestamp: 0 }],
    });

    it('matches only profiles that captured an exception when checked', () => {
      expect(applies('hasExceptions', '1', withException)).toBe(true);
      expect(applies('hasExceptions', '1', makeProfile({}))).toBe(false);
    });

    it('is inactive when unchecked (no value submitted)', () => {
      expect(applies('hasExceptions', undefined, withException)).toBe('inactive');
    });
  });
});
