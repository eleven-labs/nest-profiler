import { loadOptionalPeer, resolveOptionalPeer } from './optional-peer.util';

/** A resolution error as Node raises it, carrying the `code` the helper branches on. */
function nodeError(message: string, code: string): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

describe('resolveOptionalPeer', () => {
  it('loads an installed package', () => {
    const result = resolveOptionalPeer<{ join: unknown }>('node:path');
    expect(result.status).toBe('loaded');
    expect(result.status === 'loaded' && typeof result.module.join).toBe('function');
  });

  it('reports a package that is not installed as absent, not as an error', () => {
    expect(resolveOptionalPeer('@eleven-labs/definitely-not-installed')).toEqual({
      status: 'absent',
    });
  });

  // The distinction the helper exists for: a peer whose own dependency is missing raises the very
  // same MODULE_NOT_FOUND, and calling that "not installed" is how a broken install turns into a
  // silently missing panel.
  it('reports a package whose own dependency is missing as broken', () => {
    jest.isolateModules(() => {
      jest.doMock(
        'broken-peer',
        () => {
          throw nodeError("Cannot find module 'its-own-dependency'", 'MODULE_NOT_FOUND');
        },
        { virtual: true },
      );
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { resolveOptionalPeer: resolve } = require('./optional-peer.util') as {
        resolveOptionalPeer: typeof resolveOptionalPeer;
      };
      const result = resolve('broken-peer');
      expect(result.status).toBe('broken');
      expect(result.status === 'broken' && result.error.message).toContain('its-own-dependency');
    });
  });

  it('reports a package whose top-level code throws as broken', () => {
    jest.isolateModules(() => {
      jest.doMock(
        'exploding-peer',
        () => {
          throw new Error('boom on import');
        },
        { virtual: true },
      );
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { resolveOptionalPeer: resolve } = require('./optional-peer.util') as {
        resolveOptionalPeer: typeof resolveOptionalPeer;
      };
      expect(resolve('exploding-peer')).toEqual({
        status: 'broken',
        error: expect.objectContaining({ message: 'boom on import' }) as Error,
      });
    });
  });

  it('reports a peer that throws a non-Error value as broken, keeping what it threw', () => {
    jest.isolateModules(() => {
      jest.doMock(
        'rude-peer',
        () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'not even an Error';
        },
        { virtual: true },
      );
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { resolveOptionalPeer: resolve } = require('./optional-peer.util') as {
        resolveOptionalPeer: typeof resolveOptionalPeer;
      };
      const result = resolve('rude-peer');
      expect(result.status).toBe('broken');
      expect(result.status === 'broken' && result.error.message).toBe('not even an Error');
    });
  });

  // `@nestjs/core` exports `./package.json` in v11 and stopped in v12 — reading the framework
  // version must not depend on that decision. `@libsql/client` is a package installed here whose
  // exports map genuinely refuses `./package.json`, so this exercises the real fallback.
  it('recovers a subpath an exports map refuses, through the package root', () => {
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@libsql/client/package.json');
    }).toThrow();

    const result = resolveOptionalPeer<{ name: string }>('@libsql/client/package.json');
    expect(result.status).toBe('loaded');
    expect(result.status === 'loaded' && result.module.name).toBe('@libsql/client');
  });

  it('reports a refused subpath of an absent package as absent', () => {
    jest.isolateModules(() => {
      jest.doMock(
        '@eleven-labs/not-installed/package.json',
        () => {
          throw nodeError(
            'Package subpath ./package.json is not defined by "exports"',
            'ERR_PACKAGE_PATH_NOT_EXPORTED',
          );
        },
        { virtual: true },
      );
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { resolveOptionalPeer: resolve } = require('./optional-peer.util') as {
        resolveOptionalPeer: typeof resolveOptionalPeer;
      };
      // The package root cannot be located either, so the original refusal is classified — and it
      // is not a MODULE_NOT_FOUND, so it is reported honestly rather than swallowed.
      expect(resolve('@eleven-labs/not-installed/package.json').status).toBe('broken');
    });
  });
});

describe('loadOptionalPeer', () => {
  it('returns the exports of an installed package', () => {
    expect(typeof loadOptionalPeer<{ join: unknown }>('node:path')?.join).toBe('function');
  });

  it('stays silent for a package that is simply not installed', () => {
    const logger = { warn: jest.fn() };
    expect(loadOptionalPeer('@eleven-labs/definitely-not-installed', logger)).toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns — naming the package and the reason — when it is installed but broken', () => {
    jest.isolateModules(() => {
      jest.doMock(
        'exploding-peer',
        () => {
          throw new Error('boom on import');
        },
        { virtual: true },
      );
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { loadOptionalPeer: load } = require('./optional-peer.util') as {
        loadOptionalPeer: typeof loadOptionalPeer;
      };
      const logger = { warn: jest.fn() };

      expect(load('exploding-peer', logger)).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Optional peer 'exploding-peer' is installed") as string,
      );
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('boom on import') as string);
    });
  });
});
