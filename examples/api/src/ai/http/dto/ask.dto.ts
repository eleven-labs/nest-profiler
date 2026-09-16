import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class AskDto {
  @ApiProperty({
    example: 'Explain what a web profiler is, in two sentences.',
    minLength: 3,
    maxLength: 1000,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(1000)
  prompt!: string;
}
