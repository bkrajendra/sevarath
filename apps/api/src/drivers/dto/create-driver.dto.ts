import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MinLength } from 'class-validator';

export class CreateDriverDto {
  @ApiProperty({ description: 'Existing user id (must already exist, e.g. via OTP self-registration)' })
  @IsUUID()
  userId!: string;

  @ApiProperty({ example: 'DRV-001' })
  @IsString()
  @MinLength(1)
  driverCode!: string;
}
