import { RuntimeCollector } from './runtime.collector';
import { RuntimeMetricsService } from './runtime-metrics.service';
import type { ProfilerModuleOptions } from '../nest-profiler.builder';
import type { Profile } from '../interfaces/profile.interface';

const emptyProfile = {
  token: '',
  traceId: 'trace-test',
  createdAt: 0,
  entrypoint: { type: 'http', data: {} },
  performance: { startTime: 0, heapUsed: 0 },
  logs: [],
  exceptions: [],
  collectors: {},
} as Profile;

function build(options: ProfilerModuleOptions = {}): {
  collector: RuntimeCollector;
  metrics: RuntimeMetricsService;
} {
  const metrics = new RuntimeMetricsService(options);
  return { collector: new RuntimeCollector(metrics), metrics };
}

describe('RuntimeCollector', () => {
  it('is a global collector — it describes the process, not one execution', () => {
    const { collector } = build();
    expect(collector.scope).toBe('global');
    expect(collector.name).toBe('runtime');
  });

  it('collects the service snapshot', () => {
    const { collector, metrics } = build({ runtime: { interval: 250 } });
    metrics.onModuleInit();

    const data = collector.collect(emptyProfile);
    expect(data.enabled).toBe(true);
    expect(data.current).toBeDefined();
    expect(data.process.pid).toBe(process.pid);

    metrics.onApplicationShutdown();
  });

  it('renders one view, with no count badge — the panel counts nothing', () => {
    const { collector, metrics } = build({ runtime: { interval: 250 } });
    metrics.onModuleInit();

    const panels = collector.expandGlobalPanels(collector.collect(emptyProfile));
    expect(panels).toHaveLength(1);
    expect(panels[0]).toMatchObject({ name: 'runtime', label: 'Runtime' });
    expect(panels[0]!.badge).toBeUndefined();
    expect(panels[0]!.templatePath).toContain('runtime-panel.ejs');

    metrics.onApplicationShutdown();
  });

  it('hides the view entirely when runtime metrics are off', () => {
    // Rather than offering a panel whose only content is that it has nothing to show.
    const { collector } = build({ runtime: false });
    expect(collector.expandGlobalPanels(collector.collect(emptyProfile))).toEqual([]);
  });
});
