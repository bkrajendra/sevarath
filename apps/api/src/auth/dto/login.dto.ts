import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'Firebase ID token obtained client-side after Phone-OTP or Google Sign-In',
  })
  @IsString()
  @MinLength(10)
  idToken!: string;

  @ApiPropertyOptional({
    example: '+911234567890',
    description:
      'Only needed on a retry when the first call returned `requiresMobile: true` (docs/plan.md ' +
      '§5/10.5) - a brand-new Google identity with no mobile number resolvable from the token.',
  })
  @IsOptional()
  @Matches(/^\+?[1-9]\d{7,14}$/, { message: 'mobile must be a valid phone number, e.g. +911234567890' })
  mobile?: string;
}
