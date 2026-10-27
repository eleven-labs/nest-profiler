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
  /**
   * Nesting level of a field in a document store: absent (or `0`) for a top-level field, `1` for a
   * field of an embedded document or nested object, and so on. Columns are listed parent-first,
   * so the fields of an embedded document directly follow the column holding it, and their
   * {@link ColumnInfo.name} is the full dotted path (e.g. `items.product`).
   */
  depth?: number;
  /**
   * Set on a field holding embedded data in a document store: `one` for a single embedded
   * document or nested object, `many` for an array of embedded documents. Its own fields follow
   * it, one level deeper.
   */
  embedded?: 'one' | 'many';
  /**
   * Opaque key of the structure an {@link ColumnInfo.embedded} field holds: fields sharing a key
   * embed the same document shape (an address reused for shipping and billing), which the document
   * diagram draws once.
   */
  embeddedShape?: string;
}

/** A relation from an entity to another. */
export interface RelationInfo {
  /** Property holding the relation (e.g. `author`). */
  property: string;
  /**
   * Relation cardinality: `one-to-one` | `one-to-many` | `many-to-one` | `many-to-many`. A
   * document store has no enforced cardinality: its references are `ref` (one id) or `ref[]` (an
   * array of ids).
   */
  kind: string;
  /** Target entity/model name (e.g. `User`). */
  target: string;
  /**
   * Property holding the other side of a bidirectional relation (e.g. `posts` for `author`),
   * when the ORM exposes it. Lets the ER diagram draw both declarations as a single line.
   */
  inverseProperty?: string;
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

/**
 * How a schema is organised, which decides the panel's vocabulary and diagram: `relational`
 * (tables, columns, relations, an entity relationship diagram) or `document` (collections of
 * documents with embedded data and references, a document diagram).
 */
export type SchemaDataModel = 'relational' | 'document';

/** Payload rendered by the Schema panel. */
export interface SchemaCollectorData {
  entities: EntitySchema[];
  entityCount: number;
  /** How the schema is organised. Absent means `relational`. */
  dataModel?: SchemaDataModel;
  /**
   * Mermaid source of the schema, rendered as a diagram in the panel: an entity relationship
   * diagram for the relational ORMs that opt in, a document diagram for a document store. Only
   * set when at least one entity is registered.
   */
  mermaid?: string;
}
