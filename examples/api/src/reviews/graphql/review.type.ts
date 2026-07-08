import { Field, GraphQLISODateTime, ID, Int, ObjectType } from '@nestjs/graphql';

/**
 * GraphQL representation of the domain {@link Review}. Kept separate from the domain model and the
 * Mongoose schema so the transport layer never leaks into the domain. Exposed as a `reviews` field
 * on the catalog's `Product` type (see {@link ProductReviewsResolver}).
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

  @Field()
  author!: string;

  @Field()
  status!: string;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}
