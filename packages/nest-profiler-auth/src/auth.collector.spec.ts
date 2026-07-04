import type { ModuleRef } from '@nestjs/core';
import type { ClsService } from 'nestjs-cls';
import { AuthCollectorModule } from './auth-collector.module';
import { AuthCollector } from './auth.collector';
import type { Profile } from '@eleven-labs/nest-profiler';

const mockGet = jest.fn();
const mockClsService = { get: mockGet } as Partial<ClsService> as ClsService;

/** A ModuleRef whose strict:false get() resolves the given ClsService (or undefined). */
function moduleRefFor(cls: ClsService | undefined): ModuleRef {
  return { get: jest.fn(() => cls) } as unknown as ModuleRef;
}

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    token: 'test',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'GET', url: '/', headers: {}, query: {} } },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
    ...overrides,
  };
}

describe('AuthCollector', () => {
  let collector: AuthCollector;

  beforeEach(() => {
    jest.clearAllMocks();
    collector = new AuthCollector(moduleRefFor(mockClsService), {});
    collector.onModuleInit();
  });

  it('returns anonymous context when no request user', () => {
    mockGet.mockReturnValue({ headers: {} });
    const profile = makeProfile();
    const result = collector.collect(profile);
    expect(result.isAuthenticated).toBe(false);
    expect(result.user).toBeUndefined();
  });

  it('captures user from request', () => {
    mockGet.mockReturnValue({
      user: { id: 1, username: 'alice' },
      headers: {},
    });
    const profile = makeProfile();
    const result = collector.collect(profile);
    expect(result.isAuthenticated).toBe(true);
    expect(result.user).toEqual({ id: 1, username: 'alice' });
  });

  it('masks secret fields in user', () => {
    mockGet.mockReturnValue({
      user: { id: 1, password: 'secret' },
      headers: {},
    });
    const profile = makeProfile();
    const result = collector.collect(profile);
    expect(result.user?.['password']).toBe('[REDACTED]');
    expect(result.user?.['id']).toBe(1);
  });

  /** Builds a syntactically valid JWT whose payload encodes `payloadObj`. */
  function makeJwt(payloadObj: unknown): string {
    const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
    return `header.${payload}.signature`;
  }

  it('decodes JWT claims from Authorization header', () => {
    mockGet.mockReturnValue({
      user: { id: 42 },
      headers: { authorization: `Bearer ${makeJwt({ sub: '42', email: 'alice@example.com' })}` },
    });
    const result = collector.collect(makeProfile());
    expect(result.jwtClaims).toMatchObject({ sub: '42', email: 'alice@example.com' });
  });

  it('decodes a JWT provided without the "Bearer " prefix', () => {
    mockGet.mockReturnValue({
      user: { id: 1 },
      headers: { authorization: makeJwt({ sub: 'raw' }) },
    });
    expect(collector.collect(makeProfile()).jwtClaims).toMatchObject({ sub: 'raw' });
  });

  it('reads the Authorization header when it is provided as an array', () => {
    mockGet.mockReturnValue({
      user: { id: 1 },
      headers: { authorization: [`Bearer ${makeJwt({ sub: 'arr' })}`] },
    });
    expect(collector.collect(makeProfile()).jwtClaims).toMatchObject({ sub: 'arr' });
  });

  it('ignores a token that does not have three parts', () => {
    mockGet.mockReturnValue({ user: { id: 1 }, headers: { authorization: 'Bearer not.ajwt' } });
    expect(collector.collect(makeProfile()).jwtClaims).toBeUndefined();
  });

  it('ignores a token whose payload is not valid JSON', () => {
    const bad = Buffer.from('not-json-{').toString('base64url');
    mockGet.mockReturnValue({ user: { id: 1 }, headers: { authorization: `header.${bad}.sig` } });
    expect(collector.collect(makeProfile()).jwtClaims).toBeUndefined();
  });

  it('ignores a token whose payload is valid JSON but not an object', () => {
    mockGet.mockReturnValue({ user: { id: 1 }, headers: { authorization: makeJwt([1, 2, 3]) } });
    expect(collector.collect(makeProfile()).jwtClaims).toBeUndefined();
  });

  it('has no jwtClaims when the request carries no Authorization header', () => {
    mockGet.mockReturnValue({ user: { id: 1 }, headers: {} });
    expect(collector.collect(makeProfile()).jwtClaims).toBeUndefined();
  });

  describe('roles extraction', () => {
    it('captures a roles array', () => {
      mockGet.mockReturnValue({ user: { id: 1, roles: ['admin', 'user'] }, headers: {} });
      expect(collector.collect(makeProfile()).roles).toEqual(['admin', 'user']);
    });

    it('wraps a single role string into an array', () => {
      mockGet.mockReturnValue({ user: { id: 1, role: 'admin' }, headers: {} });
      expect(collector.collect(makeProfile()).roles).toEqual(['admin']);
    });

    it('leaves roles undefined when none are present', () => {
      mockGet.mockReturnValue({ user: { id: 1 }, headers: {} });
      expect(collector.collect(makeProfile()).roles).toBeUndefined();
    });
  });

  it('masks fields configured via maskUserFields option', () => {
    const customCollector = new AuthCollector(moduleRefFor(mockClsService), {
      maskUserFields: ['ssn'],
    });
    customCollector.onModuleInit();
    mockGet.mockReturnValue({ user: { id: 1, ssn: '123-45-6789' }, headers: {} });
    const result = customCollector.collect(makeProfile());
    expect(result.user?.['ssn']).toBe('[REDACTED]');
    expect(result.user?.['id']).toBe(1);
  });

  it('treats the request as anonymous when CLS access throws (outside CLS)', () => {
    mockGet.mockImplementation(() => {
      throw new Error('outside CLS');
    });
    const result = collector.collect(makeProfile());
    expect(result.isAuthenticated).toBe(false);
    expect(result.user).toBeUndefined();
  });

  describe('getBadgeValue', () => {
    it('returns null when no security context is present', () => {
      expect(collector.getBadgeValue(makeProfile())).toBeNull();
    });

    it('returns the username when authenticated', () => {
      const profile = makeProfile({
        security: { isAuthenticated: true, user: { username: 'alice' } },
      });
      expect(collector.getBadgeValue(profile)).toBe('alice');
    });

    it('falls back to email, then sub, then id', () => {
      expect(
        collector.getBadgeValue(
          makeProfile({ security: { isAuthenticated: true, user: { email: 'a@b.c' } } }),
        ),
      ).toBe('a@b.c');
      expect(
        collector.getBadgeValue(
          makeProfile({ security: { isAuthenticated: true, user: { sub: 'sub-1' } } }),
        ),
      ).toBe('sub-1');
    });

    it('stringifies a numeric identifier', () => {
      const profile = makeProfile({ security: { isAuthenticated: true, user: { id: 42 } } });
      expect(collector.getBadgeValue(profile)).toBe('42');
    });

    it('returns "auth" when authenticated without a usable identifier', () => {
      expect(
        collector.getBadgeValue(
          makeProfile({ security: { isAuthenticated: true, user: { id: { nested: true } } } }),
        ),
      ).toBe('auth');
    });

    it('returns "auth" when authenticated with no user object', () => {
      expect(collector.getBadgeValue(makeProfile({ security: { isAuthenticated: true } }))).toBe(
        'auth',
      );
    });

    it('returns "anon" when not authenticated', () => {
      expect(collector.getBadgeValue(makeProfile({ security: { isAuthenticated: false } }))).toBe(
        'anon',
      );
    });
  });

  it('getTemplatePath returns an absolute path ending with auth-panel.ejs', () => {
    expect(collector.getTemplatePath()).toMatch(/auth-panel\.ejs$/);
  });

  it('maps object roles ({ name }) and string roles to display strings', () => {
    mockGet.mockReturnValue({
      user: { id: 1, roles: [{ name: 'admin' }, 'editor', { id: 7 }] },
      headers: {},
    });
    expect(collector.collect(makeProfile()).roles).toEqual(['admin', 'editor', '7']);
  });

  it('supports a single string role via the `role` field', () => {
    mockGet.mockReturnValue({ user: { id: 1, role: 'admin' }, headers: {} });
    expect(collector.collect(makeProfile()).roles).toEqual(['admin']);
  });

  it('decodes and redacts JWT claims from the Authorization header', () => {
    const payload = Buffer.from(JSON.stringify({ sub: '123', password: 'x' })).toString(
      'base64url',
    );
    mockGet.mockReturnValue({
      user: { id: 1 },
      headers: { authorization: `Bearer a.${payload}.c` },
    });
    const result = collector.collect(makeProfile());
    expect(result.jwtClaims?.['sub']).toBe('123');
    expect(result.jwtClaims?.['password']).toBe('[REDACTED]');
  });

  it('ignores a malformed JWT (returns no claims)', () => {
    mockGet.mockReturnValue({ user: { id: 1 }, headers: { authorization: 'Bearer not-a-jwt' } });
    expect(collector.collect(makeProfile()).jwtClaims).toBeUndefined();
  });

  it('no-ops (anonymous) when ClsService is unavailable (core disabled)', () => {
    const noCls = new AuthCollector(moduleRefFor(undefined), {});
    noCls.onModuleInit();
    const result = noCls.collect(makeProfile());
    expect(result.isAuthenticated).toBe(false);
  });
});

describe('AuthCollectorModule.forRoot', () => {
  it('returns a no-op module when enabled is false', () => {
    expect(AuthCollectorModule.forRoot({ enabled: false })).toEqual({
      module: AuthCollectorModule,
    });
  });

  it('registers providers by default', () => {
    expect(AuthCollectorModule.forRoot().providers?.length ?? 0).toBeGreaterThan(0);
  });
});
