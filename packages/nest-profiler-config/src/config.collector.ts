import * as path from 'path';
import { Inject, Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ProfilerCollector,
  isPlainObject,
  redactString,
  REDACTED,
} from '@eleven-labs/nest-profiler';
import type { IProfilerCollector, Profile } from '@eleven-labs/nest-profiler';
import { CONFIG_COLLECTOR_OPTIONS } from './config-collector.module';
import type { ConfigCollectorModuleOptions } from './config-collector.module';

const CONFIG_ICON = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a6 6 0 100 12A6 6 0 008 2zm0 10a4 4 0 110-8 4 4 0 010 8z" opacity="0.4"/><circle cx="8" cy="8" r="2"/></svg>`;
const SECRET_RE = /password|secret|key|token|credential|api_key|apikey/i;

interface RuntimeInfo {
  nestVersion: string;
  nodeVersion: string;
  env: string;
  platform: string;
  arch: string;
  timezone: string;
  pid: number;
}

/** A single collapsible section in the Config panel. Namespaces registered with `registerAs`
 *  (whether loaded via `forRoot({ load })` or `ConfigModule.forFeature`) become one group each;
 *  top-level scalar values are gathered under a synthetic `General` group. */
export interface ConfigGroup {
  name: string;
  entries: Record<string, unknown>;
  keyCount: number;
}

export interface ConfigCollectorData {
  runtime: RuntimeInfo;
  groups: ConfigGroup[];
  keyCount: number;
}

/** Synthetic group holding top-level scalar config values that don't belong to a namespace. */
export const GENERAL_GROUP = 'General';

@ProfilerCollector({
  name: 'config',
  label: 'Config',
  icon: CONFIG_ICON,
  priority: 90,
  scope: 'global',
})
@Injectable()
export class ConfigCollector implements IProfilerCollector, OnApplicationBootstrap {
  readonly name = 'config';
  readonly label = 'Config';
  readonly icon = CONFIG_ICON;
  readonly priority = 90;
  readonly scope = 'global' as const;

  private groups: ConfigGroup[] = [];
  private keyCount = 0;
  private nestVersion = 'unknown';

  constructor(
    @Optional() private readonly configService: ConfigService,
    @Optional()
    @Inject(CONFIG_COLLECTOR_OPTIONS)
    private readonly options: ConfigCollectorModuleOptions = {},
  ) {}

  onApplicationBootstrap(): void {
    // Resolve NestJS version from package.json at runtime
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pkg = require('@nestjs/core/package.json') as { version: string };
      this.nestVersion = pkg.version;
    } catch {
      this.nestVersion = 'unknown';
    }

    if (!this.configService) return;

