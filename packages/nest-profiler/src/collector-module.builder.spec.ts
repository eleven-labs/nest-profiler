import type { DynamicModule } from '@nestjs/common';
import { buildCollectorModule } from './collector-module.builder';

class DummyModule {}
class DummyProvider {}
class FixedProvider {}
class FixedImport {}

const base: DynamicModule = { module: DummyModule };

describe('buildCollectorModule', () => {
  describe('enabled: false', () => {
    it('returns an inert module by default', () => {
      const mod = buildCollectorModule(base, { enabled: false });
      expect(mod).toEqual({ module: DummyModule });
    });

    it('delegates to the custom disabled shape, passing it the builder base', () => {
      const disabled = jest.fn((b: DynamicModule) => ({ module: b.module, providers: [] }));
      const mod = buildCollectorModule(base, { enabled: false }, { disabled });
      expect(disabled).toHaveBeenCalledWith(base);
      expect(mod.module).toBe(DummyModule);
    });
  });

  describe('active path', () => {
    it('merges the builder base with the fixed collector shape', () => {
      const richBase: DynamicModule = {
        module: DummyModule,
        imports: [FixedImport],
        providers: [DummyProvider],
        exports: [DummyProvider],
      };
      const mod = buildCollectorModule(richBase, {}, { providers: [FixedProvider] });
      expect(mod.module).toBe(DummyModule);
      expect(mod.imports).toEqual([FixedImport]);
      expect(mod.providers).toEqual([DummyProvider, FixedProvider]);
      expect(mod.exports).toEqual([DummyProvider]);
    });

    it('defaults every list to empty when neither base nor shape provide them', () => {
      const mod = buildCollectorModule(base, {});
      expect(mod).toEqual({ module: DummyModule, imports: [], providers: [], exports: [] });
    });
  });
});
