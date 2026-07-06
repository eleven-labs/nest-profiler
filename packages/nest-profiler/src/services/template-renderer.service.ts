import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { Injectable } from '@nestjs/common';
import * as ejs from 'ejs';
import { HELPERS, PUBLIC_DIR, TEMPLATES_DIR } from '../views/template-engine';
import { assetVersionQuery } from '../views/asset-version';
import { ClientAssetRegistry } from './client-asset-registry.service';

@Injectable()
export class TemplateRendererService {
  private readonly dirs: string[] = [TEMPLATES_DIR];

  constructor(private readonly clientAssets: ClientAssetRegistry) {}

  registerDir(dir: string): void {
    if (!this.dirs.includes(dir)) {
      this.dirs.push(dir);
    }
  }

  async render(name: string, data: Record<string, unknown>): Promise<string> {
    const templatePath = this.resolve(name);
    // `assetVersion(key)` is a global so every template (and its includes, e.g. _head) can
    // cache-bust an asset URL by its own content digest; an explicit value in `data` still wins.
    return ejs.renderFile(
      templatePath,
      { ...HELPERS, assetVersion: this.assetVersion, ...data } as ejs.Data,
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
