import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'Firebase ID token obtained client-side after Phone-OTP or Google Sign-In',
  })
  @IsString()
  @MinLength(10)
  idToken!: string;
}
