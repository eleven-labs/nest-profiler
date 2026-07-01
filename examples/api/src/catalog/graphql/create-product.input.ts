import { Field, Float, InputType } from '@nestjs/graphql';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * GraphQL input mirroring the domain `NewProduct` shape. The class-validator decorators are picked
 * up by the global validation pipe, so invalid mutations surface in the Validator panel.
 */
@InputType()
export class CreateProductInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @Field(() => Float)
  @IsNumber()
  @Min(0)
  price!: number;

  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @Field({ nullable: true })
  @IsBoolean()
  @IsOptional()
  inStock?: boolean;
}
