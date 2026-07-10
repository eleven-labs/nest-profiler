/**
 * Normalized, ORM-agnostic description of a registered entity/model, produced by every
 * Schema collector (TypeORM, MikroORM, Mongoose) so the three integrations render through
 * one shared `schema-panel.ejs`. The columns-vs-fields, relation-kind and index vocabularies
 * of the different ORMs collapse into this single shape.
 */

/** A single column/field of an entity. */
export interface ColumnInfo {
  /** Property name on the entity/model (e.g. `createdAt`). */
  name: string;
  /** Physical column name when it differs from the property name. */
  databaseName?: string;
  /** Declared type, normalized to a string (e.g. `varchar`, `int`, `String`, `ObjectId`). */
  type: string;
  nullable: boolean;
  primary: boolean;
  /** `true` when the value is generated (auto-increment, uuid, `@CreateDateColumn`, …). */
  generated: boolean;
  /** Declared default, stringified. Passed through `redactString` so embedded secrets are masked. */
  default?: string;
  /** Declared length/precision when the ORM exposes one (e.g. `255`). */
  length?: string;
}

/** A relation from an entity to another. */
export interface RelationInfo {
  /** Property holding the relation (e.g. `author`). */
  property: string;
  /** Relation cardinality: `one-to-one` | `one-to-many` | `many-to-one` | `many-to-many`. */
  kind: string;
  /** Target entity/model name (e.g. `User`). */
  target: string;
}

/** An index declared on an entity. */
export interface IndexInfo {
  name?: string;
  columns: string[];
  unique: boolean;
}

/** A registered entity/model and its introspected shape. */
export interface EntitySchema {
  /** Entity/model class name (e.g. `Product`). */
  name: string;
  /** Backing table or collection name (e.g. `products`). */
  tableName: string;
  columns: ColumnInfo[];
  relations: RelationInfo[];
  indexes: IndexInfo[];
}

/** Payload rendered by the Schema panel. */
export interface SchemaCollectorData {
  entities: EntitySchema[];
  entityCount: number;
}