    try {
      const internalConfig = this.readInternalConfig();
      this.groups = this.buildGroups(internalConfig);
      this.keyCount = this.groups.reduce((total, group) => total + group.keyCount, 0);
      // Canary (MIN-14): we read ConfigService's private `internalConfig`. If a ConfigService is
      // present but we extracted nothing, the private shape likely changed in a @nestjs/config
      // update — warn so the empty panel is diagnosable instead of silent.
      if (this.keyCount === 0) {
        new Logger(ConfigCollector.name).warn(
          'Config panel is empty despite a ConfigService being present — the internal config ' +
            'shape may have changed in this @nestjs/config version, or no namespaced config is loaded.',
        );
      }
    } catch {
      this.groups = [];
      this.keyCount = 0;
    }
  }

  getBadgeValue(_profile: Profile): string | null {
    return this.keyCount > 0 ? `${this.keyCount}` : null;
  }

  getTemplatePath(): string {
    return path.join(__dirname, 'templates', 'config-panel.ejs');
  }

  collect(_profile: Profile): ConfigCollectorData {
    return {
      runtime: {
        nestVersion: this.nestVersion,
        nodeVersion: process.version,
        env: process.env.NODE_ENV ?? 'unknown',
        platform: process.platform,
        arch: process.arch,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        pid: process.pid,
      },
      groups: this.groups,
      keyCount: this.keyCount,
    };
  }

  /** Accesses ConfigService's private `internalConfig` property which holds all loaded config
   *  namespace values. No public API for this exists in NestJS 11. */
  private readInternalConfig(): Record<string, unknown> {
    // ConfigService has no public accessor for the full config map; TypeScript requires
    // the intermediate `unknown` cast when the source type has no index signature.
    const raw = (this.configService as unknown as Record<PropertyKey, unknown>)['internalConfig'];
    return isPlainObject(raw) ? raw : {};
  }

  /** Splits the flat internal config into collapsible groups: one per `registerAs` namespace
   *  (top-level plain objects) plus a `General` group for top-level scalar values.
   *  Provenance (`forRoot` load vs `forFeature`) is not recoverable from `@nestjs/config` — both
   *  merge into the same shared object — so grouping is purely structural (by namespace). */
  private buildGroups(internalConfig: Record<string, unknown>): ConfigGroup[] {
    const namespaceGroups: ConfigGroup[] = [];
    const generalEntries: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(internalConfig)) {
      // `@nestjs/config` stores the whole validated env (secrets included) under this internal
      // key when a `validationSchema` is used — never expose that firehose.
      if (key === '_PROCESS_ENV_VALIDATED') continue;

      if (isPlainObject(value)) {
        // A `registerAs` namespace: its keys are shown relative to the namespace (e.g. `host`),
        // but masked against their fully-qualified path (e.g. `database.host`) so user-supplied
        // `maskKeys: ['database.password']` keep matching.
        const entries = this.flattenAndMask(value, '', key);
        namespaceGroups.push({ name: key, entries, keyCount: Object.keys(entries).length });
      } else {
        generalEntries[key] = this.maskLeaf(key, key, value);
      }
    }

    namespaceGroups.sort((a, b) => a.name.localeCompare(b.name));

    const groups: ConfigGroup[] = [];
    if (Object.keys(generalEntries).length > 0) {
      groups.push({
        name: GENERAL_GROUP,
        entries: generalEntries,
        keyCount: Object.keys(generalEntries).length,
      });
    }
    groups.push(...namespaceGroups);
    return groups;
  }

  /** Flattens a namespace object to dot-notation leaf keys. `displayPrefix` builds the key shown
   *  in the panel (relative to the namespace); `maskPrefix` builds the fully-qualified key used
   *  only to decide masking. */
  private flattenAndMask(
    obj: Record<string, unknown>,
    displayPrefix: string,
    maskPrefix: string,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      const displayKey = displayPrefix ? `${displayPrefix}.${key}` : key;
      const maskKey = `${maskPrefix}.${key}`;
      if (isPlainObject(value)) {
        Object.assign(result, this.flattenAndMask(value, displayKey, maskKey));
      } else {
        result[displayKey] = this.maskLeaf(key, maskKey, value);
      }
    }

    return result;
  }

  /** Returns the display value for a leaf: `[REDACTED]` when the key looks sensitive, a redacted
   *  string when the value itself contains secrets (e.g. a DSN), otherwise the value unchanged. */
  private maskLeaf(key: string, maskKey: string, value: unknown): unknown {
    const maskKeys = this.options.maskKeys ?? [];
    if (shouldMaskKey(key, maskKey, maskKeys)) {
      // Masked by key name (e.g. `password`, `apiKey`) or an explicit `maskKeys` entry.
      return REDACTED;
    }
    if (typeof value === 'string') {
      // Masked by value pattern (e.g. a DSN `postgres://user:pass@host` whose key
      // — `DATABASE_URL` — does not itself look sensitive).
      return redactString(value);
    }
    return value;
  }
}

function shouldMaskKey(key: string, fullKey: string, maskKeys: string[]): boolean {
  return SECRET_RE.test(key) || maskKeys.includes(key) || maskKeys.includes(fullKey);
}
