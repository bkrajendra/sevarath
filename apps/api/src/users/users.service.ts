import { Inject, Injectable } from '@nestjs/common';
import { eq, or } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/drizzle.module';
import { users, type NewUser, type User } from '../db/schema';

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
    if (email) conditions.push(eq(users.email, email));
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
}
