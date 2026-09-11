import { Field, GraphQLISODateTime, ID, Int, ObjectType } from '@nestjs/graphql';

/**
 * GraphQL representation of the domain {@link Review}. Kept separate from the domain model and the
 * Mongoose schema so the transport layer never leaks into the domain. Exposed as a `reviews` field
 * on the catalog's `Product` type (see {@link ProductReviewsResolver}). The `author` field is not
 * declared here: it is resolved over HTTP by {@link ReviewAuthorResolver} from `authorId`.
 */
@ObjectType('Review')
export class ReviewType {
  @Field(() => ID)
  id!: string;

  @Field()
  productId!: string;

  @Field(() => Int)
  rating!: number;

  @Field()
  comment!: string;

  @Field(() => Int, { description: 'Id of the author in the external user directory' })
  authorId!: number;

  @Field()
  status!: string;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}
