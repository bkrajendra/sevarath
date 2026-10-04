import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({
    example: '+911234567890',
    description: 'E.164-ish mobile number - the primary account identifier',
  })
  @Matches(/^\+?[1-9]\d{7,14}$/, {
    message: 'mobile must be a valid phone number, e.g. +911234567890',
  })
  mobile!: string;

  @ApiPropertyOptional({ example: 'jane@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  password!: string;
}
