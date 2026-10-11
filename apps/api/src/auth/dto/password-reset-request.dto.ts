import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class PasswordResetRequestDto {
  @ApiProperty({ example: '+911234567890 or jane@example.com', description: 'Mobile number or email' })
  @IsString()
  @MinLength(3)
  identifier!: string;
}
