import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class LogoutDto {
  @ApiProperty({ description: 'The refresh token to revoke' })
  @IsString()
  @MinLength(10)
  refreshToken!: string;
}
