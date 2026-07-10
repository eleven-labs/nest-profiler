import { Logger } from '@nestjs/common';
import type { Profile } from '../../interfaces/profile.interface';
import { AbstractSchemaCollector } from './abstract-schema.collector';
import type { EntitySchema } from './schema.interface';

const emptyProfile = {} as Profile;

/** Concrete subclass driving `introspect()` from an injected thunk. */
class TestSchemaCollector extends AbstractSchemaCollector {
  readonly name = 'test-schema';
  readonly label = 'Test';

  constructor(private readonly introspectFn: () => EntitySchema[] | undefined) {
    super();
  }

  protected introspect(): EntitySchema[] | undefined {
    return this.introspectFn();
  }
}

const entity = (columns: EntitySchema['columns']): EntitySchema => ({
  name: 'Product',
  tableName: 'products',
  columns,
  relations: [],
  indexes: [],
});

describe('AbstractSchemaCollector', () => {
  it('caches the introspected entities and exposes them through collect()', () => {
    const collector = new TestSchemaCollector(() => [entity([])]);
    collector.onApplicationBootstrap();

    const data = collector.collect(emptyProfile);
    expect(data.entityCount).toBe(1);
    expect(data.entities[0]?.name).toBe('Product');
    expect(collector.getBadgeValue(emptyProfile)).toBe('1');
    expect(collector.getTemplatePath().endsWith('schema-panel.ejs')).toBe(true);
  });

  it('redacts secrets in string column defaults and leaves absent defaults untouched', () => {
    const collector = new TestSchemaCollector(() => [
      entity([
        {
          name: 'token',
          type: 'varchar',
          nullable: true,
          primary: false,
          generated: false,
          default: 'sk-0123456789abcdefghij',
        },
        { name: 'id', type: 'int', nullable: false, primary: true, generated: true },
      ]),
    ]);
    collector.onApplicationBootstrap();

    const [product] = collector.collect(emptyProfile).entities;
    expect(product?.columns[0]?.default).toBe('[REDACTED]');
    expect(product?.columns[1]?.default).toBeUndefined();
  });

  it('no-ops (no panel, no warning) when introspection returns undefined', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const collector = new TestSchemaCollector(() => undefined);
    collector.onApplicationBootstrap();

    expect(collector.collect(emptyProfile).entityCount).toBe(0);
    expect(collector.getBadgeValue(emptyProfile)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('warns (canary) when introspection returns an empty list', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const collector = new TestSchemaCollector(() => []);
    collector.onApplicationBootstrap();

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('falls back to an empty schema when introspection throws', () => {
    const collector = new TestSchemaCollector(() => {
      throw new Error('boom');
    });
    collector.onApplicationBootstrap();

    expect(collector.collect(emptyProfile).entityCount).toBe(0);
  });
});
