import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver } from '@nestjs/apollo';
import type { ApolloDriverConfig } from '@nestjs/apollo';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import type { Request } from 'express';
import {
  GraphQLCollectorModule,
  createProfilerFieldMiddleware,
} from '@eleven-labs/nest-profiler-graphql';
import { isProfilerEnabled } from '../../config/profiler.config.js';

/**
 * GraphQL transport for the catalog context. Sets up the Apollo driver and the profiler GraphQL
 * adapter; the `ProductResolver` (declared in `CatalogModule`) is discovered by the auto-schema
 * scan. Imported by `CatalogModule` only when `FEATURE_GRAPHQL` is on — and works over any catalog
 * persistence adapter, including the zero-infrastructure in-memory one.
 */
@Module({
  imports: [
    ConditionalModule.registerWhen(GraphQLCollectorModule.forRoot(), isProfilerEnabled),
    // forRootAsync (not forRoot): the field middleware is decided in the factory, which runs
    // once the .env is loaded. A sync forRoot evaluates buildSchemaOptions too early — before
    // the config — so the profiler-enabled flag would not yet be reliable there.
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      useFactory: () => ({
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
        // Times each resolveField and nests its DB/HTTP calls under it — but only wired when the
        // profiler is on, so graphql-js runs nothing per field otherwise (it invokes every
        // registered field middleware for each resolved field, even a profiler-off passthrough).
        buildSchemaOptions: {
          fieldMiddleware: isProfilerEnabled(process.env) ? [createProfilerFieldMiddleware()] : [],
        },
      }),
    }),
  ],
})
export class CatalogGraphQLModule {}
