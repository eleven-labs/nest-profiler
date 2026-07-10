import { Inject, Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import {
  AbstractSchemaCollector,
  ProfilerCollector,
  SCHEMA_ICON,
  tryResolve,
} from '@eleven-labs/nest-profiler';
import type { ColumnInfo, EntitySchema, IndexInfo, RelationInfo } from '@eleven-labs/nest-profiler';
import { MONGOOSE_SCHEMA_COLLECTOR_OPTIONS } from './mongoose-schema-collector.interface';
import type { MongooseSchemaCollectorModuleOptions } from './mongoose-schema-collector.interface';

/** The `ref` a schema type carries, if any (a related model name). */
interface RefHolder {
  options?: { ref?: unknown };
}

/** Narrow SchemaType surface — mongoose's public types don't expose `caster`/`options` uniformly. */
interface PathType {
  instance?: string;
  isRequired?: boolean;
  options?: { default?: unknown; ref?: unknown };
  // An array-of-refs stores the element schema type (holding the `ref`) under one of these,
  // depending on the mongoose version (`caster` historically, `embeddedSchemaType` in v8+).
  caster?: RefHolder;
  embeddedSchemaType?: RefHolder;
  $embeddedSchemaType?: RefHolder;
}

/** Minimal Model/Schema surface the collector introspects, avoiding mongoose's deep `any` generics. */
interface IntrospectableModel {
  modelName: string;
  collection: { name: string };
  schema: {
    paths: Record<string, PathType>;
    indexes(): Array<[Record<string, unknown>, Record<string, unknown> | undefined]>;
  };
}

/** The referenced model name declared on a path (`ref`), or on its array element, else undefined. */
function relationRef(path: PathType): string | undefined {
  const ref =
    path.options?.ref ??
    path.caster?.options?.ref ??
    path.embeddedSchemaType?.options?.ref ??
    path.$embeddedSchemaType?.options?.ref;
  return typeof ref === 'string' ? ref : undefined;
}

function pathDefault(path: PathType): string | undefined {
  const value = path.options?.default;
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'function') return '() => …';
  return JSON.stringify(value);
}

@Injectable()
@ProfilerCollector({
  name: 'mongoose-schema',
  label: 'Schema · Mongoose',
  icon: SCHEMA_ICON,
  priority: 80,
  scope: 'global',
  group: 'database',
  groupLabel: 'Database',
})
export class MongooseSchemaCollector extends AbstractSchemaCollector {
  readonly name = 'mongoose-schema';
  readonly label = 'Schema · Mongoose';
  readonly group = 'database';
  readonly groupLabel = 'Database';

  constructor(
    private readonly moduleRef: ModuleRef,
    @Optional()
    @Inject(MONGOOSE_SCHEMA_COLLECTOR_OPTIONS)
    private readonly options: MongooseSchemaCollectorModuleOptions = {},
  ) {
    super();
  }

  protected introspect(): EntitySchema[] | undefined {
    const connection = tryResolve<Connection>(
      this.moduleRef,
      getConnectionToken(this.options.connectionName),
    );
    if (!connection) return undefined;

    const models = Object.values(connection.models) as unknown as IntrospectableModel[];
    return models.map((model) => this.mapModel(model));
  }

  private mapModel(model: IntrospectableModel): EntitySchema {
    const columns: ColumnInfo[] = [];
    const relations: RelationInfo[] = [];

    for (const [name, path] of Object.entries(model.schema.paths)) {
      const ref = relationRef(path);
      if (ref) {
        relations.push({
          property: name,
          kind: path.instance === 'Array' ? 'one-to-many' : 'many-to-one',
          target: ref,
        });
        continue;
      }
      columns.push({
        name,
        type: path.instance ?? 'Mixed',
        nullable: !path.isRequired,
        primary: name === '_id',
        generated: name === '_id',
        default: pathDefault(path),
      });
    }

    return {
      name: model.modelName,
      tableName: model.collection.name,
      columns,
      relations,
      indexes: mapIndexes(model),
    };
  }
}

function mapIndexes(model: IntrospectableModel): IndexInfo[] {
  return model.schema.indexes().map(([fields, options]) => ({
    name: typeof options?.name === 'string' ? options.name : undefined,
    columns: Object.keys(fields ?? {}),
    unique: Boolean(options?.unique),
  }));
}
