import { APP_PIPE } from '@nestjs/core';
import type { PipeTransform, Provider, ValueProvider } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import { ValidatorCollectorModule } from './validator-collector.module';
import { ValidatorCollector } from './validator.collector';
import { ProfilerValidationPipe } from './profiler-validation.pipe';
import { DEFAULT_EXTRACTORS } from './default-extractors';
import { PROFILER_INNER_PIPE, PROFILER_EXTRACTORS } from './validator-collector.interface';

function valueProvider(providers: Provider[], token: unknown): ValueProvider | undefined {
  return providers.find(
    (p): p is ValueProvider =>
      typeof p === 'object' &&
      p !== null &&
      'provide' in p &&
      p.provide === token &&
      'useValue' in p,
  );
}

function hasProvideToken(providers: Provider[], token: unknown): boolean {
  return providers.some(
    (p) => typeof p === 'object' && p !== null && 'provide' in p && p.provide === token,
  );
}

const stubPipe: PipeTransform = { transform: (value: unknown) => value };

describe('ValidatorCollectorModule.forRoot', () => {
  it('returns a no-op module when enabled is false', () => {
    expect(ValidatorCollectorModule.forRoot({ enabled: false })).toEqual({
      module: ValidatorCollectorModule,
    });
  });

  it('registers the collector, pipe and global APP_PIPE by default', () => {
    const providers = ValidatorCollectorModule.forRoot().providers ?? [];
    expect(providers).toContain(ValidatorCollector);
    expect(providers).toContain(ProfilerValidationPipe);
    expect(hasProvideToken(providers, APP_PIPE)).toBe(true);
  });

  it('builds a default class-validator inner pipe when no pipe is provided', () => {
    const providers = ValidatorCollectorModule.forRoot().providers ?? [];
    const inner = valueProvider(providers, PROFILER_INNER_PIPE)?.useValue as PipeTransform;
    expect(typeof inner.transform).toBe('function');
  });

  it('uses the provided pipe verbatim without building a class-validator pipe', () => {
    const providers = ValidatorCollectorModule.forRoot({ pipe: stubPipe }).providers ?? [];
    expect(valueProvider(providers, PROFILER_INNER_PIPE)?.useValue).toBe(stubPipe);
  });

  it('defaults to the built-in extractor chain', () => {
    const providers = ValidatorCollectorModule.forRoot().providers ?? [];
    expect(valueProvider(providers, PROFILER_EXTRACTORS)?.useValue).toBe(DEFAULT_EXTRACTORS);
  });

  it('honors custom extractors', () => {
    const extractors = [{ extract: () => null }];
    const providers = ValidatorCollectorModule.forRoot({ extractors }).providers ?? [];
    expect(valueProvider(providers, PROFILER_EXTRACTORS)?.useValue).toBe(extractors);
  });

  it('wires ProfilerValidationPipe through the DI container', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ClsModule.forRoot({ global: true, middleware: { mount: false } }),
        ValidatorCollectorModule.forRoot({ pipe: stubPipe }),
      ],
    }).compile();
    expect(moduleRef.get(ProfilerValidationPipe, { strict: false })).toBeInstanceOf(
      ProfilerValidationPipe,
    );
  });
});
