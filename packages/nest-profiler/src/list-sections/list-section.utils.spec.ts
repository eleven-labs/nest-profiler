import { bucketProfilesBySection } from './list-section.utils';
import type { ProfilerListSection } from './profiler-list-section.interface';
import type { HttpRequestData, Profile } from '../interfaces/profile.interface';

function makeProfile(method: string): Profile {
  return {
    token: Math.random().toString(36).slice(2),
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method, url: '/', headers: {}, query: {} } },
    performance: { startTime: 0, heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

const requests: ProfilerListSection = {
  key: 'requests',
  title: 'HTTP & GraphQL',
  order: 10,
  isDefault: true,
  templatePath: '/tmp/requests.ejs',
  matches: () => false,
};

const commands: ProfilerListSection = {
  key: 'commands',
  title: 'Commands',
  order: 20,
  itemLabel: 'command',
  templatePath: '/tmp/commands.ejs',
  matches: (p) => (p.entrypoint.data as HttpRequestData).method === 'CLI',
};

const messages: ProfilerListSection = {
  key: 'messages',
  title: 'Messages',
  order: 30,
  itemLabel: 'message',
  templatePath: '/tmp/messages.ejs',
  matches: (p) => (p.entrypoint.data as HttpRequestData).method === 'MSG',
};

describe('bucketProfilesBySection', () => {
  it('routes each profile to the first matching non-default section, else the default', () => {
    const http = makeProfile('GET');
    const cli = makeProfile('CLI');
    const msg = makeProfile('MSG');

    const buckets = bucketProfilesBySection([requests, commands, messages], [http, cli, msg]);
    const byKey = Object.fromEntries(buckets.map((b) => [b.key, b.profiles]));

    expect(byKey.requests).toEqual([http]);
    expect(byKey.commands).toEqual([cli]);
    expect(byKey.messages).toEqual([msg]);
  });

  it('returns buckets ordered by ascending section order', () => {
    const buckets = bucketProfilesBySection([messages, requests, commands], []);
    expect(buckets.map((b) => b.key)).toEqual(['requests', 'commands', 'messages']);
  });

  it('falls back to the default order for sections that omit it', () => {
    const { order: _omitted, ...unordered } = commands;
    // `unordered` (no explicit order → DEFAULT_SECTION_ORDER = 100) sorts after
    // `requests` (order 10) but before a section with an order above the default.
    const late: ProfilerListSection = { ...messages, order: 200 };
    const buckets = bucketProfilesBySection([late, unordered, requests], []);
    expect(buckets.map((b) => b.key)).toEqual(['requests', 'commands', 'messages']);
  });

  it('defaults itemLabel to "profile" and exposes isDefault', () => {
    const buckets = bucketProfilesBySection([requests, commands], []);
    const byKey = Object.fromEntries(buckets.map((b) => [b.key, b]));
    expect(byKey.requests?.itemLabel).toBe('profile');
    expect(byKey.requests?.isDefault).toBe(true);
    expect(byKey.commands?.itemLabel).toBe('command');
    expect(byKey.commands?.isDefault).toBe(false);
  });

  it('defaults defaultCollapsed to false and carries it when set', () => {
    const folded: ProfilerListSection = { ...messages, defaultCollapsed: true };
    const buckets = bucketProfilesBySection([requests, folded], []);
    const byKey = Object.fromEntries(buckets.map((b) => [b.key, b]));

    // Unset → falls back to false (the section renders expanded).
    expect(byKey.requests?.defaultCollapsed).toBe(false);
    // Opted in → propagates to the bucket (the section renders folded).
    expect(byKey.messages?.defaultCollapsed).toBe(true);
  });

  it('drops unmatched profiles when no default section is registered', () => {
    const http = makeProfile('GET');
    const cli = makeProfile('CLI');
    const buckets = bucketProfilesBySection([commands], [http, cli]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.profiles).toEqual([cli]);
  });

  it('gives a matching profile to the higher-priority (lower-order) section', () => {
    const greedy: ProfilerListSection = {
      key: 'greedy',
      title: 'Greedy',
      order: 5,
      templatePath: '/tmp/greedy.ejs',
      matches: () => true,
    };
    const msg = makeProfile('MSG');
    const buckets = bucketProfilesBySection([greedy, messages, requests], [msg]);
    const byKey = Object.fromEntries(buckets.map((b) => [b.key, b.profiles]));
    expect(byKey.greedy).toEqual([msg]);
    expect(byKey.messages).toEqual([]);
  });
});
