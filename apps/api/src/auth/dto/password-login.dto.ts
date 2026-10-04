import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class PasswordLoginDto {
  @ApiProperty({ example: '+911234567890 or jane@example.com', description: 'Mobile number or email' })
  @IsString()
  @MinLength(3)
  identifier!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  password!: string;
}
