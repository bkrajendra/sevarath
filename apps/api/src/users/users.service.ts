import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/drizzle.module';
import { users, type NewUser, type User } from '../db/schema';
import type { ListUsersQueryDto } from './dto/list-users-query.dto';

@Injectable()
export class UsersService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async findById(id: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async findByFirebaseUid(firebaseUid: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.firebaseUid, firebaseUid));
    return user;
  }

  async findByMobileOrEmail(mobile?: string, email?: string): Promise<User | undefined> {
    if (!mobile && !email) return undefined;
    const conditions = [];
    if (mobile) conditions.push(eq(users.mobile, mobile));
    // Email match is case-insensitive - Firebase/Google may return different casing
    // than however an admin originally typed it in when pre-provisioning the account.
    if (email) conditions.push(ilike(users.email, email));
    const [user] = await this.db
      .select()
      .from(users)
      .where(or(...conditions));
    return user;
  }

  async linkFirebaseUid(userId: string, firebaseUid: string): Promise<User> {
    const [user] = await this.db
      .update(users)
      .set({ firebaseUid, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async updateRole(userId: string, role: User['role']): Promise<User> {
    const [user] = await this.db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async create(data: NewUser): Promise<User> {
    const [user] = await this.db.insert(users).values(data).returning();
    return user;
  }

  /**
   * ADMIN-only account search (users.controller.ts's GET /api/v1/users - this resource's own
   * collection endpoint, same as GET /drivers / GET /vehicles on their own controllers, not an
   * /admin-prefixed route - see docs/open-items.md). `search` reuses the same case-insensitive
   * `ilike` pattern findByMobileOrEmail already uses, against name/mobile/email.
   */
  async search(query: ListUsersQueryDto): Promise<{ items: User[]; total: number }> {
    const conditions = [];
    if (query.role) conditions.push(eq(users.role, query.role));
    if (query.search) {
      const pattern = `%${query.search}%`;
      conditions.push(or(ilike(users.name, pattern), ilike(users.mobile, pattern), ilike(users.email, pattern)));
    }

    // and(...[]) is undefined in drizzle-orm, and .where(undefined) is a no-op.
    const where = and(...conditions);

    const [items, totalRows] = await Promise.all([
      this.db
        .select()
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt))
        .limit(query.limit)
        .offset(query.offset),
      this.db.select({ count: sql<string>`count(*)` }).from(users).where(where),
    ]);

    return { items, total: Number(totalRows[0]?.count ?? 0) };
  }
}
