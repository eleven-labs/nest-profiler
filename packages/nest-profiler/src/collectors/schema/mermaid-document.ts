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
  label?: string;
  attributes: string[];
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
  const head = block.label ? `${block.id}[${quoted(block.label)}]` : block.id;
  if (block.attributes.length === 0) return [`  ${head}`];
  return [`  ${head} {`, ...block.attributes, '  }'];
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
 * `UK`), a solid line from each document to what it embeds, and a dashed line for every `ref`.
 *
 * Reads the nesting from {@link ColumnInfo.depth} / {@link ColumnInfo.embedded}: columns are listed
 * parent-first, each field of an embedded document one level below the field holding it.
 */
export function toMermaidDocumentDiagram(entities: EntitySchema[]): string {
  const models = entities.map((entity) => token(entity.name));
  const allocate = idAllocator(models);
  const blocks: Block[] = [];
  const embeds: string[] = [];
  const references: string[] = [];

  entities.forEach((entity, i) => {
    const root: Block = { id: models[i] as string, attributes: [] };
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

    for (const column of entity.columns) {
      const depth = Math.min(column.depth ?? 0, stack.length - 1);
      stack.length = depth + 1;
      const owner = stack[depth] as Block;
      owner.attributes.push(attributeLine(column, uniqueColumns, refs.get(column.name)));
      blockOf.set(column.name, owner.id);

      if (!column.embedded) continue;
      const many = column.embedded === 'many';
      const child: Block = {
        id: allocate(`${root.id}_${token(column.name.replace(/\./g, '_'))}`),
        label: `${entity.name}.${column.name}${many ? '[]' : ''}`,
        attributes: [],
      };
      blocks.push(child);
      stack.push(child);
      const marker = many ? '||--o{' : column.nullable ? '||--o|' : '||--||';
      const label = `embeds ${leafName(column)}${many ? '[]' : ''}`;
      embeds.push(`  ${owner.id} ${marker} ${child.id} : ${quoted(label)}`);
    }

    for (const relation of entity.relations) {
      const owner = blockOf.get(relation.property) ?? root.id;
      const many = relation.kind === 'ref[]';
      const leaf = relation.property.slice(relation.property.lastIndexOf('.') + 1);
      const label = `ref ${leaf}${many ? '[]' : ''}`;
      references.push(
        `  ${owner} ${many ? '}o..o{' : '}o..o|'} ${token(relation.target)} : ${quoted(label)}`,
      );
    }
  });

  return ['erDiagram', ...blocks.flatMap(blockLines), ...embeds, ...references].join('\n');
}
