import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/drizzle.module';
import { drivers, vehicles, type Driver } from '../db/schema';
import { UsersService } from '../users/users.service';
import type { CreateDriverDto } from './dto/create-driver.dto';

@Injectable()
export class DriversService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly usersService: UsersService,
  ) {}

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
}
