import { ApiProperty } from '@nestjs/swagger';
import { IsLatitude, IsLongitude, IsOptional, IsString } from 'class-validator';

export class CreateRideDto {
  @ApiProperty()
  @IsLatitude()
  pickupLatitude!: number;

  @ApiProperty()
  @IsLongitude()
  pickupLongitude!: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  pickupLocationName?: string;

  @ApiProperty()
  @IsLatitude()
  destinationLatitude!: number;

  @ApiProperty()
  @IsLongitude()
  destinationLongitude!: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  destinationLocationName?: string;
}
