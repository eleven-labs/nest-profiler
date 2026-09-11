import { Field, Int, ObjectType } from '@nestjs/graphql';

/**
 * GraphQL representation of a {@link Reviewer} — the review author as the external user directory
 * describes it. It is not a MongoDB document: every field here comes from an HTTP call made while
 * the query is being resolved (see {@link ReviewAuthorResolver}).
 */
@ObjectType('ReviewAuthor')
export class ReviewAuthorType {
  @Field(() => Int)
  id!: number;

  @Field()
  name!: string;

  @Field()
  username!: string;

  @Field()
  company!: string;
}
