import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import * as ejs from 'ejs';
import { HELPERS, PUBLIC_DIR, TEMPLATES_DIR } from '../views/template-engine';
import { assetVersionQuery } from '../views/asset-version';
import { createDateHelpers, hostTimezone, isValidTimezone } from '../views/date-helpers';
import type { DateHelpers } from '../views/date-helpers';
import { NEST_PROFILER_MODULE_OPTIONS } from '../nest-profiler.builder';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import { ClientAssetRegistry } from './client-asset-registry.service';

@Injectable()
export class TemplateRendererService {
  private readonly logger = new Logger(TemplateRendererService.name);
  private readonly dirs: string[] = [TEMPLATES_DIR];
  /**
   * IANA timezone every rendered timestamp is projected into, and shown in the UI header.
   * `undefined` when the runtime cannot name the host zone — timestamps then follow the
   * runtime default and the header simply says nothing.
   */
  private readonly displayTimezone: string | undefined;
  private readonly dateHelpers: DateHelpers;

  constructor(
    private readonly clientAssets: ClientAssetRegistry,
    @Optional()
    @Inject(NEST_PROFILER_MODULE_OPTIONS)
    options?: ProfilerModuleOptions,
  ) {
    this.displayTimezone = this.resolveTimezone(options?.timezone);
    this.dateHelpers = createDateHelpers(this.displayTimezone);
  }

  private resolveTimezone(configured?: string): string | undefined {
    const host = hostTimezone();
    if (!configured) return host;
    if (isValidTimezone(configured)) return configured;
    const fallback = host ? `the host timezone "${host}"` : 'the runtime default timezone';
    this.logger.warn(
      `Unknown timezone "${configured}" - rendering timestamps in ${fallback} instead. ` +
        `Expected an IANA name such as "Europe/Paris".`,
    );
    return host;
  }

  registerDir(dir: string): void {
    if (!this.dirs.includes(dir)) {
      this.dirs.push(dir);
    }
  }

  async render(name: string, data: Record<string, unknown>): Promise<string> {
    const templatePath = this.resolve(name);
    // `assetVersion(key)` and `link(href)` are globals so every template (and its includes,
    // e.g. _head/_nav) can cache-bust an asset URL and thread a `security.linkQuery`
    // credential onto links. Both default to no-ops here; an explicit value in `data` wins.
    // `isoDate`/`timeOnly` come bound to the configured timezone, overriding the
    // host-timezone defaults `HELPERS` carries, and `displayTimezone` labels them in the nav.
    return ejs.renderFile(
      templatePath,
      {
        ...HELPERS,
        ...this.dateHelpers,
        displayTimezone: this.displayTimezone,
        assetVersion: this.assetVersion,
        link: (href: string) => href,
        linkQueryPairs: [],
        ...data,
      } as ejs.Data,
      { views: this.dirs },
    );
  }

  /**
   * The `?v=<digest>` query for an asset addressed as `styles/<file>` or `scripts/<file>` — the
   * same path segment used in its URL. Registered client bundles (core + extensions, which may
   * live in another package's `dist`) resolve through the registry; styles and vendored scripts
   * resolve under this package's `PUBLIC_DIR`.
   */
  private readonly assetVersion = (assetKey: string): string =>
    assetVersionQuery(this.resolveAssetPath(assetKey));

  private resolveAssetPath(assetKey: string): string {
    const scriptPrefix = 'scripts/';
    if (assetKey.startsWith(scriptPrefix)) {
      const file = assetKey.slice(scriptPrefix.length);
      return this.clientAssets.resolve(file) ?? path.join(PUBLIC_DIR, assetKey);
    }
    return path.join(PUBLIC_DIR, assetKey);
  }

  private resolve(name: string): string {
    for (const dir of this.dirs) {
      const candidate = path.join(dir, `${name}.ejs`);
      if (existsSync(candidate)) return candidate;
    }
    throw new Error(`Template "${name}" not found in: ${this.dirs.join(', ')}`);
  }
}
