import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { GraphQLSchemaHost } from '@nestjs/graphql';
import type { GraphQLObjectType, GraphQLSchema } from 'graphql';
import type { ProfilerRouteSource, RouteEntry, RouteGroup } from '@eleven-labs/nest-profiler';
import { GRAPHQL_ICON } from './icons';

/**
 * A {@link ProfilerRouteSource} contributing the **Discover / GraphQL** view. It reads the
 * built schema from `@nestjs/graphql`'s public {@link GraphQLSchemaHost} — rather than private
 * resolver metadata — so it works the same for code-first and schema-first setups, and lists every
 * query, mutation and subscription field with its argument names. The schema is only available once
 * the app is initialized, so it is read lazily (and cached) when the panel is rendered.
 *
 * `GraphQLSchemaHost` is provided by `GraphQLModule`, which this collector's dynamic module does not
 * import, so it is resolved from the global scope via {@link ModuleRef} (like the profiler core)
 * rather than constructor injection — a sibling dynamic module's providers are not otherwise visible.
 */
@Injectable()
export class GraphqlRouteSource implements ProfilerRouteSource {
  readonly type = 'graphql';
  private group?: RouteGroup;

  constructor(private readonly moduleRef: ModuleRef) {}

  collect(): RouteGroup {
    if (this.group) return this.group;

    const schema = this.readSchema();
    // No schema yet (not built, or @nestjs/graphql absent) — return an empty group without caching,
    // so a later render picks the schema up once it exists.
    if (!schema)
      return {
        source: 'graphql',
        label: 'GraphQL',
        icon: GRAPHQL_ICON,
        itemLabel: 'field',
        routes: [],
      };

    const routes = [
      ...this.fieldsOf(schema.getQueryType(), 'query'),
      ...this.fieldsOf(schema.getMutationType(), 'mutation'),
      ...this.fieldsOf(schema.getSubscriptionType(), 'subscription'),
    ].sort((a, b) => a.method.localeCompare(b.method) || a.path.localeCompare(b.path));

    this.group = {
      source: 'graphql',
      label: 'GraphQL',
      icon: GRAPHQL_ICON,
      itemLabel: 'field',
      routes,
    };
    return this.group;
  }

  /**
   * Resolves the schema host from the global scope and reads its schema. The host may be absent
   * (GraphQL not configured) and its `schema` getter throws until the app is initialized — both
   * collapse to "not ready yet".
   */
  private readSchema(): GraphQLSchema | undefined {
    try {
      return this.moduleRef.get(GraphQLSchemaHost, { strict: false }).schema;
    } catch {
      return undefined;
    }
  }

  private fieldsOf(type: GraphQLObjectType | null | undefined, operation: string): RouteEntry[] {
    if (!type) return [];
    return Object.values(type.getFields()).map((field): RouteEntry => {
      const args = field.args.map((arg) => ({
        name: arg.name,
        ...(arg.description ? { description: arg.description } : {}),
      }));
      return {
        method: operation,
        path: field.name,
        controller: type.name,
        handler: field.name,
        ...(field.description ? { description: field.description } : {}),
        ...(args.length > 0 ? { inputs: { groups: [{ label: 'Arguments', items: args }] } } : {}),
      };
    });
  }
}
