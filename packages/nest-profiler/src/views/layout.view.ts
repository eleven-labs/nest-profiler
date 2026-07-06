import * as ejs from 'ejs';
import * as fs from 'fs';
import * as path from 'path';
import { PUBLIC_DIR, TEMPLATES_DIR } from './template-engine';
import { assetVersionQuery } from './asset-version';
import type { CollectorPanelInfo } from '../collectors/collector-registry.service';

let _toolbarSource: string | undefined;

function getToolbarSource(): string {
  return (_toolbarSource ??= fs.readFileSync(path.join(TEMPLATES_DIR, '_toolbar.ejs'), 'utf-8'));
}

export function toolbarSnippet(
  token: string,
  profilerPath: string,
  panels: CollectorPanelInfo[] = [],
): string {
  return ejs.render(getToolbarSource(), {
    token,
    profilerPath,
    panels,
    // The toolbar loads a single asset, so its cache-buster is that file's content digest.
    assetVersion: assetVersionQuery(path.join(PUBLIC_DIR, 'styles', 'toolbar.css')),
  });
}
