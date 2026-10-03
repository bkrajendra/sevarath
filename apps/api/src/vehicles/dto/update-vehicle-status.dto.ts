import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

const STATUSES = ['AVAILABLE', 'IN_SERVICE', 'MAINTENANCE', 'INACTIVE'] as const;

export class UpdateVehicleStatusDto {
  @ApiProperty({ enum: STATUSES })
  @IsIn(STATUSES)
  status!: (typeof STATUSES)[number];
}
