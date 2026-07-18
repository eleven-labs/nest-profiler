import type { NestProfilerApi } from '../runtime';

/**
 * Deep-link target for a database query: when the URL carries `?q=<index>` (set by the Timeline
 * waterfall's "Open in Database panel" link), scroll to that query's row in the active panel and
 * flash it. The matching sub-tab is already selected server-side via `?subtab=`.
 */
export function initQueryHighlight(api: NestProfilerApi): void {
  api.onReady(() => {
    const index = new URLSearchParams(window.location.search).get('q');
    if (index === null) return;
    const rows = document.querySelectorAll<HTMLElement>(`[data-query-row="${CSS.escape(index)}"]`);
    // Prefer a row in a visible panel (grouped panels keep inactive sub-panels in the DOM but hidden).
    const row = Array.from(rows).find((el) => el.offsetParent !== null) ?? rows[0];
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // A persistent tint + accent marks the deep-linked query; the flash draws the eye on arrival.
    row.classList.add('query-target', 'query-flash');
    row.addEventListener('animationend', () => row.classList.remove('query-flash'), { once: true });
  });
}
