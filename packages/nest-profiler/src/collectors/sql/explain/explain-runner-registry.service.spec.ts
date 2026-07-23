import { ExplainRunnerRegistry } from './explain-runner-registry.service';
import type { ExplainRawResult, ExplainRunner } from './explain.interface';

function makeRunner(collectorName: string): ExplainRunner {
  return {
    collectorName,
    explain: (): Promise<ExplainRawResult> =>
      Promise.resolve({ dialect: 'postgres', analyzed: false, raw: [] }),
  };
}

describe('ExplainRunnerRegistry', () => {
  it('registers and looks up runners by collector name', () => {
    const registry = new ExplainRunnerRegistry();
    const runner = makeRunner('typeorm');
    registry.register(runner);
    expect(registry.get('typeorm')).toBe(runner);
    expect(registry.get('mikro-orm')).toBeUndefined();
  });

  it('lists the names of registered runners', () => {
    const registry = new ExplainRunnerRegistry();
    registry.register(makeRunner('typeorm'));
    registry.register(makeRunner('mikro-orm'));
    expect(registry.names().sort()).toEqual(['mikro-orm', 'typeorm']);
  });

  it('last registration for a name wins', () => {
    const registry = new ExplainRunnerRegistry();
    const first = makeRunner('typeorm');
    const second = makeRunner('typeorm');
    registry.register(first);
    registry.register(second);
    expect(registry.get('typeorm')).toBe(second);
    expect(registry.names()).toEqual(['typeorm']);
  });
});
