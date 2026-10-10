import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/drizzle.module';
import { vehicles, type NewVehicle, type Vehicle } from '../db/schema';
import type { CreateVehicleDto } from './dto/create-vehicle.dto';
import type { UpdateVehicleDto } from './dto/update-vehicle.dto';

/** Postgres error code for a unique-constraint violation (pg driver's DatabaseError.code). */
const UNIQUE_VIOLATION = '23505';

@Injectable()
export class VehiclesService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async create(dto: CreateVehicleDto): Promise<Vehicle> {
    const data: NewVehicle = {
      vehicleCode: dto.vehicleCode,
      registrationNumber: dto.registrationNumber,
      vehicleType: dto.vehicleType ?? 'EV',
      capacity: dto.capacity ?? 4,
    };
    const [vehicle] = await this.db.insert(vehicles).values(data).returning();
    return vehicle;
  }

  async findAll(): Promise<Vehicle[]> {
    return this.db.select().from(vehicles);
  }

  async findById(id: string): Promise<Vehicle> {
    const [vehicle] = await this.db.select().from(vehicles).where(eq(vehicles.id, id));
    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }
    return vehicle;
  }

  async updateStatus(id: string, status: Vehicle['status']): Promise<Vehicle> {
    await this.findById(id);
    const [vehicle] = await this.db
      .update(vehicles)
      .set({ status, updatedAt: new Date() })
      .where(eq(vehicles.id, id))
      .returning();
    return vehicle;
  }

  /**
   * Admin-only edit: vehicleCode/registrationNumber/vehicleType/capacity. `status` stays on its
   * own dedicated endpoint above. `vehicle_code` has a unique index (db/schema/vehicles.ts)
   * with no existing conflict handling in this codebase, so this catches it explicitly - same
   * pattern as DriversService#update.
   */
  async update(id: string, dto: UpdateVehicleDto): Promise<Vehicle> {
    await this.findById(id);
    try {
      const [vehicle] = await this.db
        .update(vehicles)
        .set({ ...dto, updatedAt: new Date() })
        .where(eq(vehicles.id, id))
        .returning();
      return vehicle;
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('vehicleCode is already in use by another vehicle');
      }
      throw error;
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: string }).code === UNIQUE_VIOLATION;
  }
}
