import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

// BUSY is system-set only (by dispatch, once a ride is assigned) - not client-settable.
const SELF_SETTABLE = ['OFFLINE', 'AVAILABLE', 'ON_BREAK'] as const;

export class UpdateAvailabilityDto {
  @ApiProperty({ enum: SELF_SETTABLE })
  @IsIn(SELF_SETTABLE)
  availability!: (typeof SELF_SETTABLE)[number];
}
