import * as path from 'path';
import type { ArgumentMetadata } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ValidatorCollector } from './validator.collector';
import { ValidatorCollectorModule } from './validator-collector.module';
import { ProfilerValidationPipe, mapViolations, countViolations } from './profiler-validation.pipe';
import type { ValidationError } from 'class-validator';
import {
  VALIDATOR_KEY,
  VALIDATOR_PENDING_KEY,
  PROFILER_VALIDATION_OPTIONS,
} from './validator-collector.interface';
import type { Profile } from '@eleven-labs/nest-profiler';
import type { ValidationEntry } from './validator-collector.interface';

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    token: 'test',
    createdAt: Date.now(),
    request: { method: 'POST', url: '/products', headers: {}, query: {} },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
    ...overrides,
  };
}

function makeEntry(status: ValidationEntry['status'], violations = 0): ValidationEntry {
  return {
    source: 'body',
    dtoClass: 'CreateProductDto',
    status,
    violationCount: violations,
    violations:
      violations > 0
        ? [{ property: 'name', value: '', constraints: { isNotEmpty: 'name should not be empty' } }]
        : [],
    timestamp: Date.now(),
  };
}

describe('ValidatorCollector', () => {
  let collector: ValidatorCollector;

  beforeEach(() => {
    collector = new ValidatorCollector();
  });

  it('collects entries and removes the internal key', () => {
    const entry = makeEntry('valid');
    const profile = makeProfile({ collectors: { [VALIDATOR_KEY]: [entry] } });
    const result = collector.collect(profile);
    expect(result).toEqual([entry]);
    expect(profile.collectors[VALIDATOR_KEY]).toBeUndefined();
  });

  it('returns empty array when no entries', () => {
    expect(collector.collect(makeProfile())).toEqual([]);
  });

  it('getBadgeValue returns null when no entries', () => {
    expect(collector.getBadgeValue(makeProfile())).toBeNull();
  });

  it('getBadgeValue returns count when all valid', () => {
    const profile = makeProfile({
      collectors: { [VALIDATOR_KEY]: [makeEntry('valid'), makeEntry('valid')] },
    });
    expect(collector.getBadgeValue(profile)).toBe(2);
  });

  it('getBadgeValue shows violation count when invalid', () => {
    const profile = makeProfile({
      collectors: { [VALIDATOR_KEY]: [makeEntry('valid'), makeEntry('invalid', 3)] },
    });
    expect(collector.getBadgeValue(profile)).toBe(2);
  });

  it('getBadgeValue shows singular for one violation', () => {
    const profile = makeProfile({ collectors: { [VALIDATOR_KEY]: [makeEntry('invalid', 1)] } });
    expect(collector.getBadgeValue(profile)).toBe(1);
  });

  it('getBadgeValue reads from profile.collectors[name] after collect() has run', () => {
    const entry = makeEntry('valid');
    const profile = makeProfile({ collectors: { [VALIDATOR_KEY]: [entry, entry] } });
    const collected = collector.collect(profile);
    profile.collectors[collector.name] = collected;
    expect(profile.collectors[VALIDATOR_KEY]).toBeUndefined();
    expect(collector.getBadgeValue(profile)).toBe(2);
  });

  it('getTemplatePath returns absolute path to validator-panel.ejs', () => {
    const p = collector.getTemplatePath();
    expect(p).toMatch(/validator-panel\.ejs$/);
    expect(path.isAbsolute(p)).toBe(true);
  });
});

describe('ValidatorCollectorModule.forRoot', () => {
  it('returns a no-op module when enabled is false', () => {
    expect(ValidatorCollectorModule.forRoot({ enabled: false })).toEqual({
      module: ValidatorCollectorModule,
    });
  });

  it('registers providers by default', () => {
    expect(ValidatorCollectorModule.forRoot().providers?.length ?? 0).toBeGreaterThan(0);
  });
});

class SimpleDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}

