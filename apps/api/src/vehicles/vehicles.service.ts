import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/drizzle.module';
import { vehicles, type NewVehicle, type Vehicle } from '../db/schema';
import type { CreateVehicleDto } from './dto/create-vehicle.dto';

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
}
