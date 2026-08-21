import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, ModuleRef } from '@nestjs/core';
import { ProfilerCoreService } from '@eleven-labs/nest-profiler';
import type {
  ProfilerDiscoverSource,
  DiscoverEntry,
  DiscoverGroup,
  DiscoverInputGroup,
  DiscoverInputItem,
} from '@eleven-labs/nest-profiler';
import { COMMAND_ICON } from './icons';

/**
 * nest-commander metadata keys, mirrored locally (they are not part of its public API) — a `@Command`
 * class carries `CommandMeta` (its name/arguments/description), and each `@Option` method carries
 * `OptionMeta` (its flags/description). Kept as plain strings so a nest-commander bump can't break
 * our build.
 */
const COMMAND_META = 'CommandBuilder:Command:Meta';
const OPTION_META = 'CommandBuilder:Option:Meta';

/** The subset of nest-commander's `CommandMetadata` this source reads. */
interface CommandMetadata {
  name?: string;
  description?: string;
  /** Positional argument declaration, e.g. `'<source> [target]'`. */
  arguments?: string;
  /** Per-argument descriptions, keyed by the bare argument name (`{ source: 'Where to read from' }`). */
  argsDescription?: Record<string, string>;
}

/** The subset of nest-commander's `OptionMetadata` this source reads. */
interface OptionMetadata {
  flags?: string;
  description?: string;
  defaultValue?: string | boolean | number;
  required?: boolean;
}

/**
 * A {@link ProfilerDiscoverSource} contributing the **Discover / Commands** view. It scans the
 * providers for nest-commander `@Command()` classes and lists each command with its name,
 * description, declaring class, positional **arguments** (from `@Command({ arguments })`) and
 * `--option` flags (from `@Option()`, with their descriptions) — the CLI counterpart of the REST
 * route table.
 *
 * Arguments and options are surfaced as two distinct groups, mirroring the CLI itself: arguments are
 * positional operands handed to `run(passedParams)`, options are the parsed flags handed to
 * `run(_, options)`.
 */
@Injectable()
export class CommanderDiscoverSource implements ProfilerDiscoverSource, OnApplicationBootstrap {
  readonly type = 'command';
  private group: DiscoverGroup = {
    source: 'command',
    label: 'Commands',
    itemLabel: 'command',
    icon: COMMAND_ICON,
    entries: [],
  };

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly moduleRef: ModuleRef,
  ) {}

  onApplicationBootstrap(): void {
    const entries: DiscoverEntry[] = [];

    for (const wrapper of this.discovery.getProviders()) {
      if (!wrapper.instance || !wrapper.metatype) continue;
      const metatype = wrapper.metatype as { name: string };
      const meta = Reflect.getMetadata(COMMAND_META, metatype) as CommandMetadata | undefined;
      if (!meta) continue;

      const groups: DiscoverInputGroup[] = [];
      const args = this.commandArguments(meta);
      if (args.length > 0) groups.push({ label: 'Arguments', items: args });
      const options = this.commandOptions(wrapper.instance as Record<string, unknown>);
      if (options.length > 0) groups.push({ label: 'Options', items: options });

      entries.push({
        method: 'command',
        path: meta.name ?? metatype.name,
        controller: metatype.name,
        handler: 'run',
        ...(meta.description ? { description: meta.description } : {}),
        ...(groups.length > 0 ? { inputs: { groups } } : {}),
      });
    }

    entries.sort((a, b) => a.path.localeCompare(b.path));
    this.group = {
      source: 'command',
      label: 'Commands',
      icon: COMMAND_ICON,
      itemLabel: 'command',
      entries,
    };

    try {
      this.moduleRef.get(ProfilerCoreService, { strict: false }).registerDiscoverSource(this);
    } catch {
      // ProfilerCoreService unavailable — the profiler is not configured.
    }
  }

  collect(): DiscoverGroup {
    return this.group;
  }

  /**
   * Splits `@Command({ arguments: '<source> [target...]' })` into one item per positional argument,
   * matching each with its `argsDescription` entry. `<…>` is required, `[…]` optional — commander's
   * own convention, kept verbatim in the displayed name. Descriptions are matched by substring, the
   * same rule nest-commander applies, so both `source` and `<source>` work as keys.
   */
  private commandArguments(meta: CommandMetadata): DiscoverInputItem[] {
    const declaration = meta.arguments?.trim();
    if (!declaration) return [];
    const descriptionKeys = Object.keys(meta.argsDescription ?? {});

    return declaration
      .split(/\s+/)
      .filter((token) => token.length > 0)
      .map((token) => {
        const key = descriptionKeys.find((candidate) => token.includes(candidate));
        const description = key ? meta.argsDescription?.[key] : undefined;
        return {
          name: token,
          ...(description ? { description } : {}),
          ...(token.startsWith('<') ? { required: true } : {}),
        };
      });
  }

  /** Collects the declared `@Option` flags with their description, default and required marker. */
  private commandOptions(instance: Record<string, unknown>): DiscoverInputItem[] {
    const options: DiscoverInputItem[] = [];
    const prototype = Object.getPrototypeOf(instance) as object;

    this.metadataScanner.scanFromPrototype(instance, prototype, (methodName) => {
      const methodRef = instance[methodName];
      if (typeof methodRef !== 'function') return;
      // `@Option` stores its metadata on the method function itself (descriptor.value).
      const option = Reflect.getMetadata(OPTION_META, methodRef) as OptionMetadata | undefined;
      const flags = option?.flags?.trim();
      if (!flags || options.some((existing) => existing.name === flags)) return;

      options.push({
        name: flags,
        ...(option?.description ? { description: option.description } : {}),
        ...(option?.required ? { required: true } : {}),
        ...(option?.defaultValue !== undefined
          ? { defaultValue: String(option.defaultValue) }
          : {}),
      });
    });

    return options;
  }
}
