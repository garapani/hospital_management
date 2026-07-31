import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../../database/tenant-connection.service.js';
import { Vital } from './entities/vital.entity.js';

export type CreateVitalInput = Omit<Vital, 'id' | 'createdAt' | 'updatedAt' | 'bmi' | 'recordedAt'> & { recordedAt?: Date };
export type UpdateVitalInput = Partial<CreateVitalInput>;

@Injectable()
export class VitalsService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  private calculateBmi(heightCm?: number, weightKg?: number): number | undefined {
    if (!heightCm || !weightKg || heightCm <= 0 || weightKg <= 0) {
      return undefined;
    }
    const heightM = heightCm / 100;
    const bmi = weightKg / (heightM * heightM);
    return Math.round(bmi * 100) / 100; // Round to 2 decimal places
  }

  async create(input: CreateVitalInput): Promise<Vital> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Vital);
      const bmi = this.calculateBmi(input.height, input.weight);
      
      const newVital = repository.create({
        ...input,
        bmi,
      });
      
      return repository.save(newVital);
    });
  }

  async findOne(id: string): Promise<Vital> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const vital = await manager.getRepository(Vital).findOne({ where: { id } });
      if (!vital) {
        throw new NotFoundException(`Vital record ${id} not found`);
      }
      return vital;
    });
  }

  async update(id: string, input: UpdateVitalInput): Promise<Vital> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Vital);
      const vital = await repository.findOne({ where: { id } });
      
      if (!vital) {
        throw new NotFoundException(`Vital record ${id} not found`);
      }

      Object.assign(vital, input);
      
      // Recalculate BMI if height or weight is updated
      if (input.height !== undefined || input.weight !== undefined) {
        vital.bmi = this.calculateBmi(vital.height, vital.weight);
      }
      
      return repository.save(vital);
    });
  }

  async listByPatient(patientId: string): Promise<Vital[]> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      return manager.getRepository(Vital).find({
        where: { patientId },
        order: { recordedAt: 'DESC' },
      });
    });
  }

  async listByAppointment(appointmentId: string): Promise<Vital[]> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      return manager.getRepository(Vital).find({
        where: { appointmentId },
        order: { recordedAt: 'DESC' },
      });
    });
  }

  async void(id: string): Promise<void> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Vital);
      const vital = await repository.findOne({ where: { id } });
      
      if (!vital) {
        throw new NotFoundException(`Vital record ${id} not found`);
      }
      
      await repository.remove(vital);
    });
  }
}
