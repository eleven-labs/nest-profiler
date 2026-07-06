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

export interface ConfigCollectorData {
  runtime: RuntimeInfo;
  config: Record<string, unknown>;
}

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

  private configSnapshot: Record<string, unknown> = {};
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
      this.configSnapshot = this.flattenAndMask(internalConfig);
      this.keyCount = Object.keys(this.configSnapshot).length;
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
      this.configSnapshot = {};
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
      config: this.configSnapshot,
    };
  }

  /** Accesses ConfigService's private `internalConfig` property which holds all loaded config
   *  namespace values. No public API for this exists in NestJS 11. */
  private readInternalConfig(): Record<string, unknown> {
    if (!this.configService) return {};
    // ConfigService has no public accessor for the full config map; TypeScript requires
    // the intermediate `unknown` cast when the source type has no index signature.
    const raw = (this.configService as unknown as Record<PropertyKey, unknown>)['internalConfig'];
    return isPlainObject(raw) ? raw : {};
  }

  private flattenAndMask(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const maskKeys = this.options.maskKeys ?? [];

    for (const [key, value] of Object.entries(obj)) {
      // `@nestjs/config` stores the whole validated env (secrets included) under this internal
      // key when a `validationSchema` is used — never expose that firehose.
      if (key === '_PROCESS_ENV_VALIDATED') continue;

      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (isPlainObject(value)) {
        Object.assign(result, this.flattenAndMask(value, fullKey));
      } else if (shouldMaskKey(key, fullKey, maskKeys)) {
        // Masked by key name (e.g. `password`, `apiKey`).
        result[fullKey] = REDACTED;
      } else if (typeof value === 'string') {
        // Masked by value pattern (e.g. a DSN `postgres://user:pass@host` whose key
        // — `DATABASE_URL` — does not itself look sensitive).
        result[fullKey] = redactString(value);
      } else {
        result[fullKey] = value;
      }
    }

    return result;
  }
}

function shouldMaskKey(key: string, fullKey: string, maskKeys: string[]): boolean {
  return SECRET_RE.test(key) || maskKeys.includes(key) || maskKeys.includes(fullKey);
}
