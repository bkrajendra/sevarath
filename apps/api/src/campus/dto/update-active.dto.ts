import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateActiveDto {
  @ApiProperty()
  @IsBoolean()
  isActive!: boolean;
}
