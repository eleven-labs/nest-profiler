import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class Book {
  @Field(() => ID)
  id!: string;

  @Field()
  title!: string;

  @Field()
  author!: string;

  @Field(() => Int, { nullable: true })
  publishedYear?: number;
}
