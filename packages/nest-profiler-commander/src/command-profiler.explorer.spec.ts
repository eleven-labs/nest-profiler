import type { DiscoveryService } from '@nestjs/core';
import { CommandRunner } from 'nest-commander';
import { CommandProfilerExplorer } from './command-profiler.explorer';
import type { CommandProfiler, CommandProfileMeta } from './command-profiler.service';

/** Stand-in for nest-commander's abstract `CommandRunner`. */
class FakeCommandRunner {
  command?: { name?: () => string };
  async run(_passedParams: string[], _options?: Record<string, unknown>): Promise<void> {}
}

class HelloCommand extends FakeCommandRunner {
  command = { name: (): string => 'hello' };
  ran = false;
  receivedParams: string[] = [];
  override run(passedParams: string[], _options?: Record<string, unknown>): Promise<void> {
    this.ran = true;
    this.receivedParams = passedParams;
    return Promise.resolve();
  }
}

/** A command with no `command.name()` — name should fall back to the class name. */
class NamelessCommand extends FakeCommandRunner {}

/** Stand-in for a commander `Option` as nest-commander builds it from `@Option()`. */
function fakeOption(
  flags: string,
  attribute: string,
  parseArg?: (value: string, previous: unknown) => unknown,
): { flags: string; attributeName: () => string; parseArg?: typeof parseArg } {
  return { flags, attributeName: () => attribute, parseArg };
}

/**
 * A command whose `--site` parser rejects its input, mirroring an `@Option()` parser that
 * validates. Commander runs these parsers itself, before the action handler.
 */
class ValidatingCommand extends FakeCommandRunner {
  readonly siteOption = fakeOption('-s, --site [string]', 'site', (value: string) => {
    if (value !== 'known.example') throw new Error('Unknown site parameter');
    return value;
  });
  readonly yearOption = fakeOption('-y, --year [number]', 'year', (value: string) => Number(value));
  command = {
    name: (): string => 'generate:articles',
    opts: (): Record<string, unknown> => ({ locale: 'fr' }),
    options: [this.siteOption, this.yearOption, fakeOption('-q, --quiet', 'quiet')],
  };
}

/** Substitutes the CommandRunner discriminant with a stand-in so tests need no real class. */
class TestExplorer extends CommandProfilerExplorer {
  protected override getCommandRunnerClass(): typeof FakeCommandRunner {
    return FakeCommandRunner;
  }
}

function createDiscovery(instances: unknown[]): DiscoveryService {
  return {
    getProviders: () => instances.map((instance) => ({ instance })),
  } as unknown as DiscoveryService;
}

function createProfiler(): {
  profiler: CommandProfiler;
  profile: jest.Mock;
  profileParseFailure: jest.Mock;
  metas: CommandProfileMeta[];
} {
  const metas: CommandProfileMeta[] = [];
  const profile = jest.fn((meta: CommandProfileMeta, exec: () => Promise<void>) => {
    metas.push(meta);
    return exec();
  });
  const profileParseFailure = jest.fn();
  return {
    profiler: { profile, profileParseFailure } as unknown as CommandProfiler,
    profile,
    profileParseFailure,
    metas,
  };
}

