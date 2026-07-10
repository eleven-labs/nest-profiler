import { ModuleRef } from '@nestjs/core';
import { GraphqlRouteSource } from './graphql-route-source';

interface FakeField {
  name: string;
  args: { name: string }[];
}

function fakeType(name: string, fields: FakeField[]) {
  return { name, getFields: () => Object.fromEntries(fields.map((f) => [f.name, f])) };
}

/** A ModuleRef whose `get(GraphQLSchemaHost)` returns a host exposing the given schema. */
function moduleRefWith(schemaRef: object): ModuleRef {
  return { get: () => ({ schema: schemaRef }) } as unknown as ModuleRef;
}

const schema = {
  getQueryType: () =>
    fakeType('Query', [
      { name: 'users', args: [] },
      { name: 'user', args: [{ name: 'id' }] },
    ]),
  getMutationType: () => fakeType('Mutation', [{ name: 'createUser', args: [{ name: 'input' }] }]),
  getSubscriptionType: () => null,
};

describe('GraphqlRouteSource', () => {
  it('lists query/mutation/subscription fields with their argument names', () => {
    const source = new GraphqlRouteSource(moduleRefWith(schema));
    const group = source.collect();

    expect(group).toMatchObject({ source: 'graphql', label: 'GraphQL' });
    expect(group.routes).toEqual([
      {
        method: 'mutation',
        path: 'createUser',
        controller: 'Mutation',
        handler: 'createUser',
        inputs: { query: ['input'] },
      },
      {
        method: 'query',
        path: 'user',
        controller: 'Query',
        handler: 'user',
        inputs: { query: ['id'] },
      },
      { method: 'query', path: 'users', controller: 'Query', handler: 'users' },
    ]);
  });

  it('caches the group once the schema has been read', () => {
    const getFields = jest.fn(() => ({}));
    const source = new GraphqlRouteSource(
      moduleRefWith({
        getQueryType: () => ({ name: 'Query', getFields }),
        getMutationType: () => null,
        getSubscriptionType: () => null,
      }),
    );
    source.collect();
    source.collect();
    expect(getFields).toHaveBeenCalledTimes(1);
  });

  it('returns an empty group (uncached) while the schema is not yet built', () => {
    let ready = false;
    const moduleRef = {
      get: () => ({
        get schema() {
          if (!ready) throw new Error('GraphQL schema has not yet been created');
          return schema;
        },
      }),
    } as unknown as ModuleRef;
    const source = new GraphqlRouteSource(moduleRef);

    expect(source.collect().routes).toEqual([]);
    ready = true;
    expect(source.collect().routes.length).toBe(3);
  });

  it('returns an empty group when the schema host cannot be resolved', () => {
    const moduleRef = {
      get: () => {
        throw new Error('GraphQLSchemaHost not found');
      },
    } as unknown as ModuleRef;
    const group = new GraphqlRouteSource(moduleRef).collect();
    expect(group.source).toBe('graphql');
    expect(group.label).toBe('GraphQL');
    expect(group.routes).toEqual([]);
    expect(typeof group.icon).toBe('string');
  });
});
