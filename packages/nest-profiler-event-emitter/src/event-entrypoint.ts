import * as path from 'path';
import { resolveErrorSeverity, resolveProfileErrorClassifier } from '@eleven-labs/nest-profiler';
import type {
  EntrypointSummary,
  Profile,
  ProfilerEntrypointType,
  ProfilerErrorOptions,
  ProfilerListFilter,
  SummaryPrimitive,
} from '@eleven-labs/nest-profiler';
import { EVENT_ICON } from './event-emitter-collector.interface';

const TEMPLATES_DIR = path.join(__dirname, 'templates');

/** `Profile.entrypoint.type` value marking a profile as one `@OnEvent` handler execution. */
export const EVENT_ENTRYPOINT_TYPE = 'event';

/** Entrypoint payload for one profiled event-listener execution. */
export interface EventEntrypointData {
  /** The event that triggered the handler. */
  event: string;
  /** The provider class holding the handler. */
  provider: string;
  /** The handler method name. */
  method: string;
  /** The (redacted) payload the handler received. */
  payload?: unknown;
  /** `false` when the handler threw. */
  success: boolean;
}

/** Event-only filter: narrows the Events list to successful or failed handler executions. */
const eventStatusFilter: ProfilerListFilter<boolean> = {
  key: 'eventStatus',
  label: 'Status',
  control: 'select',
  order: 20,
  forType: EVENT_ENTRYPOINT_TYPE,
  options: [
    { value: '', label: 'All' },
    { value: 'success', label: 'Success' },
    { value: 'failed', label: 'Failed' },
  ],
  parse: (raw) => (raw === 'success' ? true : raw === 'failed' ? false : undefined),
  toCriterion: (value) => ({ field: 'attributes.success', op: 'eq', value }),
};

/** Event-only filter: narrows the list to one event name (options are the events seen). */
const eventNameFilter: ProfilerListFilter<string> = {
  key: 'eventName',
  label: 'Event',
  control: 'select',
  order: 21,
  forType: EVENT_ENTRYPOINT_TYPE,
  distinctField: 'attributes.event',
  parse: (raw) => (typeof raw === 'string' && raw.length > 0 ? raw : undefined),
  toCriterion: (value) => ({ field: 'attributes.event', op: 'eq', value }),
};

/**
 * The `event` entrypoint with a host-supplied error classification.
 *
 * A handler execution synthesises a `500` response when it throws, but the status layer is
 * **off by default** for this kind: the verdict rests on the captured exception, so
 * `error: { exceptions: ['TimeoutError'] }` narrows it to the failures that matter when a
 * handler throws routinely as flow control. The `error` tag and its severity follow.
 *
 * @param error - What counts as a failed handler, from `EventEmitterCollectorModuleOptions.error`.
 */
export function buildEventEntrypointType(error?: ProfilerErrorOptions): ProfilerEntrypointType {
  return {
    type: EVENT_ENTRYPOINT_TYPE,
    label: 'Event',
    // The synthesised status only mirrors `success`, so it would drown out an `exceptions`
    // override — the GraphQL kind disables the layer for the same reason.
    isError: resolveProfileErrorClassifier(error, { httpStatus: false }),
    errorSeverity: resolveErrorSeverity(error),
    // The generic `error` tag filter is redundant with the Status filter below.
    hiddenFilters: ['error'],
    listSection: {
      title: 'Events',
      description: 'Event-listener executions profiled via @nestjs/event-emitter',
      order: 30,
      itemLabel: 'event',
      templatePath: path.join(TEMPLATES_DIR, 'events-section.ejs'),
    },
    detailTabs: [
      {
        name: 'event',
        label: 'Event',
        icon: EVENT_ICON,
        templatePath: path.join(TEMPLATES_DIR, 'event-detail.ejs'),
      },
    ],
    listFilters: [eventStatusFilter, eventNameFilter],
    indexAttributes: (profile: Profile<EventEntrypointData>): Record<string, SummaryPrimitive> => {
      const data = profile.entrypoint.data;
      return { success: data.success === true, event: data.event };
    },
    summary(profile: Profile<EventEntrypointData>): EntrypointSummary {
      const data = profile.entrypoint.data;
      return {
        badge: 'EVENT',
        badgeClass: 'badge-default',
        text: `${data.event} → ${data.provider}.${data.method}()`,
      };
    },
  };
}

/**
 * Listener executions as a first-class profiler entrypoint, alongside `http` and `command`.
 * Registered by {@link EventProfilerService} via `core.registerEntrypointType`.
 *
 * Carries the default error classification; {@link EventProfilerService} registers a configured
 * one via {@link buildEventEntrypointType}.
 */
export const EVENT_ENTRYPOINT_TYPE_DEF: ProfilerEntrypointType = buildEventEntrypointType();
