import type { Profile } from '../interfaces/profile.interface';

export interface IProfilerCollector {
  readonly name: string;
  readonly label?: string;
  readonly icon?: string;
  readonly priority?: number;
  /**
   * `'profile'` (default) — runs once per profile and attaches to whatever
   * entrypoint is active (HTTP request, CLI command, consumed message…) via the
   * CLS-stored profile, so collectors like DB, cache and HTTP-client work the
   * same across every entrypoint kind. `'global'` — runs once for the list page
   * (process-level data, e.g. configuration).
   */
  readonly scope?: 'profile' | 'global';
  readonly group?: string;
  readonly groupLabel?: string;
  readonly groupIcon?: string;
  readonly groupPriority?: number;
  getBadgeValue?(profile: Profile): string | number | null;
  getTemplatePath?(): string | undefined;
  collect(profile: Profile): unknown;
}
