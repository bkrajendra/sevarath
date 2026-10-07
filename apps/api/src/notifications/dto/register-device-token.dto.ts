import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class RegisterDeviceTokenDto {
  @ApiProperty({ description: 'The FCM registration token for this device.' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ enum: ['ANDROID', 'IOS'] })
  @IsIn(['ANDROID', 'IOS'])
  platform!: 'ANDROID' | 'IOS';
}
