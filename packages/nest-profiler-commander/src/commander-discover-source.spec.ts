import 'reflect-metadata';
import { DiscoveryService, MetadataScanner, ModuleRef } from '@nestjs/core';
import { Command, CommandRunner, Option } from 'nest-commander';
import { CommanderDiscoverSource } from './commander-discover-source';

@Command({ name: 'build', description: 'Build the project' })
class BuildCommand extends CommandRunner {
  @Option({ flags: '-w, --watch', description: 'Watch mode' })
  parseWatch(): boolean {
    return true;
  }

  @Option({ flags: '--out <dir>', defaultValue: 'dist', required: true })
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

@Command({
  name: 'copy',
  arguments: '<source> [target...]',
  argsDescription: { source: 'Where to read from' },
})
class CopyCommand extends CommandRunner {
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
  const registerDiscoverSource = jest.fn();
  const get = jest.fn().mockReturnValue({ registerDiscoverSource });
  const source = new CommanderDiscoverSource(discovery, scanner, { get } as unknown as ModuleRef);
  return { source, registerDiscoverSource, get };
}

describe('CommanderDiscoverSource', () => {
  it('lists @Command classes with their description and documented options', () => {
    const { source, registerDiscoverSource } = buildSource([
      { instance: new BuildCommand(), metatype: BuildCommand },
      { instance: new ServeCommand(), metatype: ServeCommand },
      { instance: new NotACommand(), metatype: NotACommand },
    ]);
    source.onApplicationBootstrap();

    expect(registerDiscoverSource).toHaveBeenCalledWith(source);
    const group = source.collect();
    expect(group).toMatchObject({ source: 'command', label: 'Commands' });
    expect(group.entries).toEqual([
      {
        method: 'command',
        path: 'build',
        controller: 'BuildCommand',
        handler: 'run',
        description: 'Build the project',
        inputs: {
          groups: [
            {
              label: 'Options',
              items: [
                { name: '-w, --watch', description: 'Watch mode' },
                { name: '--out <dir>', required: true, defaultValue: 'dist' },
              ],
            },
          ],
        },
      },
      { method: 'command', path: 'serve', controller: 'ServeCommand', handler: 'run' },
    ]);
  });

  it('splits the positional arguments declaration into its own group', () => {
    const { source } = buildSource([{ instance: new CopyCommand(), metatype: CopyCommand }]);
    source.onApplicationBootstrap();

    expect(source.collect().entries[0]?.inputs?.groups).toEqual([
      {
        label: 'Arguments',
        items: [
          { name: '<source>', description: 'Where to read from', required: true },
          { name: '[target...]' },
        ],
      },
    ]);
  });

  it('lists short-only options and ignores providers without an instance/metatype', () => {
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

    expect(source.collect().entries).toEqual([
      {
        method: 'command',
        path: 'lint',
        controller: 'LintCommand',
        handler: 'run',
        inputs: { groups: [{ label: 'Options', items: [{ name: '-q' }] }] },
      },
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

    expect(source.collect().entries).toEqual([
      { method: 'command', path: 'Anon', controller: 'Anon', handler: 'run' },
    ]);
  });

  it('does not throw when the core is unavailable', () => {
    const { source, get } = buildSource([{ instance: new ServeCommand(), metatype: ServeCommand }]);
    get.mockImplementation(() => {
      throw new Error('no core');
    });
    expect(() => source.onApplicationBootstrap()).not.toThrow();
    expect(source.collect().entries.length).toBe(1);
  });
});
