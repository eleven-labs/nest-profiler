import * as path from 'path';
import type {
  EntrypointSummary,
  Profile,
  ProfilerEntrypointType,
  ProfilerListFilter,
} from '@eleven-labs/nest-profiler';
import { COMMAND_ENTRYPOINT_TYPE } from './commander-collector.interface';
import type { CommandInfo } from './commander-collector.interface';

const TEMPLATES_DIR = path.join(__dirname, 'templates');

const COMMAND_ICON =
  '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z"/></svg>';

/** Command-only filter: narrows the Commands list to successful or failed runs. */
const commandStatusFilter: ProfilerListFilter<string> = {
  key: 'commandStatus',
  label: 'Status',
  control: 'select',
  order: 20,
  options: [
    { value: '', label: 'All' },
    { value: 'success', label: 'Success' },
    { value: 'failed', label: 'Failed' },
  ],
  parse: (raw) => (typeof raw === 'string' && raw.length > 0 ? raw : undefined),
  matches: (profile: Profile<CommandInfo>, value) =>
    value === 'success' ? profile.entrypoint.data.success : !profile.entrypoint.data.success,
};

/**
 * The `command` entrypoint: CLI commands profiled via nest-commander render in
 * their own list table and on a dedicated "Command" detail tab (no
 * request/response tabs). Registered by {@link CommanderCollectorModule}.
 */
export const COMMAND_ENTRYPOINT_TYPE_DEF: ProfilerEntrypointType = {
  type: COMMAND_ENTRYPOINT_TYPE,
  label: 'Command',
  listSection: {
    title: 'Commands',
    description: 'CLI commands profiled via nest-commander',
    order: 20,
    itemLabel: 'command',
    templatePath: path.join(TEMPLATES_DIR, 'commands-section.ejs'),
  },
  detailTabs: [
    {
      name: 'command',
      label: 'Command',
      icon: COMMAND_ICON,
      templatePath: path.join(TEMPLATES_DIR, 'command.ejs'),
    },
  ],
  listFilters: [commandStatusFilter],
  summary(profile: Profile<CommandInfo>): EntrypointSummary {
    const cmd = profile.entrypoint.data;
    const args = cmd.arguments.length ? ` ${cmd.arguments.join(' ')}` : '';
    return { badge: 'CLI', badgeClass: 'badge-default', text: `${cmd.name}${args}` };
  },
};
