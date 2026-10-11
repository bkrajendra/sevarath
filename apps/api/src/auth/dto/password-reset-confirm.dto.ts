import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MinLength } from 'class-validator';

export class PasswordResetConfirmDto {
  @ApiProperty({ example: '+911234567890 or jane@example.com', description: 'Mobile number or email' })
  @IsString()
  @MinLength(3)
  identifier!: string;

  @ApiProperty({ example: '123456', description: 'The 6-digit code emailed to the account' })
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit number' })
  code!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'newPassword must be at least 8 characters' })
  newPassword!: string;
}