describe('CommandProfilerExplorer', () => {
  it('wraps discovered commands and profiles their run()', async () => {
    const hello = new HelloCommand();
    const { profiler, profile, metas } = createProfiler();
    const explorer = new TestExplorer(createDiscovery([hello]), profiler);

    explorer.onApplicationBootstrap();
    await hello.run(['a', 'b'], { verbose: true });

    expect(profile).toHaveBeenCalledTimes(1);
    expect(metas[0]).toEqual({
      name: 'hello',
      arguments: ['a', 'b'],
      options: { verbose: true },
    });
    // original implementation still runs
    expect(hello.ran).toBe(true);
    expect(hello.receivedParams).toEqual(['a', 'b']);
  });

  it('falls back to the class name when the command has no name()', async () => {
    const nameless = new NamelessCommand();
    const { profiler, metas } = createProfiler();
    const explorer = new TestExplorer(createDiscovery([nameless]), profiler);

    explorer.onApplicationBootstrap();
    await nameless.run([]);

    expect(metas[0]).toMatchObject({ name: 'NamelessCommand', arguments: [] });
  });

  it('defaults options to an empty object when omitted', async () => {
    const hello = new HelloCommand();
    const { profiler, metas } = createProfiler();
    const explorer = new TestExplorer(createDiscovery([hello]), profiler);

    explorer.onApplicationBootstrap();
    await hello.run([]);

    expect(metas[0]).toMatchObject({ arguments: [], options: {} });
  });

  it('defaults arguments to an empty array when passedParams is missing', async () => {
    const hello = new HelloCommand();
    const { profiler, metas } = createProfiler();
    const explorer = new TestExplorer(createDiscovery([hello]), profiler);

    explorer.onApplicationBootstrap();
    await (hello.run as (p?: string[]) => Promise<void>)(undefined);

    expect(metas[0]).toMatchObject({ arguments: [], options: {} });
  });

  it('ignores providers that are not commands', () => {
    const plain = { run: jest.fn() };
    const { profiler, profile } = createProfiler();
    const explorer = new TestExplorer(createDiscovery([plain, undefined, null]), profiler);

    explorer.onApplicationBootstrap();

    expect(profile).not.toHaveBeenCalled();
  });

  it('is idempotent — bootstrapping twice does not double-wrap', async () => {
    const hello = new HelloCommand();
    const { profiler, profile } = createProfiler();
    const explorer = new TestExplorer(createDiscovery([hello]), profiler);

    explorer.onApplicationBootstrap();
    explorer.onApplicationBootstrap();
    await hello.run(['x']);

    expect(profile).toHaveBeenCalledTimes(1);
  });

  it('profiles an @Option() parser that rejects its value, and rethrows', () => {
    const command = new ValidatingCommand();
    const { profiler, profileParseFailure, profile } = createProfiler();
    const explorer = new TestExplorer(createDiscovery([command]), profiler);

    explorer.onApplicationBootstrap();

    // Commander calls the option parser itself, before any action handler runs.
    expect(() => command.siteOption.parseArg?.('unknown.example', undefined)).toThrow(
      'Unknown site parameter',
    );

    expect(profile).not.toHaveBeenCalled();
    expect(profileParseFailure).toHaveBeenCalledTimes(1);
    const [meta, error] = profileParseFailure.mock.calls[0] as [CommandProfileMeta, Error];
    expect(meta).toEqual({
      name: 'generate:articles',
      arguments: [],
      // Options resolved so far (defaults included) plus the raw value of the rejected flag.
      options: { locale: 'fr', site: 'unknown.example' },
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Unknown site parameter');
  });

  it('leaves a successful option parser transparent', () => {
    const command = new ValidatingCommand();
    const { profiler, profileParseFailure } = createProfiler();
    const explorer = new TestExplorer(createDiscovery([command]), profiler);

    explorer.onApplicationBootstrap();

    expect(command.siteOption.parseArg?.('known.example', undefined)).toBe('known.example');
    expect(command.yearOption.parseArg?.('2026', undefined)).toBe(2026);
    expect(profileParseFailure).not.toHaveBeenCalled();
  });

  it('does not double-wrap option parsers when bootstrapped twice', () => {
    const command = new ValidatingCommand();
    const { profiler, profileParseFailure } = createProfiler();
    const explorer = new TestExplorer(createDiscovery([command]), profiler);

    explorer.onApplicationBootstrap();
    explorer.onApplicationBootstrap();

    expect(() => command.siteOption.parseArg?.('unknown.example', undefined)).toThrow();
    expect(profileParseFailure).toHaveBeenCalledTimes(1);
  });

  it('ignores commands with no commander options to wrap', () => {
    const hello = new HelloCommand();
    const { profiler } = createProfiler();
    const explorer = new TestExplorer(createDiscovery([hello]), profiler);

    expect(() => explorer.onApplicationBootstrap()).not.toThrow();
  });

  it('detects commands via the real nest-commander CommandRunner (static import)', async () => {
    class RealCommand extends CommandRunner {
      async run(_passedParams: string[], _options?: Record<string, unknown>): Promise<void> {}
    }
    const cmd = new RealCommand();
    const { profiler, profile, metas } = createProfiler();
    // Plain explorer — exercises getCommandRunnerClass() returning the statically-imported class.
    const explorer = new CommandProfilerExplorer(createDiscovery([cmd]), profiler);

    explorer.onApplicationBootstrap();
    await cmd.run([], {});

    expect(profile).toHaveBeenCalledTimes(1);
    expect(metas[0]).toMatchObject({ name: 'RealCommand' });
  });
});
