import { BadRequestException } from '@nestjs/common';
import type { ArgumentMetadata } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { createClassValidatorPipe } from './class-validator.adapter';
import { VALIDATOR_RAW_ERRORS } from './violation-extractor.interface';

class SimpleDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}

const bodyMeta = (metatype: unknown): ArgumentMetadata =>
  ({ type: 'body', metatype, data: '' }) as ArgumentMetadata;

async function capture(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected the pipe to throw');
}

describe('createClassValidatorPipe', () => {
  it('returns the transformed instance for a valid payload', async () => {
    const pipe = createClassValidatorPipe({ whitelist: true });
    const result: unknown = await pipe.transform({ name: 'alice' }, bodyMeta(SimpleDto));
    expect(result).toMatchObject({ name: 'alice' });
  });

  it('attaches the raw ValidationError[] to the thrown exception', async () => {
    const pipe = createClassValidatorPipe();
    const err = await capture(async () => {
      await pipe.transform({ name: '' }, bodyMeta(SimpleDto));
    });

    expect(err).toBeInstanceOf(BadRequestException);
    const raw = (err as Record<symbol, unknown>)[VALIDATOR_RAW_ERRORS];
    expect(raw).toEqual(expect.arrayContaining([expect.objectContaining({ property: 'name' })]));
  });

  it('preserves the default flattened 400 message response', async () => {
    const pipe = createClassValidatorPipe();
    const err = await capture(async () => {
      await pipe.transform({ name: '' }, bodyMeta(SimpleDto));
    });

    const response: unknown = (err as BadRequestException).getResponse();
    expect(response).toMatchObject({ statusCode: 400 });
    const message = (response as { message?: unknown }).message;
    expect(Array.isArray(message)).toBe(true);
    expect((message as unknown[]).length).toBeGreaterThan(0);
  });

  it('passes a non-object exception through untouched', async () => {
    const pipe = createClassValidatorPipe({ exceptionFactory: () => 'plain error' });
    const err = await capture(async () => {
      await pipe.transform({ name: '' }, bodyMeta(SimpleDto));
    });
    expect(err).toBe('plain error');
  });
});
