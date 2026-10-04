import { ApiProperty } from '@nestjs/swagger';

export class CampusLocationResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({
    enum: [
      'GATE',
      'BUILDING',
      'OFFICE',
      'RESIDENCE',
      'DINING',
      'PARKING',
      'EV_STOP',
      'MEDICAL',
      'RECEPTION',
      'OTHER',
    ],
  })
  type!: string;
  @ApiProperty() latitude!: number;
  @ApiProperty() longitude!: number;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