class AddressDto {
  @IsString()
  @IsNotEmpty()
  city!: string;
}

class UserDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;
}

describe('ProfilerValidationPipe', () => {
  let cls: ClsService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ middleware: { mount: false } })],
      providers: [],
    }).compile();
    cls = moduleRef.get(ClsService);
  });

  function makePipe(options: Record<string, unknown> = {}): ProfilerValidationPipe {
    return new ProfilerValidationPipe(cls, options);
  }

  const bodyMeta = (metatype: unknown): ArgumentMetadata =>
    ({ type: 'body', metatype, data: '' }) as ArgumentMetadata;

  function entriesOf(profile: Profile): ValidationEntry[] {
    return (profile.collectors[VALIDATOR_KEY] as ValidationEntry[] | undefined) ?? [];
  }

  it('captures a "valid" entry when validation succeeds', async () => {
    const pipe = makePipe();
    const profile = makeProfile();
    await cls.run(async () => {
      cls.set('profiler.profile', profile);
      const result: unknown = await pipe.transform({ name: 'alice' }, bodyMeta(SimpleDto));
      expect(result).toMatchObject({ name: 'alice' });
    });
    const [e] = entriesOf(profile);
    expect(e.status).toBe('valid');
    expect(e.violationCount).toBe(0);
    expect(e.dtoClass).toBe('SimpleDto');
    expect(e.source).toBe('body');
  });

  it('captures an "invalid" entry with mapped violations when validation fails', async () => {
    const pipe = makePipe();
    const profile = makeProfile();
    await cls.run(async () => {
      cls.set('profiler.profile', profile);
      await expect(pipe.transform({ name: '' }, bodyMeta(SimpleDto))).rejects.toBeDefined();
    });
    const [e] = entriesOf(profile);
    expect(e.status).toBe('invalid');
    expect(e.violationCount).toBeGreaterThan(0);
    expect(e.violations[0].property).toBe('name');
    expect(Object.keys(e.violations[0].constraints).length).toBeGreaterThan(0);
  });

  it('maps and counts nested (child) violations', async () => {
    const pipe = makePipe({ transform: true });
    const profile = makeProfile();
    await cls.run(async () => {
      cls.set('profiler.profile', profile);
      await expect(
        pipe.transform({ name: '', address: { city: '' } }, bodyMeta(UserDto)),
      ).rejects.toBeDefined();
    });
    const [e] = entriesOf(profile);
    const addressViolation = e.violations.find((v) => v.property === 'address');
    expect(addressViolation?.children?.[0].property).toBe('city');
    // name (1) + nested address.city (1) = 2 violations counted.
    expect(e.violationCount).toBe(2);
  });

  it('does not capture for primitive metatypes', async () => {
    const pipe = makePipe();
    const profile = makeProfile();
    await cls.run(async () => {
      cls.set('profiler.profile', profile);
      await pipe.transform('plain-string', bodyMeta(String));
    });
    expect(entriesOf(profile)).toHaveLength(0);
  });

  it('does not capture when there is no metatype', async () => {
    const pipe = makePipe();
    const profile = makeProfile();
    await cls.run(async () => {
      cls.set('profiler.profile', profile);
      await pipe.transform({ any: 'value' }, bodyMeta(undefined));
    });
    expect(entriesOf(profile)).toHaveLength(0);
  });

  it('does not append when there is no active profile in CLS', async () => {
    const pipe = makePipe();
    await cls.run(async () => {
      // No profile set in CLS.
      const result: unknown = await pipe.transform({ name: 'ok' }, bodyMeta(SimpleDto));
      expect(result).toMatchObject({ name: 'ok' });
    });
  });

  it('transforms without throwing when used entirely outside a CLS context', async () => {
    const pipe = makePipe();
    // Valid path outside CLS — pushEntry's cls.get throws and is swallowed.
    await expect(pipe.transform({ name: 'ok' }, bodyMeta(SimpleDto))).resolves.toMatchObject({
      name: 'ok',
    });
    // Invalid path outside CLS — pending lookup and pushEntry both swallow CLS errors.
    await expect(pipe.transform({ name: '' }, bodyMeta(SimpleDto))).rejects.toBeDefined();
  });

  describe('validate()', () => {
    it('stores pending errors in CLS when validation produces errors', async () => {
      const pipe = makePipe();
      await cls.run(async () => {
        const instance = Object.assign(new SimpleDto(), { name: '' });
        const errors = await pipe.validate(instance);
        expect(errors.length).toBeGreaterThan(0);
        expect(cls.get(VALIDATOR_PENDING_KEY)).toBe(errors);
      });
    });

    it('returns an empty array and stores nothing for a valid object', async () => {
      const pipe = makePipe();
      await cls.run(async () => {
        const instance = Object.assign(new SimpleDto(), { name: 'ok' });
        expect(await pipe.validate(instance)).toEqual([]);
        expect(cls.get(VALIDATOR_PENDING_KEY)).toBeUndefined();
      });
    });

    it('swallows CLS errors when validating outside a context', async () => {
      const pipe = makePipe();
      const instance = Object.assign(new SimpleDto(), { name: '' });
      const errors = await pipe.validate(instance);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  it('is constructible without explicit options (uses defaults)', () => {
    expect(new ProfilerValidationPipe(cls)).toBeInstanceOf(ProfilerValidationPipe);
  });

  it('falls back to "unknown" as the DTO class name when the metatype has no name', async () => {
    const pipe = makePipe();
    const profile = makeProfile();
    const Nameless = function () {} as unknown as new () => unknown;
    Object.defineProperty(Nameless, 'name', { value: undefined });
    await cls.run(async () => {
      cls.set('profiler.profile', profile);
      await pipe.transform({}, bodyMeta(Nameless));
    });
    expect(entriesOf(profile)[0].dtoClass).toBe('unknown');
  });
});

describe('mapViolations', () => {
  it('maps property, value and constraints, defaulting missing constraints to {}', () => {
    const errors = [
      { property: 'a', value: 1, constraints: { isInt: 'must be int' } },
      { property: 'b' },
    ] as unknown as ValidationError[];
    expect(mapViolations(errors)).toEqual([
      { property: 'a', value: 1, constraints: { isInt: 'must be int' }, children: undefined },
      { property: 'b', value: undefined, constraints: {}, children: undefined },
    ]);
  });

  it('recurses into children when present', () => {
    const errors = [
      {
        property: 'address',
        children: [{ property: 'city', constraints: { isNotEmpty: 'required' } }],
      },
    ] as unknown as ValidationError[];
    const mapped = mapViolations(errors);
    expect(mapped[0].children?.[0].property).toBe('city');
  });
});

describe('countViolations', () => {
  it('counts the number of constraints on a leaf violation', () => {
    expect(countViolations([{ property: 'a', constraints: { x: '1', y: '2' } }])).toBe(2);
  });

  it('counts a leaf with no constraints as a single violation', () => {
    expect(countViolations([{ property: 'a', constraints: {} }])).toBe(1);
  });

  it('counts only the children of a parent that has children but no constraints', () => {
    expect(
      countViolations([
        {
          property: 'parent',
          constraints: {},
          children: [
            { property: 'c1', constraints: { x: '1' } },
            { property: 'c2', constraints: { y: '2' } },
          ],
        },
      ]),
    ).toBe(2);
  });
});

describe('ProfilerValidationPipe via PROFILER_VALIDATION_OPTIONS token', () => {
  it('injects ValidationPipe options from the DI token', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ middleware: { mount: false } })],
      providers: [
        ProfilerValidationPipe,
        { provide: PROFILER_VALIDATION_OPTIONS, useValue: { transform: true } },
      ],
    }).compile();
    expect(moduleRef.get(ProfilerValidationPipe)).toBeInstanceOf(ProfilerValidationPipe);
  });
});
