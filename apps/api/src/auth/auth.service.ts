import { ConflictException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import type * as admin from 'firebase-admin';
import { UsersService } from '../users/users.service';
import { DRIZZLE, type DrizzleDb } from '../db/drizzle.module';
import { refreshTokens, type RefreshToken, type User } from '../db/schema';
import type { JwtPayload } from './types/jwt-payload.interface';
import type { TokenResponseDto } from './dto/token-response.dto';
import type { RegisterDto } from './dto/register.dto';
import type { PasswordLoginDto } from './dto/password-login.dto';

const SALT_ROUNDS = 10;

/**
 * Generic rejection used for every refresh-token failure mode (bad signature, expired, unknown
 * to `refresh_tokens`, already revoked, DB-level expiry) - deliberately the same message for
 * all of them so a caller can't use the response to probe *why* a token is invalid (same
 * "don't leak which case it is" posture `loginWithPassword` already uses for credentials).
 */
const INVALID_REFRESH_TOKEN_MESSAGE = 'Invalid or expired refresh token';

/**
 * SHA-256 hex digest of the raw refresh JWT string - see docs/open-items.md for why this is
 * plain `crypto.createHash`, not `bcrypt`, unlike `users.passwordHash`: the refresh token is
 * already a high-entropy signed secret (not a guessable password), so it needs an indexed exact
 * -match lookup (`refresh_tokens.token_hash` is a unique index), not a slow, randomly-salted KDF
 * that would force a linear `bcrypt.compare` scan over every row to find a match.
 */
function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
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
      this.logger.warn(
        `No user matched Firebase identity (uid=${decoded.uid}, email=${email ?? 'none'}, mobile=none) - rejecting login`,
      );
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

  /**
   * Self-hosted mobile/email + password registration - the primary sign-up
   * path for now. Firebase/OTP (loginWithFirebaseToken above) stays wired up
   * as a dormant, optional path; see docs/architecture.md §9.4.
   */
  async register(dto: RegisterDto): Promise<TokenResponseDto> {
    const existing = await this.usersService.findByMobileOrEmail(dto.mobile, dto.email);
    if (existing) {
      throw new ConflictException('An account with this mobile number or email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const created = await this.usersService.create({
      name: dto.name,
      mobile: dto.mobile,
      email: dto.email,
      role: 'USER',
      status: 'ACTIVE',
      passwordHash,
    });
    return this.issueTokens(created);
  }

  async loginWithPassword(dto: PasswordLoginDto): Promise<TokenResponseDto> {
    const user = await this.usersService.findByMobileOrEmail(dto.identifier, dto.identifier);
    // Same message whether the account doesn't exist, has no password set
    // (Firebase-only), or the password is wrong - don't leak which case it is.
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid mobile/email or password');
    }

    const matches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Invalid mobile/email or password');
    }

    return this.issueTokens(user);
  }

  /**
   * Verifies the presented refresh JWT, then rotates it: the old `refresh_tokens` row is
   * revoked and a brand-new access/refresh pair is issued and recorded, atomically. See
   * docs/open-items.md for the full reasoning behind every branch below.
   */
  async refresh(refreshToken: string): Promise<TokenResponseDto> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    const tokenHash = hashRefreshToken(refreshToken);
    const [row] = await this.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash));

    if (!row) {
      // Signature/expiry verified fine, but this token was never recorded (or was recorded by
      // a pre-migration deployment that has no DB row at all - see docs/open-items.md). Reject
      // the same way as every other invalid-token case; don't distinguish it in the response.
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    if (row.revokedAt) {
      // Reuse detected: someone is presenting a refresh token that has already been rotated
      // away (or logged out). This is the actual theft signal rotation exists to catch - a
      // legitimate client only ever has its *latest* refresh token, so presenting an older,
      // already-revoked one means either a stale client race (rare) or a leaked token being
      // replayed by an attacker (the case this must be conservative about). Revoke every
      // currently-active session for this user, not just this one rotation chain - see
      // docs/open-items.md for why "revoke the whole user" was chosen over "revoke just this
      // chain".
      this.logger.warn(
        `Refresh token reuse detected for userId=${row.userId} (tokenId=${row.id}) - revoking all active sessions for this user`,
      );
      await this.revokeAllForUser(row.userId);
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    if (row.expiresAt.getTime() <= Date.now()) {
      // Defense in depth alongside the JWT's own `exp` check above, which should already have
      // thrown via `verifyAsync` before execution ever reaches here - this branch exists so a
      // DB-level expiry can never be the single point of failure, but in practice it should be
      // unreachable; see docs/open-items.md.
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    return this.db.transaction(async (tx) => {
      const { tokens, newRowId } = await this.signAndRecord(user, tx);

      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date(), replacedByTokenId: newRowId })
        .where(eq(refreshTokens.id, row.id));

      return tokens;
    });
  }

  /**
   * Logout: revokes the `refresh_tokens` row matching the presented token, if one exists and
   * isn't already revoked. Idempotent and never throws on an unknown/already-invalid token -
   * see docs/open-items.md for why (an error response here would let a caller use this endpoint
   * to probe token validity).
   */
  async revoke(refreshToken: string): Promise<void> {
    const tokenHash = hashRefreshToken(refreshToken);
    const [row] = await this.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash));
    if (!row || row.revokedAt) {
      return;
    }
    await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, row.id));
  }

  private async revokeAllForUser(userId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.userId, userId));
  }

  /**
   * Signs a fresh access+refresh pair and records the refresh token in `refresh_tokens` - every
   * refresh token this app ever issues (initial login/register, Firebase login, and every
   * rotation) goes through this one method, so a refresh JWT that was never recorded here can
   * never be treated as currently valid.
   */
  private async issueTokens(user: User): Promise<TokenResponseDto> {
    const { tokens } = await this.signAndRecord(user, this.db);
    return tokens;
  }

  /**
   * The actual sign+insert, factored out of `issueTokens` so `refresh()` can run it inside its
   * own transaction (`dbOrTx` is then a transaction handle, not `this.db`) and also get back the
   * new row's id, needed to set the old row's `replacedByTokenId`.
   */
  private async signAndRecord(
    user: User,
    dbOrTx: DrizzleDb,
  ): Promise<{ tokens: TokenResponseDto; newRowId: string }> {
    const payload: JwtPayload = { sub: user.id, role: user.role };

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get<string>('JWT_ACCESS_TTL'),
    });

    // The refresh token payload carries a random `jti` on top of the base payload - without
    // one, two refresh tokens signed for the same user within the same second (same `sub`,
    // `role`, `iat`, `exp` - e.g. two near-simultaneous logins, or two rotations racing) would
    // be byte-identical JWT strings, which would collide on `refresh_tokens.token_hash`'s
    // unique index (found by this task's own e2e suite, not theorized - two login/password
    // calls in the same test run same-second). `jti` is otherwise unused (not re-validated on
    // refresh - the DB-level `tokenHash` lookup already is the identity check).
    const refreshToken = await this.jwtService.signAsync(
      { ...payload, jti: randomUUID() },
      {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>('JWT_REFRESH_TTL'),
      },
    );

    // Compute expiresAt from the signed JWT's own `exp` claim, not by hand-parsing
    // JWT_REFRESH_TTL's string format - see docs/open-items.md / refresh-tokens.ts's doc
    // comment.
    const decoded = this.jwtService.decode<{ exp: number }>(refreshToken);
    const expiresAt = new Date(decoded.exp * 1000);

    const inserted: RefreshToken[] = await dbOrTx
      .insert(refreshTokens)
      .values({ userId: user.id, tokenHash: hashRefreshToken(refreshToken), expiresAt })
      .returning();
    const row = inserted[0];
    if (!row) {
      throw new Error('Failed to record issued refresh token');
    }

    return {
      tokens: { accessToken, refreshToken, role: user.role, userId: user.id },
      newRowId: row.id,
    };
  }
}
