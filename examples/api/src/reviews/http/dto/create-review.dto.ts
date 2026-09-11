import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateReviewDto {
  @ApiProperty({
    example: '64a1b2c3d4e5f6789abcdef0',
    description: 'MongoDB ObjectId of the product',
  })
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({ example: 4, minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiProperty({ example: 'Great product, highly recommended!' })
  @IsString()
  @IsNotEmpty()
  comment!: string;

  @ApiProperty({
    example: 1,
    minimum: 1,
    maximum: 10,
    description: 'Id of the author in the external user directory',
  })
  @IsInt()
  @Min(1)
  @Max(10)
  authorId!: number;

  @ApiPropertyOptional({ example: 'approved', enum: ['pending', 'approved'], default: 'pending' })
  @IsIn(['pending', 'approved'])
  @IsOptional()
  status?: 'pending' | 'approved';
}
