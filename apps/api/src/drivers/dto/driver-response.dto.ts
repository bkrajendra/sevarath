import { ApiProperty } from '@nestjs/swagger';

export class DriverResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() userId!: string;
  @ApiProperty() driverCode!: string;
  @ApiProperty({ enum: ['PENDING', 'ACTIVE', 'SUSPENDED', 'INACTIVE'] })
  status!: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
  @ApiProperty({ enum: ['OFFLINE', 'AVAILABLE', 'BUSY', 'ON_BREAK'] })
  availability!: 'OFFLINE' | 'AVAILABLE' | 'BUSY' | 'ON_BREAK';
  @ApiProperty({ nullable: true, type: String }) currentVehicleId!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
