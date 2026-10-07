import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../db/drizzle.module';
import { deviceTokens, type DeviceToken } from '../db/schema';

/**
 * Owns the `device_tokens` table - registration/lookup for push delivery (Phase 7). See
 * `device-tokens.ts`'s own header comment for the token-reassignment-on-re-registration
 * decision this service implements.
 */
@Injectable()
export class DeviceTokensService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /**
   * Registers/refreshes a device token for `userId`. `token` is globally unique, so re-
   * registering an already-known token (same user refreshing it, or a *different* user now
   * holding that device) reassigns the existing row via `onConflictDoUpdate` rather than
   * erroring - see docs/open-items.md.
   */
  async register(userId: string, token: string, platform: 'ANDROID' | 'IOS'): Promise<DeviceToken> {
    const [row] = await this.db
      .insert(deviceTokens)
      .values({ userId, token, platform })
      .onConflictDoUpdate({
        target: deviceTokens.token,
        set: { userId, platform, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  /** No-ops (does not throw) if the token wasn't registered to this user - same "idempotent
   *  unregister" posture a logout flow needs (it shouldn't matter if this is called twice, or
   *  called for a token that was already reassigned to someone else). */
  async unregister(userId: string, token: string): Promise<void> {
    await this.db
      .delete(deviceTokens)
      .where(and(eq(deviceTokens.userId, userId), eq(deviceTokens.token, token)));
  }

  /** Every device token currently registered to `userId` - a user may have more than one. */
  async findTokensForUser(userId: string): Promise<DeviceToken[]> {
    return this.db.select().from(deviceTokens).where(eq(deviceTokens.userId, userId));
  }

  /** Removes a single token row by its own id - used when FCM reports it permanently invalid. */
  async deleteById(id: string): Promise<void> {
    await this.db.delete(deviceTokens).where(eq(deviceTokens.id, id));
  }
}
