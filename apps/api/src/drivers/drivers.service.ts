import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/drizzle.module';
import { drivers, vehicles, type Driver } from '../db/schema';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import type { CreateDriverDto } from './dto/create-driver.dto';
import type { ProvisionDriverDto } from './dto/provision-driver.dto';

const SALT_ROUNDS = 10;

/**
 * Generates a random temporary password for an admin-provisioned driver account - meets
 * RegisterDto's own 8-char minimum with plenty of room to spare. Not meant to be memorable
 * (it's shown/copied once in the admin console or emailed, not typed from memory), so there's
 * no need to avoid ambiguous characters the way a human-read-aloud code would.
 */
function generateTemporaryPassword(): string {
  return randomBytes(9).toString('base64url'); // 12 chars, URL-safe alphabet
}

@Injectable()
export class DriversService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Admin-only: creates the driver's `users` row *and* their driver profile in one step, with a
   * generated temporary password - unlike `create()` below, which requires the user to already
   * exist (e.g. via self-registration). This is the direct path specifically so an admin never
   * has to ask a driver to self-register first (docs/open-items.md).
   */
  async provision(dto: ProvisionDriverDto): Promise<{ driver: Driver; temporaryPassword: string; emailSent: boolean }> {
    const existing = await this.usersService.findByMobileOrEmail(dto.mobile, dto.email);
    if (existing) {
      throw new ConflictException('An account with this mobile number or email already exists');
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, SALT_ROUNDS);
    const user = await this.usersService.create({
      name: dto.name,
      mobile: dto.mobile,
      email: dto.email,
      role: 'USER',
      status: 'ACTIVE',
      passwordHash,
    });

    let driver = await this.create({ userId: user.id, driverCode: dto.driverCode });
    if (dto.vehicleId) {
      driver = await this.assignVehicle(driver.id, dto.vehicleId);
    }

    const emailSent = dto.email
      ? await this.mailService.sendDriverCredentials({
          to: dto.email,
          name: dto.name,
          mobile: dto.mobile,
          driverCode: dto.driverCode,
          temporaryPassword,
        })
      : false;

    return { driver, temporaryPassword, emailSent };
  }

  /** Admin-only: provisions a driver profile for an existing user and promotes their role. */
  async create(dto: CreateDriverDto): Promise<Driver> {
    const user = await this.usersService.findById(dto.userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const [driver] = await this.db
      .insert(drivers)
      .values({ userId: dto.userId, driverCode: dto.driverCode })
      .returning();

    await this.usersService.updateRole(dto.userId, 'DRIVER');
    return driver;
  }

  async findAll(): Promise<Driver[]> {
    return this.db.select().from(drivers);
  }

  async findById(id: string): Promise<Driver> {
    const [driver] = await this.db.select().from(drivers).where(eq(drivers.id, id));
    if (!driver) {
      throw new NotFoundException('Driver not found');
    }
    return driver;
  }

  async findByUserId(userId: string): Promise<Driver> {
    const [driver] = await this.db.select().from(drivers).where(eq(drivers.userId, userId));
    if (!driver) {
      throw new NotFoundException('Driver profile not found for this user');
    }
    return driver;
  }

  async approve(id: string): Promise<Driver> {
    return this.setStatus(id, 'ACTIVE');
  }

  async suspend(id: string): Promise<Driver> {
    return this.setStatus(id, 'SUSPENDED');
  }

  private async setStatus(id: string, status: Driver['status']): Promise<Driver> {
    await this.findById(id);
    const [driver] = await this.db
      .update(drivers)
      .set({ status, updatedAt: new Date() })
      .where(eq(drivers.id, id))
      .returning();
    return driver;
  }

  async assignVehicle(id: string, vehicleId: string): Promise<Driver> {
    await this.findById(id);
    const [vehicle] = await this.db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }

    const [driver] = await this.db
      .update(drivers)
      .set({ currentVehicleId: vehicleId, updatedAt: new Date() })
      .where(eq(drivers.id, id))
      .returning();
    return driver;
  }

  /** Driver self-service: toggle own availability. Requires an ACTIVE driver profile. */
  async updateAvailabilityForUser(
    userId: string,
    availability: Driver['availability'],
  ): Promise<Driver> {
    const driver = await this.findByUserId(userId);

    if (driver.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Driver must be ACTIVE to change availability (currently ${driver.status})`,
      );
    }

    const [updated] = await this.db
      .update(drivers)
      .set({ availability, updatedAt: new Date() })
      .where(eq(drivers.id, driver.id))
      .returning();
    return updated;
  }

  /**
   * Driver self-service: push a coarse lat/lng snapshot (open-items.md #2 - plain columns, no
   * PostGIS/Redis live pipeline yet). Resolves the caller's own driver profile first, same
   * pattern as updateAvailabilityForUser, so a driver can never push a location for someone
   * else's profile.
   */
  async updateLocationForUser(userId: string, latitude: number, longitude: number): Promise<Driver> {
    const driver = await this.findByUserId(userId);

    const [updated] = await this.db
      .update(drivers)
      .set({
        currentLatitude: latitude,
        currentLongitude: longitude,
        locationUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(drivers.id, driver.id))
      .returning();
    return updated;
  }
}
