import * as ejs from 'ejs';
import { RuntimeCollector } from './runtime.collector';
import { RuntimeMetricsService } from './runtime-metrics.service';
import { HELPERS } from '../views/template-engine';
import type { RuntimeCollectorData } from './runtime-metrics.interface';

/**
 * Renders the panel the way the dashboard does — the locals `list.ejs` passes to a global panel,
 * on top of the shared helpers. An EJS template only fails at render time, so this is the test
 * that catches a typo'd local or a field the data does not actually carry.
 */
function render(data: RuntimeCollectorData): Promise<string> {
  const collector = new RuntimeCollector({} as RuntimeMetricsService);
  return ejs.renderFile(collector.getTemplatePath(), { ...HELPERS, data });
}

describe('runtime panel template', () => {
  it('renders a sampled snapshot with its trends', async () => {
    const metrics = new RuntimeMetricsService({ runtime: { interval: 250 } });
    metrics.onModuleInit();
    // Two samples, so the trend section renders rather than the collecting state.
    const first = metrics.snapshot();
    const data: RuntimeCollectorData = {
      ...first,
      history: [...first.history, { ...first.history[0]!, at: first.history[0]!.at + 250 }],
    };
    data.current = data.history[1];
    metrics.onApplicationShutdown();

    const html = await render(data);

    expect(html).toContain('Heap used');
    expect(html).toContain('Loop lag p99');
    expect(html).toContain('Trends');
    expect(html).toContain('Garbage collection');
    expect(html).toContain('V8 heap spaces');
    expect(html).toContain(String(process.pid));
  });

  it('renders the collecting state before there is a trend to draw', async () => {
    const metrics = new RuntimeMetricsService({ runtime: { interval: 250 } });
    metrics.onModuleInit();
    const data = metrics.snapshot();
    metrics.onApplicationShutdown();

    expect(data.history).toHaveLength(1);
    const html = await render(data);

    expect(html).toContain('Collecting the first samples');
    // The trend grid is absent — its series labels are what to assert on, since the collecting
    // state's own copy mentions trends too.
    expect(html).not.toContain('Resident set');
    expect(html).not.toContain('CPU (% of a core)');
  });

  it('renders with no sample at all rather than throwing', async () => {
    // What the panel would be handed if it were rendered before the sampler had run.
    const metrics = new RuntimeMetricsService({ runtime: false });
    const html = await render(metrics.snapshot());

    expect(html).toContain('Collecting the first samples');
    expect(html).toContain('V8 heap spaces');
  });

  it('states that the figures are process-wide, not per request', async () => {
    const metrics = new RuntimeMetricsService({ runtime: { interval: 250 } });
    metrics.onModuleInit();
    const html = await render(metrics.snapshot());
    metrics.onApplicationShutdown();

    expect(html).toContain('not attributable to any');
  });
});
