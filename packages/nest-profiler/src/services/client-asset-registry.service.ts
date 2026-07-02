import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { PUBLIC_DIR } from '../views/template-engine';

export interface ClientAssetRegistration {
  /** File name served under `/_profiler/__assets/scripts/` (e.g. `http.js`). Must be unique. */
  file: string;
  /** Absolute path to the built bundle on disk (e.g. `join(__dirname, '..', 'public', 'scripts', 'http.js')`). */
  absPath: string;
}

/** Core bundle, always served first so its `window.NestProfiler` API is ready for extensions. */
export const CORE_CLIENT_SCRIPT = 'profiler.js';

/**
 * Registry of client-side script bundles the profiler serves same-origin and
 * emits into the page `<head>`. The core self-registers {@link CORE_CLIENT_SCRIPT};
 * any package shipping browser behaviour (e.g. alongside a collector) calls
 * {@link register} at bootstrap. This mirrors {@link TemplateRendererService} for
 * templates and keeps script registration decoupled from the collector contract.
 */
@Injectable()
export class ClientAssetRegistry {
  private readonly scripts = new Map<string, string>();

  constructor() {
    this.scripts.set(CORE_CLIENT_SCRIPT, path.join(PUBLIC_DIR, 'scripts', CORE_CLIENT_SCRIPT));
  }

  /** Register an extension bundle. The core script name is reserved; duplicates are ignored. */
  register({ file, absPath }: ClientAssetRegistration): void {
    if (file === CORE_CLIENT_SCRIPT) return;
    if (!this.scripts.has(file)) this.scripts.set(file, absPath);
  }

  /** Ordered list of served file names — core first, then registration order. */
  list(): string[] {
    return [...this.scripts.keys()];
  }

  /** Absolute on-disk path for a served file name, or `undefined` if not registered. */
  resolve(file: string): string | undefined {
    return this.scripts.get(file);
  }
}
