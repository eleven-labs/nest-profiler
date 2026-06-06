import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { IsNotEmpty, IsString } from 'class-validator';
import { ProfilerValidationPipe } from './profiler-validation.pipe';
import { createClassValidatorPipe } from './class-validator.adapter';
import { VALIDATOR_KEY } from './validator-collector.interface';
import { VALIDATOR_RAW_ERRORS } from './violation-extractor.interface';
import type { ValidationViolationExtractor } from './violation-extractor.interface';
import type { Profile } from '@eleven-labs/nest-profiler';
import type { ValidationEntry } from './validator-collector.interface';

function makeProfile(): Profile {
  return {
    token: 'test',
    createdAt: Date.now(),
    request: { method: 'POST', url: '/products', headers: {}, query: {} },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

const passThrough: PipeTransform = { transform: (value: unknown) => value };
const throwing = (error: unknown): PipeTransform => ({
  transform: () => {
    throw error;
  },
});

const bodyMeta = (metatype: unknown): ArgumentMetadata =>
  ({ type: 'body', metatype, data: '' }) as ArgumentMetadata;

class SimpleDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}

describe('ProfilerValidationPipe', () => {
  let cls: ClsService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ middleware: { mount: false } })],
    }).compile();
    cls = moduleRef.get(ClsService);
  });

  function entriesOf(profile: Profile): ValidationEntry[] {
    return (profile.collectors[VALIDATOR_KEY] as ValidationEntry[] | undefined) ?? [];
  }

  function firstEntry(profile: Profile): ValidationEntry {
    const first = entriesOf(profile)[0];
    if (first === undefined) throw new Error('expected at least one validation entry');
    return first;
  }

  it('captures a "valid" entry when the inner pipe succeeds', async () => {
    const pipe = new ProfilerValidationPipe(cls, passThrough);
    const profile = makeProfile();
    await cls.run(async () => {
      cls.set('profiler.profile', profile);
      const result: unknown = await pipe.transform({ name: 'alice' }, bodyMeta(SimpleDto));
      expect(result).toMatchObject({ name: 'alice' });
    });
    const e = firstEntry(profile);
    expect(e.status).toBe('valid');
    expect(e.violationCount).toBe(0);
    expect(e.dtoClass).toBe('SimpleDto');
    expect(e.source).toBe('body');
  });

  it('captures an "invalid" entry with violations via the class-validator extractor', async () => {
    const error = { [VALIDATOR_RAW_ERRORS]: [{ property: 'name', constraints: { x: 'bad' } }] };
    const pipe = new ProfilerValidationPipe(cls, throwing(error));
    const profile = makeProfile();
    await cls.run(async () => {
      cls.set('profiler.profile', profile);
      await expect(pipe.transform({ name: '' }, bodyMeta(SimpleDto))).rejects.toBe(error);
    });
    const e = firstEntry(profile);
    expect(e.status).toBe('invalid');
    expect(e.violationCount).toBe(1);
    expect(e.violations[0]?.property).toBe('name');
  });

  it('captures an "invalid" entry with violations via the zod extractor', async () => {
    const error = {
      getZodError: () => ({ issues: [{ code: 'too_small', path: ['t'], message: 'short' }] }),
    };
    const pipe = new ProfilerValidationPipe(cls, throwing(error));
    const profile = makeProfile();
    await cls.run(async () => {
      cls.set('profiler.profile', profile);
      await expect(pipe.transform({}, bodyMeta(SimpleDto))).rejects.toBe(error);
    });
    expect(firstEntry(profile).violations[0]?.property).toBe('t');
  });

  it('records an invalid entry with no violations when no extractor recognizes the error', async () => {
    const pipe = new ProfilerValidationPipe(cls, throwing(new Error('boom')));
    const profile = makeProfile();
    await cls.run(async () => {
      cls.set('profiler.profile', profile);
      await expect(pipe.transform({}, bodyMeta(SimpleDto))).rejects.toThrow('boom');
    });
    const e = firstEntry(profile);
    expect(e.status).toBe('invalid');
    expect(e.violationCount).toBe(0);
    expect(e.violations).toEqual([]);
  });

  it('honors a custom extractor chain and stops at the first match', async () => {
    const calls: string[] = [];
    const nullExtractor: ValidationViolationExtractor = {
      extract: () => {
        calls.push('null');
        return null;
      },
    };
    const matchExtractor: ValidationViolationExtractor = {
      extract: () => {
        calls.push('match');
        return [{ property: 'custom', constraints: { rule: 'failed' } }];
      },
    };
    const neverExtractor: ValidationViolationExtractor = {
      extract: () => {
        calls.push('never');
        return [];
      },
    };
    const pipe = new ProfilerValidationPipe(cls, throwing(new Error('x')), [
      nullExtractor,
      matchExtractor,
      neverExtractor,
    ]);
    const profile = makeProfile();
    await cls.run(async () => {
      cls.set('profiler.profile', profile);
      await expect(pipe.transform({}, bodyMeta(SimpleDto))).rejects.toThrow('x');
    });
    expect(firstEntry(profile).violations[0]?.property).toBe('custom');
    expect(calls).toEqual(['null', 'match']);
  });

  it('does not capture for primitive metatypes but still returns the value', async () => {
    const pipe = new ProfilerValidationPipe(cls, passThrough);
    const profile = makeProfile();
    await cls.run(async () => {
      cls.set('profiler.profile', profile);
      const result: unknown = await pipe.transform('plain', bodyMeta(String));
      expect(result).toBe('plain');
    });
    expect(entriesOf(profile)).toHaveLength(0);
  });

  it('does not capture when there is no metatype', async () => {
    const pipe = new ProfilerValidationPipe(cls, passThrough);
    const profile = makeProfile();
    await cls.run(async () => {
      cls.set('profiler.profile', profile);
      await pipe.transform({ any: 'value' }, bodyMeta(undefined));
    });
    expect(entriesOf(profile)).toHaveLength(0);
  });

  it('does not append when there is no active profile in CLS', async () => {
    const pipe = new ProfilerValidationPipe(cls, passThrough);
    await cls.run(async () => {
      const result: unknown = await pipe.transform({ name: 'ok' }, bodyMeta(SimpleDto));
      expect(result).toMatchObject({ name: 'ok' });
    });
  });

  it('works entirely outside a CLS context (swallows CLS errors)', async () => {
    const pipe = new ProfilerValidationPipe(cls, passThrough);
    await expect(pipe.transform({ name: 'ok' }, bodyMeta(SimpleDto))).resolves.toMatchObject({
      name: 'ok',
    });
    const failing = new ProfilerValidationPipe(cls, throwing(new Error('boom')));
    await expect(failing.transform({ name: '' }, bodyMeta(SimpleDto))).rejects.toThrow('boom');
  });

  it('falls back to "unknown" when the metatype has no name', async () => {
    const pipe = new ProfilerValidationPipe(cls, passThrough);
    const profile = makeProfile();
    const Nameless = function () {} as unknown as new () => unknown;
    Object.defineProperty(Nameless, 'name', { value: undefined });
    await cls.run(async () => {
      cls.set('profiler.profile', profile);
      await pipe.transform({}, bodyMeta(Nameless));
    });
    expect(firstEntry(profile).dtoClass).toBe('unknown');
  });

  it('integrates end-to-end with a real class-validator pipe', async () => {
    const pipe = new ProfilerValidationPipe(cls, createClassValidatorPipe());
    const profile = makeProfile();
    await cls.run(async () => {
      cls.set('profiler.profile', profile);
      await expect(pipe.transform({ name: '' }, bodyMeta(SimpleDto))).rejects.toBeDefined();
    });
    const e = firstEntry(profile);
    expect(e.status).toBe('invalid');
    expect(e.violations[0]?.property).toBe('name');
    expect(Object.keys(e.violations[0]?.constraints ?? {}).length).toBeGreaterThan(0);
  });
});
