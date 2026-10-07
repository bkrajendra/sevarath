import { ApiProperty } from '@nestjs/swagger';

export class DeviceTokenResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() userId!: string;
  @ApiProperty() token!: string;
  @ApiProperty({ enum: ['ANDROID', 'IOS'] })
  platform!: 'ANDROID' | 'IOS';
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
