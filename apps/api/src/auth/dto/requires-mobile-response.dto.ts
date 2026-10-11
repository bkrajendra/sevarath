import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Returned by POST /auth/login in place of a TokenResponseDto when the Firebase identity has no
 * account yet and no mobile number could be resolved from the token (docs/plan.md §5/10.5) -
 * users.mobile stays NOT NULL/unique, so nothing is created until the client retries with one.
 */
export class RequiresMobileResponseDto {
  @ApiProperty({ example: true })
  requiresMobile!: true;

  @ApiPropertyOptional({ description: "From the Google profile, if present - a UI hint only." })
  name?: string;

  @ApiPropertyOptional({ description: "From the Google profile, if present - a UI hint only." })
  email?: string;
}
