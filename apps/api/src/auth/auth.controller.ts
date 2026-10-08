import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type * as admin from 'firebase-admin';
import { AuthService } from './auth.service';
import { FirebaseAuthGuard } from './guards/firebase-auth.guard';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { LogoutDto } from './dto/logout.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { RegisterDto } from './dto/register.dto';
import { PasswordLoginDto } from './dto/password-login.dto';

/**
 * Stricter-than-global rate limit for this controller's unauthenticated,
 * brute-force/credential-stuffing-prone endpoints (login, password login, register) - see
 * docs/open-items.md. 5 requests/minute per IP: generous enough that a real user mistyping a
 * password a couple of times, or a mobile client's own retry-on-timeout logic, won't get
 * falsely blocked, tight enough to make scripted guessing meaningfully slower. Overrides (does
 * not add to) the global default from `ThrottlerModule.forRoot` in app.module.ts, since both
 * configs use the same (unnamed -> 'default') throttler name.
 */
const AUTH_BRUTE_FORCE_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Exchanges a Firebase ID token (obtained client-side after Phone-OTP or Google
   * Sign-In - see architecture.md §9.4) for this app's own access/refresh JWT pair.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(FirebaseAuthGuard)
  @Throttle(AUTH_BRUTE_FORCE_THROTTLE)
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({ type: TokenResponseDto })
  async login(@Req() req: Request): Promise<TokenResponseDto> {
    const decoded = req.user as admin.auth.DecodedIdToken;
    return this.authService.loginWithFirebaseToken(decoded);
  }

  /** Self-hosted registration - mobile + email + password. No Firebase required. */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle(AUTH_BRUTE_FORCE_THROTTLE)
  @ApiBody({ type: RegisterDto })
  @ApiOkResponse({ type: TokenResponseDto })
  async register(@Body() dto: RegisterDto): Promise<TokenResponseDto> {
    return this.authService.register(dto);
  }

  @Post('login/password')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_BRUTE_FORCE_THROTTLE)
  @ApiBody({ type: PasswordLoginDto })
  @ApiOkResponse({ type: TokenResponseDto })
  async loginWithPassword(@Body() dto: PasswordLoginDto): Promise<TokenResponseDto> {
    return this.authService.loginWithPassword(dto);
  }

  /**
   * Left at the global default limit (100/min, app.module.ts), not the stricter
   * AUTH_BRUTE_FORCE_THROTTLE above - this endpoint already requires a valid, previously-issued
   * refresh token, so it's a much weaker brute-force/credential-stuffing target than
   * login/register (an attacker guessing refresh tokens has to guess a high-entropy signed JWT,
   * not a short password) - see docs/open-items.md.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TokenResponseDto })
  async refresh(@Body() dto: RefreshDto): Promise<TokenResponseDto> {
    return this.authService.refresh(dto.refreshToken);
  }

  /**
   * Revokes the presented refresh token server-side (see docs/open-items.md). No guard - same
   * posture as `/auth/refresh`: it authenticates via possession of the token itself, not a
   * bearer access token (the access token may well have already expired by the time a client
   * logs out, and shouldn't need to be refreshed just to call this). `204 No Content`, matching
   * `DeviceTokensController#unregister`'s convention for a no-meaningful-response-body mutating
   * endpoint. Idempotent: an already-revoked or unrecognized token still 204s - see
   * `AuthService#revoke`'s doc comment for why an error response here would be a probe vector.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBody({ type: LogoutDto })
  @ApiNoContentResponse()
  async logout(@Body() dto: LogoutDto): Promise<void> {
    await this.authService.revoke(dto.refreshToken);
  }
}
