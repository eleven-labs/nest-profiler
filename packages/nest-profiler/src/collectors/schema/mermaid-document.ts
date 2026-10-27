import { attributeType, token } from './mermaid-er.js';
import type { ColumnInfo, EntitySchema, RelationInfo } from './schema.interface.js';

/**
 * A document store has no foreign keys and enforces no cardinality, so its diagram draws only
 * what the schema actually guarantees:
 *
 * - **Embedding** (solid line): an embedded document lives inside exactly one parent, which holds
 *   one (`||` or `o|`, as the field is required or not) or an array of them (`o{`).
 * - **References** (dashed line): a `ref` is an id the application may `populate()`, never
 *   checked by the database. Any number of documents may hold one (`}o`), and it points at one
 *   document (`o|`) or, for `ref[]`, several (`o{`).
 *
 * The diagram is written in Mermaid's `erDiagram` syntax — the only one with attribute blocks and
 * per-end markers — but none of it reads as a relational schema: no foreign key, and no
 * cardinality beyond the shape of the documents.
 */

/** A drawn block: a model, or one of its embedded documents / nested objects. */
interface Block {
  id: string;
  /** What the block shows: the model name, or the path of the embedded data (`Order.items[]`). */
  label: string;
  /** Whether {@link label} is printed as an alias — a model's block shows its own id. */
  aliased: boolean;
  /** Drawn once for every field embedding the same shape (see {@link ColumnInfo.embeddedShape}). */
  shared: boolean;
  attributes: string[];
}

/** A shape already drawn, and the block each of its fields landed in (by path relative to it). */
interface DrawnShape {
  id: string;
  blockOf: Map<string, string>;
}

/** A shape being drawn: the fields below `prefix` record their block into `shape`. */
interface Recording {
  depth: number;
  prefix: string;
  shape: DrawnShape;
}

/** The field name an attribute shows: the last segment of its dotted path. */
function leafName(column: ColumnInfo): string {
  return column.name.slice(column.name.lastIndexOf('.') + 1);
}

function quoted(value: string): string {
  return `"${value.replace(/"/g, "'")}"`;
}

function attributeLine(
  column: ColumnInfo,
  uniqueColumns: Set<string>,
  ref: RelationInfo | undefined,
): string {
  const root = (column.depth ?? 0) === 0;
  const keys = [root && column.primary && 'PK', uniqueColumns.has(column.name) && 'UK'].filter(
    Boolean,
  );
  const suffix = keys.length > 0 ? ` ${keys.join(', ')}` : '';
  const comment = ref ? ` ${quoted(`ref ${ref.target}`)}` : '';
  return `    ${attributeType(column)} ${token(leafName(column))}${suffix}${comment}`;
}

function blockLines(block: Block): string[] {
  const head = block.aliased ? `${block.id}[${quoted(block.label)}]` : block.id;
  if (block.attributes.length === 0) return [`  ${head}`];
  return [`  ${head} {`, ...block.attributes, '  }'];
}

/**
 * The label of each shape embedded in more than one place: the names of the fields embedding it
 * (`shipping / billing / addresses`), since a reused shape belongs to none of them in particular.
 */
function sharedShapeLabels(entities: EntitySchema[]): Map<string, string> {
  const fields = new Map<string, string[]>();
  for (const column of entities.flatMap((entity) => entity.columns)) {
    if (!column.embedded || !column.embeddedShape) continue;
    const names = fields.get(column.embeddedShape) ?? [];
    names.push(leafName(column));
    fields.set(column.embeddedShape, names);
  }
  const labels = new Map<string, string>();
  for (const [shape, names] of fields) {
    if (names.length > 1) labels.set(shape, [...new Set(names)].join(' / '));
  }
  return labels;
}

/** Hands out block ids, suffixing the rare one that would collide with a model or another block. */
function idAllocator(reserved: Iterable<string>): (wanted: string) => string {
  const used = new Set(reserved);
  return (wanted) => {
    let id = wanted;
    for (let n = 2; used.has(id); n += 1) id = `${wanted}_${n}`;
    used.add(id);
    return id;
  };
}

/**
 * Renders a document store's normalized schema as a Mermaid diagram: one block per model and per
 * embedded document or nested object (their fields, `_id` as `PK`, single-field unique indexes as
 * `UK`), a solid line from each document to what it embeds, and a dashed line for every `ref`. A
 * shape embedded in several places (see {@link ColumnInfo.embeddedShape}) is drawn once, with a
 * solid line from each of them.
 *
 * Reads the nesting from {@link ColumnInfo.depth} / {@link ColumnInfo.embedded}: columns are listed
 * parent-first, each field of an embedded document one level below the field holding it.
 */
