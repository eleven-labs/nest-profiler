import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import * as peerUtil from '../utils/optional-peer.util';
import { Test } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { createProfilerInstrument } from './profiler-instrument';
import { markInternal } from './internal-marker';
import { setProfileContext } from '../services/profiler-context';
import { manualSpansOf } from '../utils/profile-runtime-state';
import { appendCollectorEntry } from '../utils/collector.utils';
import type { RawSpan } from '../trace/build-trace';
import type { Profile } from '../interfaces/profile.interface';

function makeProfile(): Profile {
  return {
    token: 'tok',
    traceId: 'trace-tok',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: {} },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

class Repository {
  save(value: string): string {
    return `saved:${value}`;
  }
}

class ProductService {
  constructor(readonly repo: Repository) {}

  create(name: string): string {
    return this.repo.save(name);
  }

  /** Calls into itself through `this`, which the Proxy should record as a nested span. */
  createTwice(name: string): string {
    return this.create(name) + this.helper();
  }

  helper(): string {
    return '!';
  }

  async slow(): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, 15));
    return 'done';
  }

  boom(): never {
    throw new Error('nope');
  }

  countdown(n: number): number {
    return n <= 0 ? 0 : this.countdown(n - 1);
  }
}

describe('createProfilerInstrument', () => {
  let cls: ClsService;
  let profile: Profile;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ middleware: { mount: false } })],
    }).compile();
    cls = module.get(ClsService);
    profile = makeProfile();
  });

  function instrument<T extends object>(
    instance: T,
    options?: Parameters<typeof createProfilerInstrument>[0],
  ): T {
    return createProfilerInstrument(options).instanceDecorator(instance) as T;
  }

  function profiled<T>(fn: () => T): T {
    return cls.run(() => {
      setProfileContext(cls, profile, {});
      return fn();
    });
  }

  function spans(): RawSpan[] {
    return manualSpansOf(profile);
  }

  function labels(): string[] {
    return spans().map((span) => span.label);
  }

  describe('what it records', () => {
    it('opens one span per method call, named Class.method', () => {
      const service = instrument(new ProductService(new Repository()));

      const result = profiled(() => service.create('chair'));

      expect(result).toBe('saved:chair');
      expect(labels()).toEqual(['ProductService.create']);
      expect(spans()[0]?.kind).toBe('method');
    });

    it('nests a call made through an injected, also-instrumented provider', () => {
      // The shape from the screenshot: Controller → Service → Repository, each one a bar under the
      // previous. Nest instruments every provider, so both instances are wrapped independently and
      // only the async context links them.
      const repo = instrument(new Repository());
      const service = instrument(new ProductService(repo));

      profiled(() => service.create('desk'));

      const create = spans().find((s) => s.label === 'ProductService.create');
      const save = spans().find((s) => s.label === 'Repository.save');
      expect(save?.parentId).toBe(create?.id);
      expect(create?.parentId).toBeUndefined();
    });

    it('records a self-call through `this` as a nested span', () => {
      const service = instrument(new ProductService(new Repository()));

      profiled(() => service.createTwice('lamp'));

      const outer = spans().find((s) => s.label === 'ProductService.createTwice');
      const inner = spans().find((s) => s.label === 'ProductService.create');
      expect(inner?.parentId).toBe(outer?.id);
    });

    it('times an async method to its resolution, not to its first await', async () => {
      const service = instrument(new ProductService(new Repository()));

      await profiled(() => service.slow());

      expect(spans()[0]?.duration).toBeGreaterThanOrEqual(10);
    });

    it('marks a throwing method failed and rethrows', () => {
      const service = instrument(new ProductService(new Repository()));

      expect(() => profiled(() => service.boom())).toThrow('nope');
      expect(spans()[0]).toMatchObject({ label: 'ProductService.boom', status: 'error' });
    });

    it('adopts the work an instrumentation captures inside the call', () => {
      const repo = instrument({
        constructor: Repository,
        find(): void {
          appendCollectorEntry(profile, 'queries', {
            sql: 'SELECT 1',
            duration: 1,
            startedAt: Date.now(),
          });
        },
      } as unknown as { find(): void });

      profiled(() => repo.find());

      const [query] = profile.collectors.queries as { parentSpanId?: string }[];
      expect(query?.parentSpanId).toBe(spans()[0]?.id);
    });
  });

  describe('bounding the tree', () => {
    it('runs a recursive call untraced after the first level', () => {
      // Without the re-entrancy guard, `countdown(50)` would emit 51 spans of the same name.
      const service = instrument(new ProductService(new Repository()));

      expect(profiled(() => service.countdown(50))).toBe(0);
      expect(labels()).toEqual(['ProductService.countdown']);
    });

    it('stops opening spans past maxDepth, without stopping the calls', () => {
      class Chain {
        next?: Chain;
        run(depth: number): number {
          return depth <= 0 ? 0 : this.step(depth);
        }
        step(depth: number): number {
          return this.next ? this.next.run(depth - 1) : depth;
        }
      }
      // A fresh instrumented instance per level, so the re-entrancy guard never fires.
      const build = (levels: number): Chain => {
        const node = instrument(new Chain(), { maxDepth: 3 });
        if (levels > 0) node.next = build(levels - 1);
        return node;
      };

      const result = profiled(() => build(10).run(10));

      expect(result).toBe(0);
      expect(spans().length).toBeLessThanOrEqual(3);
    });
  });

  describe('what it must not wrap', () => {
    it('hands back a class-valued property untouched, so `new` still works', () => {
      class Token {}
      const holder = instrument({ Token });

      expect(holder.Token).toBe(Token);
      expect(new holder.Token()).toBeInstanceOf(Token);
    });

    it('hands back a callable object untouched, keeping everything hung off it', () => {
      // A Mongoose model or an Axios instance: a function carrying its API as own properties.
      // Wrapping it would return a bare function and `model.findOne` would vanish.
      const model = Object.assign(function query() {}, { findOne: () => 'found' });
      const holder = instrument({ model });

      expect(holder.model).toBe(model);
      expect(holder.model.findOne()).toBe('found');
    });

    it('leaves a bare built-in provider alone rather than breaking its natives', () => {
      // `useValue: new Map()` — every method reads internal slots and would throw through a Proxy.
      const map = new Map<string, string>();
      expect(instrument(map)).toBe(map);
    });

    it('keeps a Map subclass usable, natives included', () => {
      // A user subclass carries methods worth tracing, so it *is* wrapped — but its inherited
      // natives must keep running, which is what the raw-receiver path buys.
      class Cache extends Map<string, string> {
        put(key: string, value: string): this {
          return this.set(key, value);
        }
      }
      const cache = instrument(new Cache());

      profiled(() => cache.put('k', 'v'));

      expect(cache.get('k')).toBe('v');
      expect(labels()).toContain('Cache.put');
    });

    it('keeps a class with native private members working', () => {
      // A brand check (`this.#count`) cannot be satisfied through a Proxy receiver.
      class Counter {
        #count = 0;
        increment(): number {
          return ++this.#count;
        }
      }
      const counter = instrument(new Counter());

      expect(profiled(() => counter.increment())).toBe(1);
      expect(profiled(() => counter.increment())).toBe(2);
    });

    it('excludes the profiler own providers, which would otherwise bury the signal', () => {
      // Found by running it: an unfiltered request produced 75 spans, of which about a dozen were
      // application code — the rest being the interceptor, the collector registry, `ClsService`
      // and, recursively, the tracer opening the spans.
      class ProfilerThing {
        work(): string {
          return 'internal';
        }
      }
      markInternal([ProfilerThing]);
      const thing = instrument(new ProfilerThing());

      expect(thing).toBeInstanceOf(ProfilerThing);
      profiled(() => thing.work());
      expect(spans()).toHaveLength(0);
    });

    it('excludes a subclass of an internal, so the ORM collectors need no marking of their own', () => {
      class AbstractCollector {}
      markInternal([AbstractCollector]);
      class TypeOrmCollector extends AbstractCollector {
        collect(): string {
          return 'entries';
        }
      }
      const collector = instrument(new TypeOrmCollector());

      profiled(() => collector.collect());
      expect(spans()).toHaveLength(0);
    });

    it('records internals when explicitly asked, for debugging the profiler itself', () => {
      class ProfilerThing {
        work(): string {
          return 'internal';
        }
      }
      markInternal([ProfilerThing]);
      const thing = instrument(new ProfilerThing(), { includeInternals: true });

      profiled(() => thing.work());
      expect(labels()).toEqual(['ProfilerThing.work']);
    });

    it('skips an instance with no class name of its own', () => {
      // Nest wraps a guard or an interceptor in a plain object, whose spans read
      // `Object.canActivate` and `Object.intercept` — a label naming nothing, sitting between the
      // request and the controller and costing a level of depth for everything under it.
      const wrapper = { canActivate: () => true };
      expect(instrument(wrapper)).toBe(wrapper);

      profiled(() => wrapper.canActivate());
      expect(spans()).toHaveLength(0);
    });

    it('records them when explicitly asked', () => {
      const wrapper = { canActivate: () => true };
      const instrumented = instrument(wrapper, { includeAnonymous: true });

      profiled(() => instrumented.canActivate());
      expect(labels()).toEqual(['Object.canActivate']);
    });

    it('honours the skip predicate, returning the exact instance', () => {
      const service = new ProductService(new Repository());
      const result = instrument(service, { skip: (i) => i instanceof ProductService });

      expect(result).toBe(service);
      profiled(() => result.create('x'));
      expect(spans()).toHaveLength(0);
    });

    it('leaves a non-object value alone', () => {
      const decorate = createProfilerInstrument().instanceDecorator;
      expect(decorate('a string')).toBe('a string');
      expect(decorate(null)).toBeNull();
      expect(decorate(undefined)).toBeUndefined();
    });

    it('hands back an instance whose prototype cannot be read', () => {
      // nestjs-cls proxy providers throw on property access outside a CLS context.
      const hostile = new Proxy(
        {},
        {
          getPrototypeOf: () => {
            throw new Error('no context');
          },
        },
      );
      expect(instrument(hostile)).toBe(hostile);
    });
  });

  describe('an older Nest, where the instrument option does not exist', () => {
    it('warns once rather than staying silently inert', () => {
      // A peer range only warns at install, so a consumer can well be on 11.0.x — and there the
      // option is ignored, the decorator never called, and the trace merely looks empty. Silence
      // is the worst failure mode for a debugging tool.
      const spy = jest.spyOn(peerUtil, 'loadOptionalPeer');
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      try {
        spy.mockReturnValue({ version: '11.0.9' });
        createProfilerInstrument();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('11.1.4'));

        warn.mockClear();
        spy.mockReturnValue({ version: '11.1.4' });
        createProfilerInstrument();
        expect(warn).not.toHaveBeenCalled();

        // An unparseable version is not evidence of anything — stay quiet.
        warn.mockClear();
        spy.mockReturnValue({ version: 'workspace:*' });
        createProfilerInstrument();
        expect(warn).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
        warn.mockRestore();
      }
    });
  });

  describe('transparency', () => {
    it('keeps the method name and returns a stable reference across accesses', () => {
      const service = instrument(new ProductService(new Repository()));

      /* eslint-disable @typescript-eslint/unbound-method */
      expect(service.create.name).toBe('create');
      expect(service.create).toBe(service.create);
      /* eslint-enable @typescript-eslint/unbound-method */
    });

    it('carries reflect-metadata across, so a route stays a route', () => {
      const MARKER = 'test:route';
      class Controller {
        handle(): string {
          return 'ok';
        }
      }
      /* eslint-disable @typescript-eslint/unbound-method */
      Reflect.defineMetadata(MARKER, '/things', Controller.prototype.handle);
      const controller = instrument(new Controller());

      expect(Reflect.getMetadata(MARKER, controller.handle)).toBe('/things');
      /* eslint-enable @typescript-eslint/unbound-method */
    });

    it('records nothing and changes nothing outside a profiled execution', () => {
      const service = instrument(new ProductService(new Repository()));

      expect(service.create('outside')).toBe('saved:outside');
      expect(spans()).toHaveLength(0);
    });
  });
});
