import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver } from '@nestjs/apollo';
import type { ApolloDriverConfig } from '@nestjs/apollo';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import type { Request } from 'express';
import { ProfilerGraphQLModule } from '@eleven-labs/nest-profiler-graphql';
import { BooksModule } from './books/books.module';

@Module({
  imports: [
    ProfilerGraphQLModule.forRoot(),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      introspection: true,
      // Apollo Sandbox playground — available at GET /graphql in dev
      plugins: [ApolloServerPluginLandingPageLocalDefault({ embed: true })],
      // Required for the profiler: exposes the Express request in the GraphQL context
      // so the profiler adapter can retrieve the profile created by the HTTP middleware.
      context: ({ req }: { req: Request }) => ({ req }),
    }),
    BooksModule,
  ],
})
export class AppGraphQLModule {}