export function toMermaidDocumentDiagram(entities: EntitySchema[]): string {
  const models = entities.map((entity) => token(entity.name));
  const allocate = idAllocator(models);
  const sharedLabels = sharedShapeLabels(entities);
  const drawnShapes = new Map<string, DrawnShape>();
  const blocks: Block[] = [];
  const embeds: string[] = [];
  const references = new Set<string>();

  entities.forEach((entity, i) => {
    const root: Block = {
      id: models[i] as string,
      label: entity.name,
      aliased: false,
      shared: false,
      attributes: [],
    };
    blocks.push(root);
    const refs = new Map(entity.relations.map((relation) => [relation.property, relation]));
    const uniqueColumns = new Set(
      entity.indexes
        .filter((index) => index.unique && index.columns.length === 1)
        .map((index) => index.columns[0] as string),
    );
    // The block each field lands in, so a `ref` nested in an embedded document starts from it.
    const blockOf = new Map<string, string>();
    // stack[d] is the block receiving the fields at depth d.
    const stack: Block[] = [root];
    // Shapes drawn here for the first time, recording where their fields land.
    let recording: Recording[] = [];
    // A shape drawn already: its fields are skipped, and mapped onto the blocks drawn the first time.
    let reused: (Recording & { depth: number }) | undefined;

    for (const column of entity.columns) {
      const depth = Math.min(column.depth ?? 0, stack.length - 1);
      if (reused && (column.depth ?? 0) > reused.depth) {
        const relative = column.name.slice(reused.prefix.length);
        blockOf.set(column.name, reused.shape.blockOf.get(relative) ?? reused.shape.id);
        continue;
      }
      reused = undefined;
      stack.length = depth + 1;
      const owner = stack[depth] as Block;
      owner.attributes.push(attributeLine(column, uniqueColumns, refs.get(column.name)));
      blockOf.set(column.name, owner.id);
      recording = recording.filter((shape) => depth > shape.depth);
      for (const shape of recording) {
        shape.shape.blockOf.set(column.name.slice(shape.prefix.length), owner.id);
      }

      if (!column.embedded) continue;
      const many = column.embedded === 'many';
      const leaf = `${leafName(column)}${many ? '[]' : ''}`;
      const marker = many ? '||--o{' : column.nullable ? '||--o|' : '||--||';
      const edgeTo = (target: string): void => {
        embeds.push(`  ${owner.id} ${marker} ${target} : ${quoted(`embeds ${leaf}`)}`);
      };

      const sharedLabel = column.embeddedShape ? sharedLabels.get(column.embeddedShape) : undefined;
      const drawn = column.embeddedShape ? drawnShapes.get(column.embeddedShape) : undefined;
      if (sharedLabel !== undefined && drawn) {
        edgeTo(drawn.id);
        reused = { depth: column.depth ?? 0, prefix: `${column.name}.`, shape: drawn };
        continue;
      }

      const parentLabel = owner.shared ? `(${owner.label})` : owner.label;
      const child: Block = {
        id: allocate(`${root.id}_${token(column.name.replace(/\./g, '_'))}`),
        label: sharedLabel ?? `${parentLabel}.${leaf}`,
        aliased: true,
        shared: sharedLabel !== undefined,
        attributes: [],
      };
      blocks.push(child);
      stack.push(child);
      edgeTo(child.id);
      if (sharedLabel !== undefined && column.embeddedShape) {
        const shape: DrawnShape = { id: child.id, blockOf: new Map() };
        drawnShapes.set(column.embeddedShape, shape);
        recording.push({ depth, prefix: `${column.name}.`, shape });
      }
    }

    for (const relation of entity.relations) {
      const owner = blockOf.get(relation.property) ?? root.id;
      const many = relation.kind === 'ref[]';
      const leaf = relation.property.slice(relation.property.lastIndexOf('.') + 1);
      const label = `ref ${leaf}${many ? '[]' : ''}`;
      // A `ref` inside a shared shape is declared once per field embedding it — drawn once.
      references.add(
        `  ${owner} ${many ? '}o..o{' : '}o..o|'} ${token(relation.target)} : ${quoted(label)}`,
      );
    }
  });

  return ['erDiagram', ...blocks.flatMap(blockLines), ...embeds, ...references].join('\n');
}
