// Browser behaviour for the HTTP Client panel, bundled into dist/public/scripts/http.js
// and registered with the core so it loads after profiler.js. It consumes the shared
// `window.NestProfiler` runtime — the only cross-bundle contract — and never imports
// the core package at runtime.
export {}; // ensure this file is treated as a module (enables `declare global`)

interface NestProfilerApi {
  delegate<E extends keyof DocumentEventMap>(
    event: E,
    selector: string,
    handler: (element: HTMLElement, event: DocumentEventMap[E]) => void,
  ): void;
}

declare global {
  interface Window {
    NestProfiler?: NestProfilerApi;
  }
}

// Expand/collapse a request row: toggle its details row, aria-expanded, and glyph.
function toggleRow(row: HTMLElement): void {
  const detailsId = row.getAttribute('data-details-id');
  if (!detailsId) return;
  const details = document.getElementById(detailsId);
  if (!details) return;
  const open = row.getAttribute('aria-expanded') === 'true';
  details.classList.toggle('hidden', open);
  row.setAttribute('aria-expanded', open ? 'false' : 'true');
  const icon = row.querySelector('[data-http-indicator]');
  if (icon) icon.textContent = open ? '▸' : '▾';
}

const api = window.NestProfiler;
if (api) {
  api.delegate('click', '[data-toggle-details]', (row, event) => {
    // Ignore clicks on nested controls (e.g. the "Copy as cURL" button).
    if (event.target instanceof Element && event.target.closest('button, a')) return;
    toggleRow(row);
  });
  api.delegate('keydown', '[data-toggle-details]', (row, event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleRow(row);
    }
  });
}
