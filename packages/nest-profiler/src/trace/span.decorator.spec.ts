import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { Span } from './span.decorator';
import { setProfileContext } from '../services/profiler-context';
import { manualSpansOf } from '../utils/profile-runtime-state';
import { appendCollectorEntry } from '../utils/collector.utils';
import type { RawSpan } from './build-trace';
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

class ProductService {
  @Span()
  findAll(): string[] {
    return ['a', 'b'];
  }

  @Span('db.products.findOne')
  async findOne(id: string): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return id;
  }

  @Span()
  boom(): never {
    throw new Error('nope');
  }

  @Span()
  async rejects(): Promise<never> {
    await Promise.resolve();
    throw new Error('async nope');
  }

  @Span()
  outer(): void {
    this.inner();
  }

  @Span()
  inner(): void {
    // The work an instrumentation would capture while this span is active.
    recordQuery();
  }

  @Span()
  earlyReturn(): string {
    if (this.findAll().length > 0) return 'short';
    return 'long';
  }
}

let currentProfile: Profile;

function recordQuery(): void {
  appendCollectorEntry(currentProfile, 'queries', {
    sql: 'SELECT 1',
    duration: 1,
    startedAt: Date.now(),
  });
}

describe('@Span()', () => {
  let cls: ClsService;
  let service: ProductService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ middleware: { mount: false } })],
    }).compile();
    cls = module.get(ClsService);
    service = new ProductService();
    currentProfile = makeProfile();
  });

  function profiled<T>(fn: () => T): T {
    return cls.run(() => {
      setProfileContext(cls, currentProfile, {});
      return fn();
    });
  }

  function spans(): RawSpan[] {
    return manualSpansOf(currentProfile);
  }

  it('records the method as a span, named after the class and method by default', () => {
    const result = profiled(() => service.findAll());

    expect(result).toEqual(['a', 'b']);
    expect(spans()).toHaveLength(1);
    expect(spans()[0]).toMatchObject({ label: 'ProductService.findAll', kind: 'custom' });
  });

  it('honours an explicit name and times the whole async call', async () => {
    const result = await profiled(() => service.findOne('p-1'));

    expect(result).toBe('p-1');
    expect(spans()[0]?.label).toBe('db.products.findOne');
    // Closing on the synchronous return would have measured the time to the first `await`.
    expect(spans()[0]?.duration).toBeGreaterThanOrEqual(15);
  });

  it('passes the arguments through untouched', async () => {
    await expect(profiled(() => service.findOne('p-42'))).resolves.toBe('p-42');
  });

  it('marks the span failed and rethrows, for a sync throw and a rejection alike', async () => {
    expect(() => profiled(() => service.boom())).toThrow('nope');
    await expect(profiled(() => service.rejects())).rejects.toThrow('async nope');

    expect(spans()).toHaveLength(2);
    expect(spans().every((span) => span.status === 'error')).toBe(true);
  });

  it('leaves `return` meaning what it means — the point of a decorator over a callback', () => {
    // Wrapped in a callback, an early `return` would exit the callback, not the method. Here the
    // body is untouched, so it cannot.
    expect(profiled(() => service.earlyReturn())).toBe('short');
  });

  describe('nesting', () => {
    it('becomes the active span, so a method it calls is recorded underneath', () => {
      profiled(() => service.outer());

      const outer = spans().find((s) => s.label === 'ProductService.outer');
      const inner = spans().find((s) => s.label === 'ProductService.inner');
      expect(inner?.parentId).toBe(outer?.id);
      expect(outer?.parentId).toBeUndefined();
    });

    it('adopts the work an instrumentation captures while it runs', () => {
      // This is what a callback-free decorator still has to deliver: the query is stamped with the
      // decorated method's span, without either side knowing about the other.
      profiled(() => service.outer());

      const inner = spans().find((s) => s.label === 'ProductService.inner');
      const [query] = currentProfile.collectors.queries as { parentSpanId?: string }[];
      expect(query?.parentSpanId).toBe(inner?.id);
    });
  });

  describe('outside a profiled execution', () => {
    it('survives a CLS service that cannot be resolved at all', () => {
      // A provider called during bootstrap runs before ClsModule is up. A debugging aid must not
      // be the thing that breaks it, so the resolution failure is swallowed.
      const manager = jest.requireActual<typeof import('nestjs-cls')>('nestjs-cls')
        .ClsServiceManager as unknown as { getClsService: () => unknown };
      const original = manager.getClsService;
      manager.getClsService = () => {
        throw new Error('ClsModule is not initialized');
      };

      try {
        expect(service.findAll()).toEqual(['a', 'b']);
      } finally {
        manager.getClsService = original;
      }
    });

    it('runs the method unchanged and records nothing', () => {
      expect(service.findAll()).toEqual(['a', 'b']);
      expect(spans()).toHaveLength(0);
    });

    it('lets an error through unchanged', () => {
      expect(() => service.boom()).toThrow('nope');
    });
  });

  describe('the decorated method stays indistinguishable to anything reflecting over it', () => {
    it('keeps its name and arity', () => {
      expect(service.findOne.name).toBe('findOne');
      expect(service.findOne.length).toBe(1);
    });

    it('carries over the metadata a decorator below it already set', () => {
      // Nest reads routes, guards and pipes off the prototype method. Decorators apply
      // bottom-up, so @Marker stamps the original function and @Span then replaces it —
      // without copying, the stamp would be lost and a `@Get()` under a `@Span()` would
      // silently stop being a route.
      const MARKER = 'test:marker';
      const Marker =
        (value: string): MethodDecorator =>
        (_target, _key, descriptor) => {
          Reflect.defineMetadata(MARKER, value, descriptor.value as object);
          return descriptor;
        };

      class Controller {
        @Span()
        @Marker('route')
        handler(): void {
          /* nothing to run — this test is about metadata */
        }
      }

      const handler = Object.getOwnPropertyDescriptor(Controller.prototype, 'handler')?.value as
        object | undefined;
      expect(Reflect.getMetadata(MARKER, handler as object)).toBe('route');
    });
  });
});
