import { DiscoveryModule } from '@nestjs/core';
import { CommanderCollectorModule } from './commander-collector.module';
import { CommandProfiler } from './command-profiler.service';
import { CommandProfilerExplorer } from './command-profiler.explorer';

describe('CommanderCollectorModule.forRoot', () => {
  it('registers a bare module when disabled', () => {
    const mod = CommanderCollectorModule.forRoot({ enabled: false });
    expect(mod).toEqual({ module: CommanderCollectorModule });
  });

  it('registers the providers and DiscoveryModule by default', () => {
    const mod = CommanderCollectorModule.forRoot();

    expect(mod.imports).toContain(DiscoveryModule);
    expect(mod.providers).toEqual(
      expect.arrayContaining([CommandProfiler, CommandProfilerExplorer]),
    );
  });
});
