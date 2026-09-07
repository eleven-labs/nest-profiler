import type { NestProfilerApi } from '../runtime';

/** Elements that own their click — the row must not hijack them. */
const INTERACTIVE = 'a, button, input, select, textarea, label, summary';

/**
 * Whether `href` is a site-relative path of this origin, the only shape a row is allowed
 * to navigate to. A row's href is DOM text, so it is checked before it reaches a
 * navigation sink: the single leading slash rules out `javascript:` and protocol-relative
 * `//host` values, and resolving against the current origin rules out the rest.
 */
function isSafeRowHref(href: string): boolean {
  if (!/^\/(?!\/)/.test(href)) return false;
  try {
    return new URL(href, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Makes a list row its own link: the profile URL sits on the `<tr>` (`data-row-href`)
 * rather than on one cell, so the whole row opens the profile — a click anywhere, or
 * Enter when the row has focus (rows carry `tabindex="0"`, since a `<tr>` is not
 * focusable on its own). ctrl/meta and middle clicks open a new tab; clicks on a nested
 * interactive element, and clicks that end a text selection, are left alone.
 *
 * `navigate` is a parameter because jsdom forbids stubbing `window.location`, so the
 * tests pass their own.
 */
export function initRowLink(
  api: NestProfilerApi,
  navigate: (href: string) => void = (href) => window.location.assign(href),
): void {
  const open = (row: HTMLElement, event: MouseEvent | KeyboardEvent): void => {
    const href = row.getAttribute('data-row-href') ?? '';
    if (!isSafeRowHref(href)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(INTERACTIVE)) return;
    // A click ending a drag-selection is the user copying a cell, not opening the row.
    if (event instanceof MouseEvent && window.getSelection()?.toString()) return;
    if (event.metaKey || event.ctrlKey || (event instanceof MouseEvent && event.button === 1)) {
      window.open(href, '_blank', 'noopener');
    } else {
      navigate(href);
    }
  };

  api.delegate('click', '[data-row-href]', open);
  // Middle clicks never fire `click` — `auxclick` is where they land.
  api.delegate('auxclick', '[data-row-href]', (row, event) => {
    if (event.button === 1) open(row, event);
  });
  api.delegate('keydown', '[data-row-href]', (row, event) => {
    if (event.key === 'Enter') open(row, event);
  });
}
