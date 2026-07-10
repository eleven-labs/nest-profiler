import { Inject, Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';
import type { RelationMetadata } from 'typeorm/metadata/RelationMetadata';
import type { IndexMetadata } from 'typeorm/metadata/IndexMetadata';
import {
  AbstractSchemaCollector,
  ProfilerCollector,
  SCHEMA_ICON,
  tryResolve,
} from '@eleven-labs/nest-profiler';
import type { ColumnInfo, EntitySchema, IndexInfo, RelationInfo } from '@eleven-labs/nest-profiler';
import { TYPEORM_SCHEMA_COLLECTOR_OPTIONS } from './typeorm-schema-collector.interface';
import type { TypeOrmSchemaCollectorModuleOptions } from './typeorm-schema-collector.interface';

/** Stringifies a TypeORM column type (string literal or the constructor function form). */
function columnType(type: ColumnMetadata['type']): string {
  return typeof type === 'function' ? type.name : String(type);
}

/** Stringifies a column default (literal or a `() => value` factory), or `undefined` when none. */
function columnDefault(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'function') return '() => …';
  return JSON.stringify(value);
}

function mapColumn(column: ColumnMetadata): ColumnInfo {
  return {
    name: column.propertyName,
    databaseName: column.databaseName,
    type: columnType(column.type),
    nullable: column.isNullable,
    primary: column.isPrimary,
    generated: Boolean(column.isGenerated),
    default: columnDefault(column.default),
    length: column.length || undefined,
  };
}

function mapRelation(relation: RelationMetadata): RelationInfo {
  return {
    property: relation.propertyName,
    kind: relation.relationType,
    target: relation.inverseEntityMetadata.name,
  };
}

function mapIndex(index: IndexMetadata): IndexInfo {
  return {
    name: index.name,
    columns: index.columns.map((column) => column.propertyName),
    unique: index.isUnique,
  };
}

@Injectable()
@ProfilerCollector({
  name: 'typeorm-schema',
  label: 'Schema · TypeORM',
  icon: SCHEMA_ICON,
  priority: 80,
  scope: 'global',
  group: 'database',
  groupLabel: 'Database',
})
export class TypeOrmSchemaCollector extends AbstractSchemaCollector {
  readonly name = 'typeorm-schema';
  readonly label = 'Schema · TypeORM';
  readonly group = 'database';
  readonly groupLabel = 'Database';

  constructor(
    private readonly moduleRef: ModuleRef,
    @Optional()
    @Inject(TYPEORM_SCHEMA_COLLECTOR_OPTIONS)
    private readonly options: TypeOrmSchemaCollectorModuleOptions = {},
  ) {
    super();
  }

  protected introspect(): EntitySchema[] | undefined {
    const dataSource = tryResolve<DataSource>(
      this.moduleRef,
      getDataSourceToken(this.options.connectionName),
    );
    if (!dataSource?.isInitialized) return undefined;

    return dataSource.entityMetadatas.map((entity) => ({
      name: entity.name,
      tableName: entity.tableName,
      columns: entity.columns.map(mapColumn),
      relations: entity.relations.map(mapRelation),
      indexes: entity.indices.map(mapIndex),
    }));
  }
}
