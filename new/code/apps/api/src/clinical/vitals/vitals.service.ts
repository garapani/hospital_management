import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../../database/tenant-connection.service.js';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';
import { Vital } from './entities/vital.entity.js';

// keyof SoftDeletableEntity (not the old literal 'createdAt' | 'updatedAt'): Vital now also carries
// createdBy/updatedBy/deletedAt/deletedBy, all system-populated, never part of a create input.
export type CreateVitalInput = Omit<Vital, 'id' | keyof SoftDeletableEntity | 'bmi' | 'recordedAt'> & { recordedAt?: Date };
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
    const rounded = Math.round(bmi * 100) / 100; // Round to 2 decimal places
    // bmi is a decimal(5,2) column (max magnitude 999.99) — an extreme-but-DTO-valid height/
    // weight combo (e.g. height near CreateVitalDto's 0 floor) can still produce a value past
    // that ceiling, which would otherwise throw a raw Postgres overflow error on save(). No BMI
    // recorded is preferable to a 500.
    return rounded <= 999.99 ? rounded : undefined;
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

      // Recalculate BMI if height or weight is updated. `?? null`, not left as undefined: a
      // plain entity save() skips undefined properties in the generated UPDATE rather than
      // nulling them, so clearing height/weight (making calculateBmi return undefined) would
      // otherwise leave the previous, now-stale BMI sitting in the row untouched.
      if (input.height !== undefined || input.weight !== undefined) {
        vital.bmi = this.calculateBmi(vital.height, vital.weight) ?? null;
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

  async void(id: string): Promise<void> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Vital);
      const vital = await repository.findOne({ where: { id } });
      
      if (!vital) {
        throw new NotFoundException(`Vital record ${id} not found`);
      }
      
      // Soft delete (Vital extends SoftDeletableEntity) — see EncountersService.deletePrescription.
      await repository.softRemove(vital);
    });
  }
}
