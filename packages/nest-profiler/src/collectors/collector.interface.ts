import type { Profile } from '../interfaces/profile.interface';

export interface IProfilerCollector {
  readonly name: string;
  readonly label?: string;
  readonly icon?: string;
  readonly priority?: number;
  /** 'request' (default) — shown per profile. 'global' — shown once on the list page. */
  readonly scope?: 'request' | 'global';
  readonly group?: string;
  readonly groupLabel?: string;
  readonly groupIcon?: string;
  readonly groupPriority?: number;
  getBadgeValue?(profile: Profile): string | number | null;
  getTemplatePath?(): string | undefined;
  collect(profile: Profile): unknown;
}
