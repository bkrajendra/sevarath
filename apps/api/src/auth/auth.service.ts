import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type * as admin from 'firebase-admin';
import { UsersService } from '../users/users.service';
import type { User } from '../db/schema';
import type { JwtPayload } from './types/jwt-payload.interface';
import type { TokenResponseDto } from './dto/token-response.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Resolves a verified Firebase token to a `users` row.
   *
   * - USER accounts self-provision on first login.
   * - DRIVER/ADMIN/OPERATOR accounts must already exist (created by an Admin); login only
   *   links the Firebase UID to that pre-existing record. See specification.md §3.3.
   */
  async loginWithFirebaseToken(decoded: admin.auth.DecodedIdToken): Promise<TokenResponseDto> {
    const existingByUid = await this.usersService.findByFirebaseUid(decoded.uid);
    if (existingByUid) {
      return this.issueTokens(existingByUid);
    }

    const mobile = decoded.phone_number;
    const email = decoded.email;

    const preProvisioned = await this.usersService.findByMobileOrEmail(mobile, email);
    if (preProvisioned) {
      const linked = await this.usersService.linkFirebaseUid(preProvisioned.id, decoded.uid);
      return this.issueTokens(linked);
    }

    if (!mobile) {
      throw new UnauthorizedException(
        'No account found for this identity and no mobile number was provided to self-provision one',
      );
    }

    const created = await this.usersService.create({
      name: decoded.name ?? mobile,
      mobile,
      email,
      role: 'USER',
      status: 'ACTIVE',
      firebaseUid: decoded.uid,
    });
    return this.issueTokens(created);
  }

  async refresh(refreshToken: string): Promise<TokenResponseDto> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    return this.issueTokens(user);
  }

  private async issueTokens(user: User): Promise<TokenResponseDto> {
    const payload: JwtPayload = { sub: user.id, role: user.role };

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get<string>('JWT_ACCESS_TTL'),
    });

    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get<string>('JWT_REFRESH_TTL'),
    });

    return { accessToken, refreshToken, role: user.role, userId: user.id };
  }
}
