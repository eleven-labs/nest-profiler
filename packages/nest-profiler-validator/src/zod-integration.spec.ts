import type { ArgumentMetadata } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { z } from 'zod';
import { createZodDto, ZodValidationPipe } from 'nestjs-zod';
import { ProfilerValidationPipe } from './profiler-validation.pipe';
import { VALIDATOR_KEY } from './validator-collector.interface';
import type { Profile } from '@eleven-labs/nest-profiler';
import type { ValidationEntry } from './validator-collector.interface';

const WidgetSchema = z.object({
  name: z.string().min(3),
  quantity: z.number().int().min(1),
});

class CreateWidgetDto extends createZodDto(WidgetSchema) {}

function makeProfile(): Profile {
  return {
    token: 'test',
    createdAt: Date.now(),
    request: { method: 'POST', url: '/widgets', headers: {}, query: {} },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

const bodyMeta: ArgumentMetadata = { type: 'body', metatype: CreateWidgetDto, data: '' };

describe('ProfilerValidationPipe with nestjs-zod (real integration)', () => {
  let cls: ClsService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ middleware: { mount: false } })],
    }).compile();
    cls = moduleRef.get(ClsService);
  });

  function entries(profile: Profile): ValidationEntry[] {
    return (profile.collectors[VALIDATOR_KEY] as ValidationEntry[] | undefined) ?? [];
  }

  it('captures a valid entry for a payload that satisfies the zod schema', async () => {
    const pipe = new ProfilerValidationPipe(cls, new ZodValidationPipe());
    const profile = makeProfile();
    await cls.run(async () => {
      cls.set('profiler.profile', profile);
      const result: unknown = await pipe.transform({ name: 'gizmo', quantity: 5 }, bodyMeta);
      expect(result).toMatchObject({ name: 'gizmo', quantity: 5 });
    });
    expect(entries(profile)[0]?.status).toBe('valid');
  });

  it('captures an invalid entry with violations mapped from the ZodError', async () => {
    const pipe = new ProfilerValidationPipe(cls, new ZodValidationPipe());
    const profile = makeProfile();
    await cls.run(async () => {
      cls.set('profiler.profile', profile);
      await expect(pipe.transform({ name: 'ab', quantity: 0 }, bodyMeta)).rejects.toBeDefined();
    });
    const entry = entries(profile)[0];
    expect(entry?.status).toBe('invalid');
    const properties = (entry?.violations ?? []).map((v) => v.property);
    expect(properties).toEqual(expect.arrayContaining(['name', 'quantity']));
  });
});
