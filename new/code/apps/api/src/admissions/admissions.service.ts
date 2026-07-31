import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { Admission } from './entities/admission.entity.js';
import { BedTransfer } from './entities/bed-transfer.entity.js';
import { Bed } from '../master-data/entities/bed.entity.js';
import { TriageEntry } from '../clinical/triage/entities/triage-entry.entity.js';

export interface CreateAdmissionInput {
  patientId: string;
  admissionSource: string; // expected: 'OPD' | 'ER' | 'Direct'
  sourceAppointmentId?: string;
  sourceTriageEntryId?: string;
  admittingDoctorId: string;
  bedId: string;
}

export interface TransferAdmissionInput {
  toBedId: string;
  transferredBy: string;
  reason?: string;
}

export interface DischargeAdmissionInput {
  dischargedBy: string;
  dischargeType?: string;
  dischargeCondition?: string;
  dischargeSummary?: string;
}

@Injectable()
export class AdmissionsService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async admit(input: CreateAdmissionInput): Promise<Admission> {
    if (input.sourceAppointmentId && input.sourceTriageEntryId) {
      throw new BadRequestException(
        'An admission can have at most one source: sourceAppointmentId or sourceTriageEntryId, not both',
      );
    }

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      if (input.sourceTriageEntryId) {
        const triageEntry = await manager.getRepository(TriageEntry).findOne({ where: { id: input.sourceTriageEntryId } });
        if (!triageEntry) {
          throw new NotFoundException(`Triage entry ${input.sourceTriageEntryId} not found`);
        }
        if (!triageEntry.patientId) {
          throw new BadRequestException(
            `Triage entry ${input.sourceTriageEntryId} must be linked to a patient before it can be admitted`,
          );
        }
      }

      const bedRepository = manager.getRepository(Bed);
      const bed = await bedRepository.findOne({ where: { id: input.bedId } });
      if (!bed) {
        throw new NotFoundException(`Bed ${input.bedId} not found`);
      }
      if (bed.status !== 'Available') {
        throw new ConflictException(`Bed ${input.bedId} is not available (status: ${bed.status})`);
      }

      bed.status = 'Occupied';
      await bedRepository.save(bed);

      const admissionRepository = manager.getRepository(Admission);
      const admission = await admissionRepository.save(
        admissionRepository.create({
          patientId: input.patientId,
          admissionSource: input.admissionSource,
          sourceAppointmentId: input.sourceAppointmentId ?? null,
          sourceTriageEntryId: input.sourceTriageEntryId ?? null,
          admittingDoctorId: input.admittingDoctorId,
          wardId: bed.wardId,
          bedId: bed.id,
          status: 'Admitted',
        }),
      );

      const bedTransferRepository = manager.getRepository(BedTransfer);
      await bedTransferRepository.save(
        bedTransferRepository.create({
          admissionId: admission.id,
          fromBedId: null,
          toBedId: bed.id,
          transferredBy: input.admittingDoctorId,
          reason: 'Initial admission',
        }),
      );

      return admission;
    });
  }

  async findOne(id: string): Promise<Admission> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const admission = await manager.getRepository(Admission).findOne({ where: { id } });
      if (!admission) {
        throw new NotFoundException(`Admission ${id} not found`);
      }
      return admission;
    });
  }

  async listActive(wardId?: string): Promise<Admission[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Admission).find({
        where: wardId ? { status: 'Admitted', wardId } : { status: 'Admitted' },
        order: { admissionDate: 'DESC' },
      }),
    );
  }

  async transfer(id: string, input: TransferAdmissionInput): Promise<Admission> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const admissionRepository = manager.getRepository(Admission);
      const admission = await admissionRepository.findOne({ where: { id } });
      if (!admission) {
        throw new NotFoundException(`Admission ${id} not found`);
      }
      if (admission.status === 'Discharged') {
        throw new ConflictException(`Admission ${id} is already discharged`);
      }

      const bedRepository = manager.getRepository(Bed);
      const toBed = await bedRepository.findOne({ where: { id: input.toBedId } });
      if (!toBed) {
        throw new NotFoundException(`Bed ${input.toBedId} not found`);
      }
      if (toBed.status !== 'Available') {
        throw new ConflictException(`Bed ${input.toBedId} is not available (status: ${toBed.status})`);
      }

      const fromBedId = admission.bedId;
      const fromBed = await bedRepository.findOne({ where: { id: fromBedId } });
      if (fromBed) {
        fromBed.status = 'Available';
        await bedRepository.save(fromBed);
      }

      toBed.status = 'Occupied';
      await bedRepository.save(toBed);

      admission.wardId = toBed.wardId;
      admission.bedId = toBed.id;
      const updated = await admissionRepository.save(admission);

      const bedTransferRepository = manager.getRepository(BedTransfer);
      await bedTransferRepository.save(
        bedTransferRepository.create({
          admissionId: admission.id,
          fromBedId,
          toBedId: toBed.id,
          transferredBy: input.transferredBy,
          reason: input.reason ?? null,
        }),
      );

      return updated;
    });
  }

  async discharge(id: string, input: DischargeAdmissionInput): Promise<Admission> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const admissionRepository = manager.getRepository(Admission);
      const admission = await admissionRepository.findOne({ where: { id } });
      if (!admission) {
        throw new NotFoundException(`Admission ${id} not found`);
      }
      if (admission.status === 'Discharged') {
        throw new ConflictException(`Admission ${id} is already discharged`);
      }

      const bedRepository = manager.getRepository(Bed);
      const bed = await bedRepository.findOne({ where: { id: admission.bedId } });
      if (bed) {
        bed.status = 'Available';
        await bedRepository.save(bed);
      }

      admission.status = 'Discharged';
      admission.dischargeDate = new Date();
      admission.dischargeType = input.dischargeType ?? null;
      admission.dischargeCondition = input.dischargeCondition ?? null;
      admission.dischargeSummary = input.dischargeSummary ?? null;
      admission.dischargedBy = input.dischargedBy;

      return admissionRepository.save(admission);
    });
  }
}
