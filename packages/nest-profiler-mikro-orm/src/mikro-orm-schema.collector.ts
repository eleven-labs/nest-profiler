import { Inject, Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { MikroORM, ReferenceKind } from '@mikro-orm/core';
import type { EntityMetadata, EntityProperty } from '@mikro-orm/core';
import { getMikroORMToken } from '@mikro-orm/nestjs';
import {
  AbstractSchemaCollector,
  ProfilerCollector,
  SCHEMA_ICON,
  tryResolve,
} from '@eleven-labs/nest-profiler';
import type { ColumnInfo, EntitySchema, IndexInfo, RelationInfo } from '@eleven-labs/nest-profiler';
import { MIKRO_ORM_SCHEMA_COLLECTOR_OPTIONS } from './mikro-orm-schema-collector.interface.js';
import type { MikroOrmSchemaCollectorModuleOptions } from './mikro-orm-schema-collector.interface.js';

/** Maps a MikroORM reference kind (`1:1`, `1:m`, …) to the normalized relation vocabulary. */
const RELATION_KIND: Record<string, string> = {
  [ReferenceKind.ONE_TO_ONE]: 'one-to-one',
  [ReferenceKind.ONE_TO_MANY]: 'one-to-many',
  [ReferenceKind.MANY_TO_ONE]: 'many-to-one',
  [ReferenceKind.MANY_TO_MANY]: 'many-to-many',
};

/** Stringifies a MikroORM property type (string literal or a constructor). */
function propType(prop: EntityProperty): string {
  const columnType = prop.columnTypes?.[0];
  if (columnType) return columnType;
  return typeof prop.type === 'function' ? (prop.type as { name: string }).name : String(prop.type);
}

function propDefault(prop: EntityProperty): string | undefined {
  const value = prop.default ?? prop.defaultRaw;
  return value === undefined || value === null ? undefined : String(value);
}

/** Normalizes an index/unique entry — `properties` may be a single key or an array. */
function toIndexInfo(
  index: { name?: string; properties?: string | string[] },
  unique: boolean,
): IndexInfo {
  const properties = index.properties;
  const columns = Array.isArray(properties) ? properties : properties ? [properties] : [];
  return { name: index.name, columns, unique };
}

@Injectable()
@ProfilerCollector({
  name: 'mikro-orm-schema',
  label: 'Schema · MikroORM',
  icon: SCHEMA_ICON,
  priority: 80,
  scope: 'global',
  group: 'database',
  groupLabel: 'Database',
})
export class MikroOrmSchemaCollector extends AbstractSchemaCollector {
  readonly name = 'mikro-orm-schema';
  readonly label = 'Schema · MikroORM';
  readonly group = 'database';
  readonly groupLabel = 'Database';

  constructor(
    private readonly moduleRef: ModuleRef,
    @Optional()
    @Inject(MIKRO_ORM_SCHEMA_COLLECTOR_OPTIONS)
    private readonly options: MikroOrmSchemaCollectorModuleOptions = {},
  ) {
    super();
  }

  protected introspect(): EntitySchema[] | undefined {
    const orm = tryResolve<MikroORM>(
      this.moduleRef,
      this.options.connectionName ? getMikroORMToken(this.options.connectionName) : MikroORM,
    );
    if (!orm) return undefined;

    // `getAll()` returns a Map (MikroORM v7), keyed by entity name.
    const all: EntityMetadata[] = Array.from(orm.getMetadata().getAll().values());
    return all
      .filter((meta) => !meta.abstract && Boolean(meta.className))
      .map((meta) => this.mapEntity(meta));
  }

  private mapEntity(meta: EntityMetadata): EntitySchema {
    const columns: ColumnInfo[] = meta.props
      .filter((prop) => prop.kind === ReferenceKind.SCALAR)
      .map((prop) => this.mapColumn(prop));

    const relations: RelationInfo[] = meta.relations.map((prop) => ({
      property: prop.name,
      kind: RELATION_KIND[prop.kind] ?? prop.kind,
      target: prop.targetMeta?.className ?? String(prop.type),
    }));

    const indexes: IndexInfo[] = [
      ...meta.indexes.map((index) => toIndexInfo(index, false)),
      ...meta.uniques.map((index) => toIndexInfo(index, true)),
    ];

    return {
      name: meta.className,
      tableName: meta.tableName ?? meta.collection ?? meta.className,
      columns,
      relations,
      indexes,
    };
  }

  private mapColumn(prop: EntityProperty): ColumnInfo {
    return {
      name: prop.name,
      databaseName: prop.fieldNames?.[0],
      type: propType(prop),
      nullable: Boolean(prop.nullable),
      primary: Boolean(prop.primary),
      generated: Boolean(prop.autoincrement) || Boolean(prop.generated),
      default: propDefault(prop),
      length: prop.length !== undefined ? String(prop.length) : undefined,
    };
  }
}
