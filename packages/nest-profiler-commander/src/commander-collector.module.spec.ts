import { DiscoveryModule } from '@nestjs/core';
import { CommanderCollectorModule } from './commander-collector.module';
import { CommandProfiler } from './command-profiler.service';
import { CommandProfilerExplorer } from './command-profiler.explorer';
import { COMMANDER_COLLECTOR_OPTIONS } from './commander-collector.interface';

describe('CommanderCollectorModule.forRoot', () => {
  it('registers a bare module when disabled', () => {
    const mod = CommanderCollectorModule.forRoot({ enabled: false });
    expect(mod).toEqual({ module: CommanderCollectorModule });
  });

  it('registers the providers and DiscoveryModule by default', () => {
    const mod = CommanderCollectorModule.forRoot();

    expect(mod.imports).toContain(DiscoveryModule);
    expect(mod.providers).toContainEqual({
      provide: COMMANDER_COLLECTOR_OPTIONS,
      useValue: {},
    });
    expect(mod.providers).toEqual(
      expect.arrayContaining([CommandProfiler, CommandProfilerExplorer]),
    );
  });

  it('passes the options through the DI token', () => {
    const mod = CommanderCollectorModule.forRoot({ enabled: true });
    expect(mod.providers).toContainEqual({
      provide: COMMANDER_COLLECTOR_OPTIONS,
      useValue: { enabled: true },
    });
  });
});
