import * as path from 'path';
import { HTTP_ENTRYPOINT_TYPE_DEF, buildHttpEntrypointType } from '@eleven-labs/nest-profiler';
import type {
  EntrypointSummary,
  HttpRequestData,
  Profile,
  ProfilerEntrypointType,
  ProfilerErrorOptions,
  ProfilerListFilter,
} from '@eleven-labs/nest-profiler';
import { AI_ICON } from './icons';
import { isAiCall } from './ai-call.interface';
import type { AiCollectorData } from './ai-call.interface';

/** `Profile.entrypoint.type` value for a request that called a language model. */
export const AI_ENTRYPOINT_TYPE = 'ai';

/** The AI list is narrowed by model, the one facet that changes what a row costs. */
const modelFilter: ProfilerListFilter<string> = {
  key: 'aiModel',
  label: 'Model',
  control: 'select',
  order: 20,
  distinctField: 'attributes.aiModel',
  options: [{ value: '', label: 'All' }],
  parse: (raw) => (typeof raw === 'string' && raw.length > 0 ? raw : undefined),
  toCriterion: (value) => ({ field: 'attributes.aiModel', op: 'eq', value }),
};

/**
 * The AI list is also narrowed by agent, once an application runs more than one: a support agent
 * and a summarizer share a model and an endpoint, and nothing else tells their profiles apart.
 * The option list is filled from what has actually been recorded, so it stays empty — and the
 * control hidden — for an application that runs no agent at all.
 */
const agentFilter: ProfilerListFilter<string> = {
  key: 'aiAgent',
  label: 'Agent',
  control: 'select',
  order: 21,
  distinctField: 'attributes.aiAgent',
  options: [{ value: '', label: 'All' }],
  parse: (raw) => (typeof raw === 'string' && raw.length > 0 ? raw : undefined),
  toCriterion: (value) => ({ field: 'attributes.aiAgent', op: 'eq', value }),
};

/** How an agent is named in the list and its filter: its name, else its id, else its framework. */
const agentLabelOf = (data: AiCollectorData): string | undefined => {
  for (const entry of data.entries) {
    const label = entry.agent?.name ?? entry.agent?.id ?? entry.agent?.framework;
    if (label !== undefined) return label;
  }
  return undefined;
};

const emptyData: AiCollectorData = {
  entries: [],
  callCount: 0,
  toolCount: 0,
  totalTokens: 0,
  totalCost: 0,
  costKnown: false,
  costEstimated: false,
  totalDuration: 0,
  toolDuration: 0,
};

const aiDataOf = (profile: Profile): AiCollectorData =>
  (profile.collectors['ai'] as AiCollectorData | undefined) ?? emptyData;

/**
 * The `ai` entrypoint: a request that called a language model gets its own list table, with the
 * figures an HTTP row has no room for — the models it used, the tokens it burned and what it cost.
 *
 * It keeps the HTTP detail tabs: the request is still an HTTP request, and for a streamed answer
 * the Response tab is where the delivery is described. The AI panel itself stays a collector tab.
 */
export function buildAiEntrypointType(error?: ProfilerErrorOptions): ProfilerEntrypointType {
  const http = buildHttpEntrypointType(error);
  const templatePath = path.join(__dirname, 'templates', 'ai-section.ejs');

  return {
    type: AI_ENTRYPOINT_TYPE,
    label: 'AI',
    // Wrapped rather than passed by reference, so the HTTP classifier keeps its own `this`.
    isError: (profile) => http.isError?.(profile) === true,
    errorSeverity: http.errorSeverity,
    listSection: {
      title: 'AI',
      icon: AI_ICON,
      description: 'Requests that called a language model',
      // Between the built-in HTTP section (10) and the commander section (20).
      order: 16,
      itemLabel: 'generation',
      templatePath,
    },
    detailTabs: HTTP_ENTRYPOINT_TYPE_DEF.detailTabs,
    listFilters: [modelFilter, agentFilter],
    indexAttributes: (profile: Profile) => {
      const data = aiDataOf(profile);
      const models = [...new Set(data.entries.filter(isAiCall).map((call) => call.model))];
      const agent = agentLabelOf(data);
      return {
        // Left out rather than defaulted when no agent ran: the filter's options are the distinct
        // values of this attribute, and a placeholder would become an option nobody can act on.
        ...(agent !== undefined && { aiAgent: agent }),
        aiModel: models[0] ?? 'unknown',
        aiCalls: data.callCount,
        aiTools: data.toolCount,
        aiTokens: data.totalTokens,
        aiCost: data.totalCost,
      };
    },
    summary(profile: Profile<HttpRequestData>): EntrypointSummary {
      const data = aiDataOf(profile);
      const models = [...new Set(data.entries.filter(isAiCall).map((c) => c.model))];
      const agent = agentLabelOf(data);
      const parts = [...(agent !== undefined ? [`@${agent}`] : []), ...models];
      return {
        badge: 'AI',
        badgeClass: 'badge-tag-info',
        text:
          parts.length > 0
            ? `${parts.join(', ')} · ${profile.entrypoint.data.url}`
            : profile.entrypoint.data.url,
      };
    },
  };
}
