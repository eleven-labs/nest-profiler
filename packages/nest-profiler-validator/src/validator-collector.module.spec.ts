import { APP_PIPE } from '@nestjs/core';
import type { FactoryProvider, PipeTransform, Provider, ValueProvider } from '@nestjs/common';
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
  it('still installs the bare validation pipe (no profiler wrapper) when enabled is false', () => {
    // MAJ-6: disabling turns off profiling, not validation — this module is the host's
    // installation vector for the global pipe, so a provided pipe stays installed as APP_PIPE.
    const mod = ValidatorCollectorModule.forRoot({ enabled: false, pipe: stubPipe });
    const providers = mod.providers ?? [];
    const appPipe = valueProvider(providers, APP_PIPE);
    expect(appPipe?.useValue).toBe(stubPipe);
    // But NOT the profiler wrapper / collector.
    expect(providers).not.toContain(ProfilerValidationPipe);
    expect(providers).not.toContain(ValidatorCollector);
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

function factoryProvider(providers: Provider[], token: unknown): FactoryProvider | undefined {
  return providers.find(
    (p): p is FactoryProvider =>
      typeof p === 'object' &&
      p !== null &&
      'provide' in p &&
      p.provide === token &&
      'useFactory' in p,
  );
}

describe('ValidatorCollectorModule.forRootAsync', () => {
  it('derives the inner pipe and extractors from the async options token and forwards imports', () => {
    class FakeImport {}
    const useFactory = (): { pipe: PipeTransform } => ({ pipe: stubPipe });
    const mod = ValidatorCollectorModule.forRootAsync({
      imports: [FakeImport],
      inject: ['CONFIG'],
      useFactory,
    });
    const providers = mod.providers ?? [];
    expect(mod.imports).toContain(FakeImport);
    expect(providers).toContain(ValidatorCollector);
    expect(providers).toContain(ProfilerValidationPipe);
    // The inner pipe + extractors are resolved from the async options (useFactory, not useValue).
    const inner = factoryProvider(providers, PROFILER_INNER_PIPE);
    expect(inner?.useFactory({ pipe: stubPipe })).toBe(stubPipe);
    // With no `pipe`, the factory builds the default class-validator pipe.
    expect(typeof (inner?.useFactory({}) as PipeTransform).transform).toBe('function');

    const extractors = [{ extract: () => null }];
    const extractorsProvider = factoryProvider(providers, PROFILER_EXTRACTORS);
    expect(extractorsProvider?.useFactory({ extractors })).toBe(extractors);
    // With no `extractors`, the factory falls back to the built-in chain.
    expect(extractorsProvider?.useFactory({})).toBe(DEFAULT_EXTRACTORS);
  });

  it('keeps a validation pipe installed (no profiler wrapper) when enabled is false', () => {
    const mod = ValidatorCollectorModule.forRootAsync({
      enabled: false,
      useFactory: () => ({ pipe: stubPipe }),
    });
    const providers = mod.providers ?? [];
    const appPipe = factoryProvider(providers, APP_PIPE);
    expect(appPipe?.useFactory({ pipe: stubPipe })).toBe(stubPipe);
    expect(providers).not.toContain(ProfilerValidationPipe);
    expect(providers).not.toContain(ValidatorCollector);
  });

  it('falls back to a passthrough pipe when no validation pipe can be resolved (async, disabled)', () => {
    // Simulate a missing class-validator peer: resolveInnerPipe returns undefined.
    const spy = jest
      .spyOn(
        ValidatorCollectorModule as unknown as { resolveInnerPipe: () => undefined },
        'resolveInnerPipe',
      )
      .mockReturnValue(undefined);
    const mod = ValidatorCollectorModule.forRootAsync({ enabled: false, useFactory: () => ({}) });
    const appPipe = factoryProvider(mod.providers ?? [], APP_PIPE);
    const pipe = appPipe?.useFactory({}) as PipeTransform;
    // A passthrough pipe returns its input unchanged (no validation, but bootstrap never crashes).
    expect(pipe.transform('x', { type: 'body' })).toBe('x');
    spy.mockRestore();
  });
});
