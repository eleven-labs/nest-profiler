import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { Injectable } from '@nestjs/common';
import * as ejs from 'ejs';
import { HELPERS, TEMPLATES_DIR } from '../views/template-engine';

@Injectable()
export class TemplateRendererService {
  private readonly dirs: string[] = [TEMPLATES_DIR];

  registerDir(dir: string): void {
    if (!this.dirs.includes(dir)) {
      this.dirs.push(dir);
    }
  }

  async render(name: string, data: Record<string, unknown>): Promise<string> {
    const templatePath = this.resolve(name);
    return ejs.renderFile(templatePath, { ...HELPERS, ...data } as ejs.Data, { views: this.dirs });
  }

  private resolve(name: string): string {
    for (const dir of this.dirs) {
      const candidate = path.join(dir, `${name}.ejs`);
      if (existsSync(candidate)) return candidate;
    }
    throw new Error(`Template "${name}" not found in: ${this.dirs.join(', ')}`);
  }
}
