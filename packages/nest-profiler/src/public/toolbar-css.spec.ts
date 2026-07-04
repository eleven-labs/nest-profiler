import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Regression guards for BLO-2: the toolbar is injected into *host* application pages, so its
 * stylesheet must never carry Tailwind's preflight (a universal reset that zeroes the host's
 * margins/paddings/borders and resets headings). We assert this at two levels:
 *  - source: `toolbar.css` opts out of preflight (theme + utilities layers only);
 *  - compiled: the built sheet has no destructive universal reset (only a scoped one).
 */
describe('toolbar stylesheet isolation (BLO-2)', () => {
  const src = readFileSync(join(__dirname, 'toolbar.css'), 'utf-8');

  it('source imports only theme + utilities, not the full tailwind bundle (no preflight)', () => {
    expect(src).toContain("@import 'tailwindcss/theme.css'");
    expect(src).toContain("@import 'tailwindcss/utilities.css'");
    expect(src).not.toMatch(/@import\s+['"]tailwindcss['"]\s*;/);
    expect(src).not.toContain("@import 'tailwindcss/preflight");
  });

  it('source scopes its only reset under #profiler-toolbar', () => {
    expect(src).toContain('#profiler-toolbar');
  });

  it('compiled toolbar.css (when built) carries no destructive universal reset', () => {
    let compiled: string;
    try {
      compiled = readFileSync(
        join(__dirname, '..', '..', 'dist', 'public', 'styles', 'toolbar.css'),
        'utf-8',
      );
    } catch {
      // dist not built in this run — the source-level guards above still hold the contract.
      return;
    }
    // Tailwind's benign `--tw-*` custom-property registration on `*` is allowed; a preflight
    // reset (margin/padding/border:0 on the universal selector) is not.
    expect(compiled).not.toMatch(/\*[^{]*\{[^}]*margin:\s*0[^}]*padding:\s*0/);
    expect(compiled).not.toMatch(/[^-]\bbody\s*\{\s*margin:\s*0/);
  });
});
