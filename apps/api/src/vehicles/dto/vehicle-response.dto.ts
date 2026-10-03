import { ApiProperty } from '@nestjs/swagger';

export class VehicleResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() vehicleCode!: string;
  @ApiProperty({ nullable: true, type: String }) registrationNumber!: string | null;
  @ApiProperty() vehicleType!: string;
  @ApiProperty() capacity!: number;
  @ApiProperty({ enum: ['AVAILABLE', 'IN_SERVICE', 'MAINTENANCE', 'INACTIVE'] })
  status!: 'AVAILABLE' | 'IN_SERVICE' | 'MAINTENANCE' | 'INACTIVE';
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
