import { ModuleRef } from '@nestjs/core';
import type { Profile, ProfilerRouteSource, RouteGroup } from '@eleven-labs/nest-profiler';
import { RoutesCollector } from './routes.collector';

const EMPTY_PROFILE = {} as Profile;

function makeCollector(sources: ProfilerRouteSource[] | null): RoutesCollector {
  const moduleRef = {
    get: jest.fn(() => {
      if (sources === null) throw new Error('ProfilerCoreService not found');
      return { getRouteSources: () => sources };
    }),
  } as unknown as ModuleRef;
  return new RoutesCollector(moduleRef);
}

function source(type: string, groups: RouteGroup | RouteGroup[]): ProfilerRouteSource {
  return { type, collect: () => groups };
}

const healthRoute = {
  method: 'GET',
  path: '/health',
  controller: 'HealthController',
  handler: 'check',
};
const httpGroup: RouteGroup = { source: 'http', label: 'REST', routes: [healthRoute] };

describe('RoutesCollector', () => {
  it('is a global-scope panel exposing a template', () => {
    const collector = makeCollector([]);
    expect(collector.scope).toBe('global');
    expect(collector.name).toBe('routes');
    expect(collector.getTemplatePath()).toMatch(/routes-panel\.ejs$/);
  });

  it('aggregates route groups from every registered source with a total count', () => {
    const gqlGroup: RouteGroup = {
      source: 'graphql',
      label: 'GraphQL',
      routes: [
        { method: 'query', path: 'users', controller: 'UserResolver', handler: 'users' },
        { method: 'mutation', path: 'createUser', controller: 'UserResolver', handler: 'create' },
      ],
    };
    const collector = makeCollector([source('http', httpGroup), source('graphql', gqlGroup)]);

    const data = collector.collect(EMPTY_PROFILE);
    expect(data.groups).toEqual([httpGroup, gqlGroup]);
    expect(data.routeCount).toBe(3);
  });

  it('flattens a source that returns multiple groups', () => {
    const a: RouteGroup = { source: 'a', label: 'A', routes: [healthRoute] };
    const b: RouteGroup = { source: 'b', label: 'B', routes: [healthRoute] };
    const collector = makeCollector([source('multi', [a, b])]);
    expect(collector.collect(EMPTY_PROFILE).groups).toEqual([a, b]);
  });

  it('skips empty groups and sources that throw', () => {
    const empty: RouteGroup = { source: 'empty', label: 'Empty', routes: [] };
    const throwing: ProfilerRouteSource = {
      type: 'boom',
      collect: () => {
        throw new Error('nope');
      },
    };
    const collector = makeCollector([source('empty', empty), throwing, source('http', httpGroup)]);

    const data = collector.collect(EMPTY_PROFILE);
    expect(data.groups).toEqual([httpGroup]);
    expect(data.routeCount).toBe(1);
  });

  it('returns an empty panel when the core is unavailable', () => {
    const collector = makeCollector(null);
    expect(collector.collect(EMPTY_PROFILE)).toEqual({ groups: [], routeCount: 0 });
  });

  it('resolves the core once and memoizes it across collect() calls', () => {
    const get = jest.fn(() => ({ getRouteSources: () => [source('http', httpGroup)] }));
    const collector = new RoutesCollector({ get } as unknown as ModuleRef);

    collector.collect(EMPTY_PROFILE);
    collector.collect(EMPTY_PROFILE);

    expect(get).toHaveBeenCalledTimes(1);
  });
});
