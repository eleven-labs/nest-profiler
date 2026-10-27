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
import { MONGOOSE_SCHEMA_COLLECTOR_OPTIONS } from './mongoose-schema-collector.interface.js';
import type { MongooseSchemaCollectorModuleOptions } from './mongoose-schema-collector.interface.js';

/** The `ref` a schema type carries, if any (a related model name). */
interface RefHolder {
  instance?: string;
  options?: { ref?: unknown };
}

/** The `paths` of a mongoose Schema — a model's own, or an embedded document's. */
interface IntrospectableSchema {
  paths: Record<string, PathType>;
}

/** Narrow SchemaType surface — mongoose's public types don't expose `caster`/`options` uniformly. */
interface PathType {
  instance?: string;
  isRequired?: boolean;
  options?: { default?: unknown; ref?: unknown };
  // An array stores its element schema type (holding the `ref`, or the element `instance`) under
  // one of these, depending on the mongoose version (`caster` historically, `embeddedSchemaType`
  // in v8+).
  caster?: RefHolder;
  embeddedSchemaType?: RefHolder;
  $embeddedSchemaType?: RefHolder;
  /** The embedded document's schema, on a subdocument (`Embedded`) or a document array. */
  schema?: IntrospectableSchema;
}

/** Minimal Model/Schema surface the collector introspects, avoiding mongoose's deep `any` generics. */
interface IntrospectableModel {
  modelName: string;
  collection: { name: string };
  schema: IntrospectableSchema & {
    indexes(): Array<[Record<string, unknown>, Record<string, unknown> | undefined]>;
  };
}

/**
 * One field of a document, with the fields it nests: an embedded document, an array of them, or
 * a plain nested object (which mongoose flattens into dotted paths, and this tree folds back).
 */
interface FieldNode {
  /** Full dotted path from the document root (e.g. `items.product`). */
  path: string;
  type: string;
  required: boolean;
  default?: string;
  ref?: { target: string; many: boolean };
  embedded?: 'one' | 'many';
  children: FieldNode[];
}

/** Nesting below which embedded schemas are no longer expanded — a guard, not a real-world limit. */
const MAX_DEPTH = 8;

/** The element schema type of an array path, whatever the mongoose version calls it. */
function elementOf(path: PathType): RefHolder | undefined {
  return path.embeddedSchemaType ?? path.$embeddedSchemaType ?? path.caster;
}

/** The referenced model declared on a path (`ref`), or on its array element, else undefined. */
function relationRef(path: PathType): { target: string; many: boolean } | undefined {
  if (typeof path.options?.ref === 'string') {
    return { target: path.options.ref, many: path.instance === 'Array' };
  }
  const ref = elementOf(path)?.options?.ref;
  return typeof ref === 'string' ? { target: ref, many: true } : undefined;
}

/** The displayed type of a leaf path: an array shows its element type (`String[]`). */
function typeOf(path: PathType): string {
  if (path.instance !== 'Array') return path.instance ?? 'Mixed';
  const element = elementOf(path)?.instance;
  return element ? `${element}[]` : 'Array';
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

/**
 * The fields of `schema` as a tree, in declaration order. Embedded schemas are expanded in place;
 * `ancestors` stops a recursive schema (a document embedding its own kind) from expanding forever.
 */
function fieldsOf(
  schema: IntrospectableSchema,
  prefix: string,
  ancestors: Set<IntrospectableSchema>,
): FieldNode[] {
  const roots: FieldNode[] = [];
  // Nested plain objects have no path of their own: they are folded back from their children's.
  const objects = new Map<string, FieldNode>();

  for (const [key, path] of Object.entries(schema.paths)) {
    const segments = key.split('.');
    let siblings = roots;
    for (let i = 1; i < segments.length; i += 1) {
      const objectPath = `${prefix}${segments.slice(0, i).join('.')}`;
      let object = objects.get(objectPath);
      if (!object) {
        object = {
          path: objectPath,
          type: 'Object',
          required: false,
          embedded: 'one',
          children: [],
        };
        objects.set(objectPath, object);
        siblings.push(object);
      }
      siblings = object.children;
    }
    siblings.push(fieldOf(`${prefix}${key}`, path, ancestors));
  }
  return roots;
}

function fieldOf(
  fullPath: string,
  path: PathType,
  ancestors: Set<IntrospectableSchema>,
): FieldNode {
  const field: FieldNode = {
    path: fullPath,
    type: typeOf(path),
    required: Boolean(path.isRequired),
    default: pathDefault(path),
    ref: relationRef(path),
    children: [],
  };
  const embedded = path.schema;
  if (embedded && typeof embedded.paths === 'object') {
    const many = path.instance === 'Array';
    field.type = many ? 'Subdocument[]' : 'Subdocument';
    field.embedded = many ? 'many' : 'one';
    if (!ancestors.has(embedded) && ancestors.size < MAX_DEPTH) {
      const nested = new Set(ancestors).add(embedded);
      field.children = fieldsOf(embedded, `${fullPath}.`, nested);
    }
  }
  return field;
}

/** Flattens the tree parent-first, the way the shared Schema panel lists nested fields. */
function flatten(fields: FieldNode[], depth = 0): Array<{ field: FieldNode; depth: number }> {
  return fields.flatMap((field) => [{ field, depth }, ...flatten(field.children, depth + 1)]);
}

@Injectable()
@ProfilerCollector({
  name: 'mongoose-schema',
  label: 'Mongoose',
  icon: SCHEMA_ICON,
  priority: 80,
  scope: 'global',
  group: 'schema',
  groupLabel: 'Schemas',
})
export class MongooseSchemaCollector extends AbstractSchemaCollector {
  readonly name = 'mongoose-schema';
  readonly label = 'Mongoose';
  readonly group = 'schema';
  readonly groupLabel = 'Schemas';
  protected readonly dataModel = 'document';

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

    for (const { field, depth } of flatten(fieldsOf(model.schema, '', new Set([model.schema])))) {
      const column: ColumnInfo = {
        name: field.path,
        type: field.type,
        nullable: !field.required,
        primary: field.path === '_id',
        // Mongoose generates `_id` on the document and on every embedded document.
        generated: field.path === '_id' || field.path.endsWith('._id'),
        default: field.default,
      };
      if (depth > 0) column.depth = depth;
      if (field.embedded) column.embedded = field.embedded;
      columns.push(column);
      // A reference is a stored id like any other field — listed as one — and an edge to the
      // model it names, with no cardinality: the database never checks it.
      if (field.ref) {
        relations.push({
          property: field.path,
          kind: field.ref.many ? 'ref[]' : 'ref',
          target: field.ref.target,
        });
      }
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
