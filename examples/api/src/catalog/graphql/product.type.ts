import { Field, Float, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';

/**
 * GraphQL representation of the domain {@link Product}. Kept separate from the domain model and the
 * ORM entities so the transport layer never leaks into the domain.
 */
@ObjectType('Product')
export class ProductType {
  @Field(() => ID)
  id!: number;

  @Field()
  name!: string;

  @Field(() => Float)
  price!: number;

  @Field({ nullable: true })
  description?: string;

  @Field(() => Boolean)
  inStock!: boolean;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}
