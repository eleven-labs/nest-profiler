import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, ModuleRef } from '@nestjs/core';
import { ProfilerCoreService } from '@eleven-labs/nest-profiler';
import type { ProfilerRouteSource, RouteEntry, RouteGroup } from '@eleven-labs/nest-profiler';

/** Inline SVG for the Commands group (a terminal prompt). */
const COMMAND_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" opacity="0.4"/><path d="M4 6l2.5 2L4 10M8 10h4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/**
 * nest-commander metadata keys, mirrored locally (they are not part of its public API) — a `@Command`
 * class carries `CommandMeta` (its name/options), and each `@Option` method carries `OptionMeta`
 * (its flags). Kept as plain strings so a nest-commander bump can't break our build.
 */
const COMMAND_META = 'CommandBuilder:Command:Meta';
const OPTION_META = 'CommandBuilder:Option:Meta';

interface CommandMetadata {
  name?: string;
}
interface OptionMetadata {
  flags?: string;
}

/**
 * A {@link ProfilerRouteSource} contributing a **Commands** group to the Routes panel. It scans the
 * providers for nest-commander `@Command()` classes and lists each command with its name, declaring
 * class and `--option` flags — the CLI counterpart of the REST route table.
 */
@Injectable()
export class CommanderRouteSource implements ProfilerRouteSource, OnApplicationBootstrap {
  readonly type = 'command';
  private group: RouteGroup = {
    source: 'command',
    label: 'Commands',
    icon: COMMAND_ICON,
    routes: [],
  };

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly moduleRef: ModuleRef,
  ) {}

  onApplicationBootstrap(): void {
    const routes: RouteEntry[] = [];

    for (const wrapper of this.discovery.getProviders()) {
      if (!wrapper.instance || !wrapper.metatype) continue;
      const metatype = wrapper.metatype as { name: string };
      const meta = Reflect.getMetadata(COMMAND_META, metatype) as CommandMetadata | undefined;
      if (!meta) continue;

      const options = this.optionFlags(wrapper.instance as Record<string, unknown>);
      routes.push({
        method: 'command',
        path: meta.name ?? metatype.name,
        controller: metatype.name,
        handler: 'run',
        ...(options.length > 0 ? { inputs: { query: options } } : {}),
      });
    }

    routes.sort((a, b) => a.path.localeCompare(b.path));
    this.group = { source: 'command', label: 'Commands', icon: COMMAND_ICON, routes };

    try {
      this.moduleRef.get(ProfilerCoreService, { strict: false }).registerRouteSource(this);
    } catch {
      // ProfilerCoreService unavailable — the profiler is not configured.
    }
  }

  collect(): RouteGroup {
    return this.group;
  }

  /** Collects the long `--flag` names from the command's `@Option` methods. */
  private optionFlags(instance: Record<string, unknown>): string[] {
    const flags: string[] = [];
    const prototype = Object.getPrototypeOf(instance) as object;
    this.metadataScanner.scanFromPrototype(instance, prototype, (methodName) => {
      const methodRef = instance[methodName];
      if (typeof methodRef !== 'function') return;
      // `@Option` stores its metadata on the method function itself (descriptor.value).
      const option = Reflect.getMetadata(OPTION_META, methodRef) as OptionMetadata | undefined;
      const long = option?.flags?.match(/--[A-Za-z0-9-]+/)?.[0];
      if (long && !flags.includes(long)) flags.push(long);
    });
    return flags;
  }
}
