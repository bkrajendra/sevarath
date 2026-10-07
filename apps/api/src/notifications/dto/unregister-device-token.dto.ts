import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class UnregisterDeviceTokenDto {
  @ApiProperty({ description: 'The FCM registration token to remove for the calling user.' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}
