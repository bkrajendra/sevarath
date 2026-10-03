import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AssignVehicleDto {
  @ApiProperty()
  @IsUUID()
  vehicleId!: string;
}
