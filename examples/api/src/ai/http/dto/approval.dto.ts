import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class ApprovalDecisionDto {
  @ApiProperty({ example: true, description: 'Whether the operator lets the tool run' })
  @IsBoolean()
  approved!: boolean;
}
