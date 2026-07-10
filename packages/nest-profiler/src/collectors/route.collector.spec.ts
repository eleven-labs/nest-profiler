import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { RouteCollector } from './route.collector';

function makeController(
  controllerPath: string,
  methods: Record<string, { path: string; method: RequestMethod }>,
) {
  class FakeCtrl {}
  Reflect.defineMetadata('path', controllerPath, FakeCtrl);

  for (const [name, meta] of Object.entries(methods)) {
    const fn = function () {};
    Reflect.defineMetadata('path', meta.path, fn);
    Reflect.defineMetadata('method', meta.method, fn);
    (FakeCtrl.prototype as Record<string, unknown>)[name] = fn;
  }

  const instance = new FakeCtrl();
  return { instance, metatype: FakeCtrl, prototype: FakeCtrl.prototype };
}

function buildCollector(controllers: ReturnType<typeof makeController>[]) {
  const discovery = {
    getControllers: () => controllers.map((c) => ({ instance: c.instance, metatype: c.metatype })),
  } as Partial<DiscoveryService> as DiscoveryService;

  const scanner = {
    scanFromPrototype: (_instance: object, prototype: object, cb: (name: string) => void) => {
      for (const name of Object.getOwnPropertyNames(prototype)) {
        if (name !== 'constructor') cb(name);
      }
    },
  } as Partial<MetadataScanner> as MetadataScanner;

  const collector = new RouteCollector(discovery, scanner);
  collector.onApplicationBootstrap();
  return collector;
}

describe('RouteCollector', () => {
  describe('static route matching', () => {
    it('matches a plain static route', () => {
      const ctrl = makeController('', { getHealth: { path: 'health', method: RequestMethod.GET } });
      const collector = buildCollector([ctrl]);
      const result = collector.match('GET', '/health');
      expect(result).toEqual({
        controller: 'FakeCtrl',
        handler: 'getHealth',
        path: '/health',
        method: 'GET',
      });
    });

    it('handles root controller path "/" without double slash', () => {
      const ctrl = makeController('/', {
        getHealth: { path: 'health', method: RequestMethod.GET },
      });
      const collector = buildCollector([ctrl]);
      expect(collector.match('GET', '/health')?.path).toBe('/health');
    });

    it('collapses a leading slash in the method path (no "//") and still matches', () => {
      const ctrl = makeController('', { list: { path: '/_profiler', method: RequestMethod.GET } });
      const collector = buildCollector([ctrl]);
      expect(collector.match('GET', '/_profiler')?.path).toBe('/_profiler');
      // The buggy `//_profiler` key must not be produced.
      expect(collector.match('GET', '//_profiler')).toBeUndefined();
    });

    it('handles nested controller path', () => {
      const ctrl = makeController('api/v1', { list: { path: 'items', method: RequestMethod.GET } });
      const collector = buildCollector([ctrl]);
      expect(collector.match('GET', '/api/v1/items')).toBeDefined();
    });

    it('strips query string before matching', () => {
      const ctrl = makeController('', { list: { path: 'items', method: RequestMethod.GET } });
      const collector = buildCollector([ctrl]);
      expect(collector.match('GET', '/items?page=1')).toBeDefined();
    });

    it('is case-insensitive on the HTTP method', () => {
      const ctrl = makeController('', { ping: { path: 'ping', method: RequestMethod.GET } });
      const collector = buildCollector([ctrl]);
      expect(collector.match('get', '/ping')).toBeDefined();
    });

    it('returns undefined for unknown routes', () => {
      const ctrl = makeController('', { ping: { path: 'ping', method: RequestMethod.GET } });
      const collector = buildCollector([ctrl]);
      expect(collector.match('GET', '/unknown')).toBeUndefined();
    });
  });

  describe('parametric route matching', () => {
    it('matches a route with a single :param', () => {
      const ctrl = makeController('users', { getUser: { path: ':id', method: RequestMethod.GET } });
      const collector = buildCollector([ctrl]);
      const result = collector.match('GET', '/users/42');
      expect(result?.handler).toBe('getUser');
      expect(result?.path).toBe('/users/:id');
    });

    it('matches a route with multiple :params — key contains colons', () => {
      const ctrl = makeController('orgs', {
        getRepo: { path: ':org/repos/:id', method: RequestMethod.GET },
      });
      const collector = buildCollector([ctrl]);
      const result = collector.match('GET', '/orgs/nestjs/repos/99');
      expect(result?.path).toBe('/orgs/:org/repos/:id');
    });

    it('does not match a wrong HTTP method', () => {
      const ctrl = makeController('users', {
        deleteUser: { path: ':id', method: RequestMethod.DELETE },
      });
      const collector = buildCollector([ctrl]);
      expect(collector.match('GET', '/users/42')).toBeUndefined();
    });
  });

  describe('metadata filtering', () => {
    it('ignores prototype methods that lack HTTP method metadata', () => {
      const ctrl = makeController('', { getHealth: { path: 'health', method: RequestMethod.GET } });
      (ctrl.prototype as Record<string, unknown>)['helper'] = function () {};
      const collector = buildCollector([ctrl]);
      expect(collector.match('GET', '/helper')).toBeUndefined();
    });

    it('skips wrappers without an instance or metatype', () => {
      const discovery = {
        getControllers: () => [
          { instance: undefined, metatype: undefined },
          { instance: {}, metatype: undefined },
        ],
      } as unknown as DiscoveryService;
      const scanFromPrototype = jest.fn();
      const scanner = { scanFromPrototype } as unknown as MetadataScanner;
      const collector = new RouteCollector(discovery, scanner);
      collector.onApplicationBootstrap();
      expect(collector.match('GET', '/anything')).toBeUndefined();
      expect(scanFromPrototype).not.toHaveBeenCalled();
    });

    it('defaults missing controller and method paths to the root route', () => {
      class RootCtrl {}
      const fn = function () {};
      Reflect.defineMetadata('method', RequestMethod.GET, fn);
      // No 'path' metadata on the class or the method.
      (RootCtrl.prototype as Record<string, unknown>)['index'] = fn;

      const discovery = {
        getControllers: () => [{ instance: new RootCtrl(), metatype: RootCtrl }],
      } as unknown as DiscoveryService;
      const scanner = {
        scanFromPrototype: (_i: object, prototype: object, cb: (name: string) => void) => {
          for (const name of Object.getOwnPropertyNames(prototype)) {
            if (name !== 'constructor') cb(name);
          }
        },
      } as unknown as MetadataScanner;
      const collector = new RouteCollector(discovery, scanner);
      collector.onApplicationBootstrap();

      // Empty controller + method paths collapse to a root route stored under an empty path.
      expect(collector.match('GET', '')?.path).toBe('/');
    });
  });
});
