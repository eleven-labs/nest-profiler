import { sectionTypeConstraint, sortSections } from './list-section.utils';
import type { ProfilerListSection } from './profiler-list-section.interface';

const requests: ProfilerListSection = {
  key: 'http',
  title: 'HTTP',
  order: 10,
  isDefault: true,
  templatePath: '/tmp/requests.ejs',
};

const graphql: ProfilerListSection = {
  key: 'graphql',
  title: 'GraphQL',
  order: 15,
  templatePath: '/tmp/graphql.ejs',
};

const commands: ProfilerListSection = {
  key: 'commands',
  title: 'Commands',
  order: 20,
  itemLabel: 'command',
  templatePath: '/tmp/commands.ejs',
};

describe('sortSections', () => {
  it('orders sections by ascending display order', () => {
    expect(sortSections([commands, requests, graphql]).map((s) => s.key)).toEqual([
      'http',
      'graphql',
      'commands',
    ]);
  });

  it('falls back to the default order (100) for sections that omit it', () => {
    const { order: _omitted, ...unordered } = commands; // no order → DEFAULT_SECTION_ORDER
    const late: ProfilerListSection = { ...graphql, order: 200 };
    expect(sortSections([late, unordered, requests]).map((s) => s.key)).toEqual([
      'http',
      'commands',
      'graphql',
    ]);
  });
});

describe('sectionTypeConstraint', () => {
  const sections = [requests, graphql, commands];

  it('scopes a non-default section to its own type via typeIn', () => {
    expect(sectionTypeConstraint(graphql, sections)).toEqual({ typeIn: ['graphql'] });
  });

  it('honours an explicit types list on a non-default section', () => {
    const multi: ProfilerListSection = { ...graphql, types: ['graphql', 'graphql-ws'] };
    expect(sectionTypeConstraint(multi, [requests, multi, commands])).toEqual({
      typeIn: ['graphql', 'graphql-ws'],
    });
  });

  it('scopes the default section to every unclaimed type via typeNotIn', () => {
    expect(sectionTypeConstraint(requests, sections)).toEqual({
      typeNotIn: ['graphql', 'commands'],
    });
  });
});
