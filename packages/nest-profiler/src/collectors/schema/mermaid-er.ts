import type { ColumnInfo, EntitySchema, RelationInfo } from './schema.interface';

/**
 * Mermaid crow's-foot notation per edge kind. One-to-many is folded into many-to-one (read
 * from the "many" side) so both sides of a bidirectional relation produce the same edge.
 */
const CARDINALITY: Record<string, string> = {
  'many-to-one': '}o--||',
  'one-to-one': '|o--o|',
  'many-to-many': '}o--o{',
};

/** A relation line, oriented so the two declarations of a bidirectional relation collapse. */
interface Edge {
  left: string;
  right: string;
  kind: string;
  leftProperty?: string;
  rightProperty?: string;
}

/**
 * Mermaid entity/attribute names accept letters, digits, `_` and `-` (attribute types also
 * `(`, `)`, `,`, `[` and `]`); anything else collapses to `_`, and a leading digit gets prefixed.
 */
function token(value: string, extra = ''): string {
  const allowed = new RegExp(`[^A-Za-z0-9_\\-${extra}]`, 'g');
  const safe = value.trim().replace(allowed, '_') || '_';
  return /^[A-Za-z_]/.test(safe) ? safe : `_${safe}`;
}

function attributeType(column: ColumnInfo): string {
  const type = column.length ? `${column.type}(${column.length})` : column.type;
  return token(type, '(),\\[\\]');
}

function attributeLine(column: ColumnInfo, uniqueColumns: Set<string>): string {
  const keys = [column.primary && 'PK', uniqueColumns.has(column.name) && 'UK'].filter(Boolean);
  const suffix = keys.length > 0 ? ` ${keys.join(', ')}` : '';
  return `    ${attributeType(column)} ${token(column.name)}${suffix}`;
}

function entityBlock(entity: EntitySchema): string[] {
  const name = token(entity.name);
  if (entity.columns.length === 0) return [`  ${name}`];
  // A single-column unique index is a unique key; composite ones don't map to one attribute.
  const uniqueColumns = new Set(
    entity.indexes
      .filter((index) => index.unique && index.columns.length === 1)
      .map((index) => index.columns[0] as string),
  );
  return [
    `  ${name} {`,
    ...entity.columns.map((column) => attributeLine(column, uniqueColumns)),
    '  }',
  ];
}

function edgeOf(owner: string, relation: RelationInfo): Edge | undefined {
  const edge: Edge =
    relation.kind === 'one-to-many'
      ? {
          left: relation.target,
          right: owner,
          kind: 'many-to-one',
          leftProperty: relation.inverseProperty,
          rightProperty: relation.property,
        }
      : {
          left: owner,
          right: relation.target,
          kind: relation.kind,
          leftProperty: relation.property,
          rightProperty: relation.inverseProperty,
        };
  if (!(edge.kind in CARDINALITY)) return undefined;

  // Symmetric kinds have no natural orientation: order the ends (entity, then property) so the
  // owning and inverse declarations agree.
  if (edge.kind !== 'many-to-one') {
    const leftKey = `${edge.left}\0${edge.leftProperty ?? ''}`;
    const rightKey = `${edge.right}\0${edge.rightProperty ?? ''}`;
    if (leftKey > rightKey) {
      return {
        left: edge.right,
        right: edge.left,
        kind: edge.kind,
        leftProperty: edge.rightProperty,
        rightProperty: edge.leftProperty,
      };
    }
  }
  return edge;
}

/**
 * The inverse property of `relation`, as declared on it or — when only the other side names
 * it (e.g. a MikroORM `mappedBy` without the matching `inversedBy`) — found on the target.
 */
function inverseOf(
  byName: Map<string, EntitySchema>,
  owner: string,
  relation: RelationInfo,
): string | undefined {
  if (relation.inverseProperty) return relation.inverseProperty;
  return byName
    .get(relation.target)
    ?.relations.find(
      (other) => other.target === owner && other.inverseProperty === relation.property,
    )?.property;
}

function relationLine(edge: Edge): string {
  const label = [edge.leftProperty, edge.rightProperty]
    .filter(Boolean)
    .join(' / ')
    .replace(/"/g, "'");
  return `  ${token(edge.left)} ${CARDINALITY[edge.kind]} ${token(edge.right)} : "${label}"`;
}

/**
 * Renders the normalized schema as a Mermaid `erDiagram`: one block per entity (its columns,
 * with `PK` / `UK` keys) and one line per relation. Both sides of a bidirectional relation
 * (paired through {@link RelationInfo.inverseProperty}) are drawn once, labelled with the two
 * property names; relation kinds outside the four normalized cardinalities are skipped.
 */
export function toMermaidErDiagram(entities: EntitySchema[]): string {
  const lines = ['erDiagram'];
  for (const entity of entities) lines.push(...entityBlock(entity));

  const byName = new Map(entities.map((entity) => [entity.name, entity]));
  const seen = new Set<string>();
  for (const entity of entities) {
    for (const relation of entity.relations) {
      const inverseProperty = inverseOf(byName, entity.name, relation);
      const edge = edgeOf(entity.name, { ...relation, inverseProperty });
      if (!edge) continue;
      const key = [edge.left, edge.right, edge.kind, edge.leftProperty, edge.rightProperty].join(
        '\0',
      );
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(relationLine(edge));
    }
  }
  return lines.join('\n');
}
