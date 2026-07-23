import type { NestProfilerApi } from '../runtime';

/**
 * Wires the SQL panel's `[data-explain]` buttons: on first click it fetches the query's
 * execution plan from the profiler's `explain` route and injects the returned HTML fragment
 * into the sibling `[data-explain-target]`; subsequent clicks toggle it. The EXPLAIN runs
 * on the server on demand — nothing runs until the user asks for a specific query's plan.
 * Credentials ride along automatically (cookies via `same-origin`; token/query auth is
 * baked into the button URL by the server's `link()` helper).
 */
export function initExplain(api: NestProfilerApi): void {
  api.delegate('click', '[data-explain]', (button) => {
    const url = button.getAttribute('data-explain');
    const target = button.parentElement?.querySelector<HTMLElement>('[data-explain-target]');
    if (!url || !target) return;

    if (target.dataset.loaded === '1') {
      target.classList.toggle('hidden');
      return;
    }
    if (target.dataset.loading === '1') return;

    target.dataset.loading = '1';
    target.classList.remove('hidden');
    target.textContent = 'Running EXPLAIN…';

    void fetch(url, { headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((html) => {
        target.innerHTML = html;
        target.dataset.loaded = '1';
        api.highlight(target);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        target.textContent = `Failed to load plan: ${message}`;
      })
      .finally(() => {
        delete target.dataset.loading;
      });
  });

  // Deep link: opening a detail page with `#explain` auto-expands the first query's plan (the
  // delegate above is already wired, so the synthetic click runs it). Makes a query's plan
  // linkable/shareable, and lets the docs screenshot capture it without interaction — headless
  // Chrome awaits the fetch under `--virtual-time-budget`.
  if (window.location.hash === '#explain') {
    document.querySelector<HTMLElement>('[data-explain]')?.click();
  }
}
