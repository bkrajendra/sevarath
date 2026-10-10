import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, IsUUID, Matches, MinLength } from 'class-validator';

/**
 * Admin-only "create a driver account from scratch" - unlike CreateDriverDto (which requires an
 * already-existing `users` row, e.g. from self-registration), this creates the user itself with
 * a generated temporary password, so an admin never has to ask a driver to register themselves
 * first. See drivers.service.ts#provision.
 */
export class ProvisionDriverDto {
  @ApiProperty({ example: 'Ravi Kumar' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ example: '+911234567890', description: 'E.164-ish mobile number' })
  @Matches(/^\+?[1-9]\d{7,14}$/, {
    message: 'mobile must be a valid phone number, e.g. +911234567890',
  })
  mobile!: string;

  @ApiPropertyOptional({ example: 'ravi@example.com', description: 'If set, login credentials are emailed here (best-effort)' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ example: 'DRV-001' })
  @IsString()
  @MinLength(1)
  driverCode!: string;

  @ApiPropertyOptional({ description: 'Assign a vehicle to the driver immediately, if already known' })
  @IsOptional()
  @IsUUID()
  vehicleId?: string;
}
