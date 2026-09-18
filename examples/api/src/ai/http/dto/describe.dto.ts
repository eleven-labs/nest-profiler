import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

const MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

export class DescribeDto {
  @ApiProperty({ example: 'What is in this picture?', minLength: 3, maxLength: 1000 })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(1000)
  prompt!: string;

  @ApiProperty({
    example: 'https://www.gstatic.com/webp/gallery/1.jpg',
  })
  @IsUrl()
  url!: string;

  @ApiPropertyOptional({ example: 'image/jpeg', enum: MEDIA_TYPES })
  @IsIn(MEDIA_TYPES)
  @IsOptional()
  mediaType?: string;
}
