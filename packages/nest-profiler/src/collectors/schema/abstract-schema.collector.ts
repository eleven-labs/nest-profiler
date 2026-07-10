import * as path from 'path';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { IProfilerCollector } from '../collector.interface';
import type { Profile } from '../../interfaces/profile.interface';
import { redactString } from '../../utils/redact.utils';
import type { EntitySchema, SchemaCollectorData } from './schema.interface';

/** Shared table/schema glyph, reused by every ORM's Schema panel. */
export const SCHEMA_ICON = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5v9a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12.5v-9zM3.5 3a.5.5 0 00-.5.5V6h10V3.5a.5.5 0 00-.5-.5h-9zM13 7H3v2.5h10V7zm0 3.5H3v2a.5.5 0 00.5.5h9a.5.5 0 00.5-.5v-2z"/></svg>`;

/**
 * ORM-agnostic base for the global-scope **Schema** collectors.
 *
 * Schema is static process-level data: each subclass introspects its ORM **once** at bootstrap
 * (mirroring {@link ConfigCollector}) into the normalized {@link EntitySchema} shape, and this
 * base owns the shared rendering contract — the entity-count badge, the collapsible
 * `schema-panel.ejs` template, and the `collect()` snapshot. Because it is `scope: 'global'`,
 * the panel renders once on the profiler home page rather than per request.
 *
 * Subclasses supply their decorator metadata (`name`, `label`, `group`, …) and an
 * {@link introspect} implementation that resolves their ORM handle lazily via `ModuleRef`.
 */
export abstract class AbstractSchemaCollector
  implements IProfilerCollector, OnApplicationBootstrap
{
  abstract readonly name: string;
  abstract readonly label: string;
  readonly icon: string = SCHEMA_ICON;
  readonly priority: number = 80;
  readonly scope = 'global' as const;

  /** Cached introspection result — schema is static, captured once at bootstrap. */
  private entities: EntitySchema[] = [];

  onApplicationBootstrap(): void {
    try {
      const found = this.introspect();
      // `undefined` = the ORM handle is absent (app doesn't use this ORM / disabled core):
      // stay silent so the panel simply doesn't appear.
      if (found === undefined) return;
      this.entities = this.redactDefaults(found);
      // Canary: the handle resolved but exposed no entities — likely a private ORM-metadata
      // shape change or a mis-wired connection. Warn so the empty panel is diagnosable.
      if (found.length === 0) {
        new Logger(this.name).warn(
          `Schema panel is empty despite the ORM connection being present — no entities were ` +
            `introspected (check the wired connection / entity registration).`,
        );
      }
    } catch {
      this.entities = [];
    }
  }

  getBadgeValue(_profile: Profile): string | null {
    return this.entities.length > 0 ? `${this.entities.length}` : null;
  }

  getTemplatePath(): string {
    return path.join(__dirname, 'templates', 'schema-panel.ejs');
  }

  collect(_profile: Profile): SchemaCollectorData {
    return { entities: this.entities, entityCount: this.entities.length };
  }

  /**
   * Introspect the ORM's registered entities into the normalized shape. Returns `undefined`
   * when the ORM handle is absent (no panel, no warning), `[]` when the handle is present but
   * exposes no entities (triggers the canary), or the entity list otherwise.
   */
  protected abstract introspect(): EntitySchema[] | undefined;

  /** Masks embedded secrets in string column defaults, consistent with the Config panel. */
  private redactDefaults(entities: EntitySchema[]): EntitySchema[] {
    return entities.map((entity) => ({
      ...entity,
      columns: entity.columns.map((column) =>
        column.default === undefined
          ? column
          : { ...column, default: redactString(column.default) },
      ),
    }));
  }
}
