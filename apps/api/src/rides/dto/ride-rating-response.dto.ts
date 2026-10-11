import { ApiProperty } from '@nestjs/swagger';

export class RideRatingResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() rideId!: string;
  @ApiProperty() rating!: number;
  @ApiProperty({ nullable: true, type: String }) comment!: string | null;
  @ApiProperty() createdAt!: Date;
}
