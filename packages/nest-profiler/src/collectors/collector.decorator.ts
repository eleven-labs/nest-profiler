import { DiscoveryService } from '@nestjs/core';
import { markInternal } from '../instrument/internal-marker';

export interface ProfilerCollectorMetadata {
  name: string;
  label?: string;
  icon?: string;
  priority?: number;
  scope?: 'profile' | 'global';
  group?: string;
  groupLabel?: string;
  groupIcon?: string;
  groupPriority?: number;
}

const discoverable = DiscoveryService.createDecorator<ProfilerCollectorMetadata>();

/**
 * Marks a provider as a profiler collector, discovered at startup by `CollectorRegistry`.
 *
 * It also brands the class as a profiler internal, so the optional automatic instrumentation never
 * records the collectors observing the request. Doing it here rather than in each package's module
 * covers every collector at once — including the ones whose module is hand-written rather than
 * built by `buildCollectorModule` — and covers a third-party collector for free.
 */
export const ProfilerCollector = Object.assign(
  (metadata: ProfilerCollectorMetadata): ClassDecorator => {
    const apply = discoverable(metadata);
    return (target) => {
      markInternal([target]);
      return apply(target);
    };
  },
  // `DiscoveryService` finds decorated providers by this key, so the wrapper must carry the exact
  // one the underlying decorator has — otherwise no collector is ever discovered.
  { KEY: discoverable.KEY },
) as typeof discoverable;
