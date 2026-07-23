import { Injectable } from '@nestjs/common';
import type { ExplainRunner } from './explain.interface';

/**
 * Process-wide registry of {@link ExplainRunner}s, one per SQL collector that has EXPLAIN
 * enabled. The ORM collector packages register their runner here on init; the profiler
 * controller looks one up by collector name when a user requests a query's plan, and the
 * SQL panel shows the "Explain" action only for collectors that appear in {@link names}.
 */
@Injectable()
export class ExplainRunnerRegistry {
  private readonly runners = new Map<string, ExplainRunner>();

  register(runner: ExplainRunner): void {
    this.runners.set(runner.collectorName, runner);
  }

  get(collectorName: string): ExplainRunner | undefined {
    return this.runners.get(collectorName);
  }

  /** Collector names with a registered runner — the ones whose queries can be explained. */
  names(): string[] {
    return [...this.runners.keys()];
  }
}
