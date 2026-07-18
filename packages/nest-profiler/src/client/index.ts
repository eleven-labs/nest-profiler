// Entry point for the core profiler client bundle (dist/public/scripts/profiler.js).
// Loaded as a blocking <script> in <head> so the theme boot runs before first paint.
import { initCopy } from './behaviors/copy';
import { initFilters } from './behaviors/filters';
import { initGroupTabs } from './behaviors/group-tabs';
import { initQueryHighlight } from './behaviors/query-highlight';
import { initTraceWaterfall } from './behaviors/trace-waterfall';
import { bootTheme, initTheme } from './behaviors/theme';
import { createRuntime } from './runtime';

const api = createRuntime();
window.NestProfiler = api;

// Before-paint work: apply the persisted theme immediately.
bootTheme();

// DOM wiring: highlight code and attach delegated behaviours once the DOM is ready.
api.onReady(() => {
  api.highlight();
  initTheme(api);
  initCopy(api);
  initFilters(api);
  initGroupTabs(api);
  initTraceWaterfall(api);
  initQueryHighlight(api);
});
