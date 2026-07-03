import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver } from '@nestjs/apollo';
import type { ApolloDriverConfig } from '@nestjs/apollo';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import type { Request } from 'express';
import { ProfilerGraphQLModule } from '@eleven-labs/nest-profiler-graphql';
import { isProfilerEnabled } from '../../config/profiler.config.js';

/**
 * GraphQL transport for the catalog context. Sets up the Apollo driver and the profiler GraphQL
 * adapter; the `ProductResolver` (declared in `CatalogModule`) is discovered by the auto-schema
 * scan. Imported by `CatalogModule` only when `FEATURE_GRAPHQL` is on — and works over any catalog
 * persistence adapter, including the zero-infrastructure in-memory one.
 */
@Module({
  imports: [
    ConditionalModule.registerWhen(ProfilerGraphQLModule.forRoot(), isProfilerEnabled),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      introspection: true,
      playground: false,
      // Apollo Sandbox playground — available at GET /graphql in dev.
      plugins: [
        ApolloServerPluginLandingPageLocalDefault({ embed: true }),
      ] as ApolloDriverConfig['plugins'],
      // Required for the profiler: exposes the Express request in the GraphQL context
      // so the profiler adapter can retrieve the profile created by the HTTP middleware.
      context: ({ req }: { req: Request }) => ({ req }),
    }),
  ],
})
export class CatalogGraphQLModule {}
