import 'reflect-metadata';
import { DiscoveryService, MetadataScanner, ModuleRef } from '@nestjs/core';
import { Command, CommandRunner, Option } from 'nest-commander';
import { CommanderRouteSource } from './commander-route-source';

@Command({ name: 'build', description: 'Build the project' })
class BuildCommand extends CommandRunner {
  @Option({ flags: '-w, --watch', description: 'Watch mode' })
  parseWatch(): boolean {
    return true;
  }

  @Option({ flags: '--out <dir>' })
  parseOut(val: string): string {
    return val;
  }

  run(): Promise<void> {
    return Promise.resolve();
  }
}

@Command({ name: 'serve' })
class ServeCommand extends CommandRunner {
  run(): Promise<void> {
    return Promise.resolve();
  }
}

class NotACommand {
  run(): void {}
}

function buildSource(providers: { instance: object; metatype: unknown }[]) {
  const discovery = {
    getProviders: () => providers,
  } as Partial<DiscoveryService> as DiscoveryService;
  const scanner = {
    scanFromPrototype: (instance: object, prototype: object, cb: (name: string) => void) => {
      for (const name of Object.getOwnPropertyNames(prototype)) {
        if (name !== 'constructor') cb(name);
      }
    },
  } as Partial<MetadataScanner> as MetadataScanner;
  const registerRouteSource = jest.fn();
  const get = jest.fn().mockReturnValue({ registerRouteSource });
  const source = new CommanderRouteSource(discovery, scanner, { get } as unknown as ModuleRef);
  return { source, registerRouteSource, get };
}

describe('CommanderRouteSource', () => {
  it('lists @Command classes with their name and --option flags', () => {
    const { source, registerRouteSource } = buildSource([
      { instance: new BuildCommand(), metatype: BuildCommand },
      { instance: new ServeCommand(), metatype: ServeCommand },
      { instance: new NotACommand(), metatype: NotACommand },
    ]);
    source.onApplicationBootstrap();

    expect(registerRouteSource).toHaveBeenCalledWith(source);
    const group = source.collect();
    expect(group).toMatchObject({ source: 'command', label: 'Commands' });
    expect(group.routes).toEqual([
      {
        method: 'command',
        path: 'build',
        controller: 'BuildCommand',
        handler: 'run',
        inputs: { query: ['--watch', '--out'] },
      },
      { method: 'command', path: 'serve', controller: 'ServeCommand', handler: 'run' },
    ]);
  });

  it('ignores providers without an instance/metatype and options with no long flag', () => {
    @Command({ name: 'lint' })
    class LintCommand extends CommandRunner {
      @Option({ flags: '-q' })
      parseQuiet(): boolean {
        return true;
      }

      run(): Promise<void> {
        return Promise.resolve();
      }
    }

    const { source } = buildSource([
      { instance: undefined as unknown as object, metatype: undefined },
      { instance: new LintCommand(), metatype: LintCommand },
    ]);
    source.onApplicationBootstrap();

    // The short-only `-q` flag yields no long name, so the command has no listed options.
    expect(source.collect().routes).toEqual([
      { method: 'command', path: 'lint', controller: 'LintCommand', handler: 'run' },
    ]);
  });

  it('falls back to the class name when the command is unnamed and skips non-function members', () => {
    class Anon extends CommandRunner {
      run(): Promise<void> {
        return Promise.resolve();
      }
    }
    Reflect.defineMetadata('CommandBuilder:Command:Meta', {}, Anon);
    (Anon.prototype as unknown as Record<string, unknown>)['banner'] = 'not-a-function';

    const { source } = buildSource([{ instance: new Anon(), metatype: Anon }]);
    source.onApplicationBootstrap();

    expect(source.collect().routes).toEqual([
      { method: 'command', path: 'Anon', controller: 'Anon', handler: 'run' },
    ]);
  });

  it('does not throw when the core is unavailable', () => {
    const { source, get } = buildSource([{ instance: new ServeCommand(), metatype: ServeCommand }]);
    get.mockImplementation(() => {
      throw new Error('no core');
    });
    expect(() => source.onApplicationBootstrap()).not.toThrow();
    expect(source.collect().routes.length).toBe(1);
  });
});
