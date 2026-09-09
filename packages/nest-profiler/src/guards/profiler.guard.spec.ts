import { CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import { ProfilerGuard } from './profiler.guard';
import type { ProfilerAuthContext, ProfilerSecurityOptions } from '../nest-profiler.builder';

interface CtxParts {
  ctx: ExecutionContext;
  response: { headers: Record<string, string>; setHeader: (k: string, v: string) => void };
}

function makeCtx(
  opts: {
    url?: string;
    headers?: Record<string, string>;
    query?: Record<string, string | string[]>;
  } = {},
): CtxParts {
  const headers: Record<string, string> = {};
  const response = {
    headers,
    setHeader(k: string, v: string): void {
      headers[k.toLowerCase()] = v;
    },
  };
  const request = { headers: opts.headers ?? {}, url: opts.url, query: opts.query };
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return { ctx, response };
}

function moduleRefMock(overrides: Partial<ModuleRef> = {}): ModuleRef {
  return { get: jest.fn(), create: jest.fn(), ...overrides } as unknown as ModuleRef;
}

function guardWith(security?: ProfilerSecurityOptions, moduleRef: ModuleRef = moduleRefMock()) {
  return new ProfilerGuard(moduleRef, security === undefined ? {} : { security });
}

describe('ProfilerGuard', () => {
  describe('default (no security configured)', () => {
    it('allows access when no options are provided', async () => {
      await expect(new ProfilerGuard(moduleRefMock()).canActivate(makeCtx().ctx)).resolves.toBe(
        true,
      );
    });

    it('allows access when security is omitted', async () => {
      await expect(guardWith(undefined).canActivate(makeCtx().ctx)).resolves.toBe(true);
    });
  });

  describe('authorize predicate', () => {
    it('allows access when authorize returns true', async () => {
      await expect(guardWith({ authorize: () => true }).canActivate(makeCtx().ctx)).resolves.toBe(
        true,
      );
    });

    it('throws Unauthorized when authorize returns false', async () => {
      await expect(
        guardWith({ authorize: () => false }).canActivate(makeCtx().ctx),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('awaits an async authorize (allow)', async () => {
      const guard = guardWith({ authorize: async () => Promise.resolve(true) });
      await expect(guard.canActivate(makeCtx().ctx)).resolves.toBe(true);
    });

    it('awaits an async authorize (deny)', async () => {
      const guard = guardWith({ authorize: async () => Promise.resolve(false) });
      await expect(guard.canActivate(makeCtx().ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('receives the request and can read it', async () => {
      const authorize = jest.fn(
        (ctx: ProfilerAuthContext) => ctx.request.headers['x-key'] === 'ok',
      );
      const guard = guardWith({ authorize });
      await expect(guard.canActivate(makeCtx({ headers: { 'x-key': 'ok' } }).ctx)).resolves.toBe(
        true,
      );
    });

    it('lets authorize set a WWW-Authenticate challenge on the response before denying', async () => {
      const { ctx, response } = makeCtx();
      const guard = guardWith({
        authorize: ({ response: res }) => {
          res.setHeader('WWW-Authenticate', 'Basic realm="Profiler"');
          return false;
        },
      });
      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
      expect(response.headers['www-authenticate']).toBe('Basic realm="Profiler"');
    });
  });

  describe('guards', () => {
    it('uses a ready guard instance and allows when it passes', async () => {
      const canActivate = jest.fn().mockReturnValue(true);
      const guard = guardWith({ guards: [{ canActivate }] });
      await expect(guard.canActivate(makeCtx().ctx)).resolves.toBe(true);
      expect(canActivate).toHaveBeenCalled();
    });

    it('throws Unauthorized when a guard instance denies', async () => {
      const instance: CanActivate = { canActivate: jest.fn().mockReturnValue(false) };
      await expect(guardWith({ guards: [instance] }).canActivate(makeCtx().ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('resolves a guard class from the DI container', async () => {
      class MyGuard implements CanActivate {
        canActivate(): boolean {
          return true;
        }
      }
      const canActivate = jest.fn().mockReturnValue(true);
      const get = jest.fn().mockReturnValue({ canActivate });
      const guard = guardWith({ guards: [MyGuard] }, moduleRefMock({ get }));
      await expect(guard.canActivate(makeCtx().ctx)).resolves.toBe(true);
      expect(get).toHaveBeenCalledWith(MyGuard, { strict: false });
      expect(canActivate).toHaveBeenCalled();
    });

    it('instantiates a guard class when it is not a registered provider', async () => {
      class MyGuard implements CanActivate {
        canActivate(): boolean {
          return true;
        }
      }
      const canActivate = jest.fn().mockReturnValue(true);
      const get = jest.fn(() => {
        throw new Error('not registered');
      });
      const create = jest.fn().mockResolvedValue({ canActivate });
      const guard = guardWith({ guards: [MyGuard] }, moduleRefMock({ get, create }));
      await expect(guard.canActivate(makeCtx().ctx)).resolves.toBe(true);
      expect(create).toHaveBeenCalledWith(MyGuard);
      expect(canActivate).toHaveBeenCalled();
    });
  });

  describe('combining authorize and guards (all must pass)', () => {
    it('allows when both pass', async () => {
      const instance: CanActivate = { canActivate: jest.fn().mockReturnValue(true) };
      const guard = guardWith({ authorize: () => true, guards: [instance] });
      await expect(guard.canActivate(makeCtx().ctx)).resolves.toBe(true);
    });

    it('denies (and skips the guard) when authorize fails first', async () => {
      const canActivate = jest.fn().mockReturnValue(true);
      const guard = guardWith({ authorize: () => false, guards: [{ canActivate }] });
      await expect(guard.canActivate(makeCtx().ctx)).rejects.toThrow(UnauthorizedException);
      expect(canActivate).not.toHaveBeenCalled();
    });

    it('denies when authorize passes but a guard fails', async () => {
      const instance: CanActivate = { canActivate: jest.fn().mockReturnValue(false) };
      const guard = guardWith({ authorize: () => true, guards: [instance] });
      await expect(guard.canActivate(makeCtx().ctx)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('static assets', () => {
    it('exempts /__assets/ URLs even when a strategy would deny', async () => {
      const authorize = jest.fn().mockReturnValue(false);
      const guard = guardWith({ authorize });
      await expect(
        guard.canActivate(makeCtx({ url: '/_profiler/__assets/styles/toolbar.css' }).ctx),
      ).resolves.toBe(true);
      expect(authorize).not.toHaveBeenCalled();
    });

    it('exempts an asset URL that carries a query string', async () => {
      const authorize = jest.fn().mockReturnValue(false);
      const guard = guardWith({ authorize });
      await expect(
        guard.canActivate(makeCtx({ url: '/_profiler/__assets/scripts/core.js?v=2' }).ctx),
      ).resolves.toBe(true);
      expect(authorize).not.toHaveBeenCalled();
    });

    // The exemption is matched on the path, never on the raw URL: a query string is
    // caller-controlled, so testing the whole URL turned `?x=/__assets/` into an
    // unauthenticated read of the dashboard and of `/:token/data`.
    it.each([
      ['the list page', '/_profiler?x=/__assets/'],
      ['a profile page', '/_profiler/abc123?tab=/__assets/'],
      ['the JSON export', '/_profiler/abc123/data?x=/__assets/'],
    ])('still denies %s when /__assets/ only appears in the query string', async (_label, url) => {
      const authorize = jest.fn().mockReturnValue(false);
      const guard = guardWith({ authorize });
      await expect(guard.canActivate(makeCtx({ url }).ctx)).rejects.toThrow(UnauthorizedException);
      expect(authorize).toHaveBeenCalled();
    });

    it('does not exempt an /__assets/ segment outside the profiler base path', async () => {
      const authorize = jest.fn().mockReturnValue(false);
      const guard = guardWith({ authorize });
      await expect(
        guard.canActivate(makeCtx({ url: '/_profiler/abc/__assets/styles/x.css' }).ctx),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
