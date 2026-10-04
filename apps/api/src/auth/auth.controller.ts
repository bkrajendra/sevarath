import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type * as admin from 'firebase-admin';
import { AuthService } from './auth.service';
import { FirebaseAuthGuard } from './guards/firebase-auth.guard';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { RegisterDto } from './dto/register.dto';
import { PasswordLoginDto } from './dto/password-login.dto';

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
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({ type: TokenResponseDto })
  async login(@Req() req: Request): Promise<TokenResponseDto> {
    const decoded = req.user as admin.auth.DecodedIdToken;
    return this.authService.loginWithFirebaseToken(decoded);
  }

  /** Self-hosted registration - mobile + email + password. No Firebase required. */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiBody({ type: RegisterDto })
  @ApiOkResponse({ type: TokenResponseDto })
  async register(@Body() dto: RegisterDto): Promise<TokenResponseDto> {
    return this.authService.register(dto);
  }

  @Post('login/password')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: PasswordLoginDto })
  @ApiOkResponse({ type: TokenResponseDto })
  async loginWithPassword(@Body() dto: PasswordLoginDto): Promise<TokenResponseDto> {
    return this.authService.loginWithPassword(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TokenResponseDto })
  async refresh(@Body() dto: RefreshDto): Promise<TokenResponseDto> {
    return this.authService.refresh(dto.refreshToken);
  }
}
