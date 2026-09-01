import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { withAdvisoryLock } from '../database/advisory-lock.util.js';
import { AccountsService, CreatePatientAccountResult } from '../accounts/accounts.service.js';
import { PatientNumberGeneratorService } from './patient-number-generator.service.js';
import { Patient } from './entities/patient.entity.js';
import { PatientAddress } from './entities/patient-address.entity.js';
import { PatientKin } from './entities/patient-kin.entity.js';
import { CreatePatientDto } from './dto/create-patient.dto.js';
import { UpdatePatientDto } from './dto/update-patient.dto.js';
import { SearchPatientsDto } from './dto/search-patients.dto.js';
import { CreatePortalInviteDto } from './dto/create-portal-invite.dto.js';
import { CheckDuplicatesDto } from './dto/check-duplicates.dto.js';
import { paginate, PaginatedResponseDto } from '@hospital/pagination';

@Injectable()
export class PatientsService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly patientNumberGenerator: PatientNumberGeneratorService,
    private readonly accountsService: AccountsService,
  ) {}

  private async findDuplicates(manager: EntityManager, dto: CheckDuplicatesDto): Promise<Patient[]> {
    const qb = manager.createQueryBuilder(Patient, 'p').where('p.isActive = true');

    if (dto.phoneNumber) {
      qb.andWhere('p.phoneNumber = :phoneNumber', { phoneNumber: dto.phoneNumber });
    } else if (dto.firstName && dto.lastName) {
      qb.andWhere('LOWER(p.firstName) = LOWER(:firstName) AND LOWER(p.lastName) = LOWER(:lastName)', {
        firstName: dto.firstName,
        lastName: dto.lastName,
      });
      if (dto.dateOfBirth) {
        qb.andWhere('p.dateOfBirth = :dateOfBirth', { dateOfBirth: dto.dateOfBirth });
      }
    } else {
      return [];
    }

    return qb.getMany();
  }

  /** Same identity signature findDuplicates() branches on — used to key the advisory lock below. */
  private duplicateLockKey(dto: CheckDuplicatesDto): string | null {
    if (dto.phoneNumber) {
      return `patient-duplicate:phone:${dto.phoneNumber}`;
    }
    if (dto.firstName && dto.lastName) {
      return `patient-duplicate:name:${dto.firstName.toLowerCase()}:${dto.lastName.toLowerCase()}:${dto.dateOfBirth ?? ''}`;
    }
    return null;
  }

  async checkDuplicates(dto: CheckDuplicatesDto): Promise<Patient[]> {
    return this.tenantConnection.runInTenantSchema((manager) => this.findDuplicates(manager, dto));
  }

  async create(dto: CreatePatientDto): Promise<Patient> {
    const patientNo = await this.patientNumberGenerator.generateNextPatientNumber();

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      if (!dto.allowDuplicate) {
        // The advisory lock is what actually closes the race the select-then-insert below would
        // otherwise have: two concurrent requests for the same identity now serialize on the
        // check+insert instead of both observing "no duplicate" and both inserting. A hard unique
        // DB constraint isn't an option here — allowDuplicate is a deliberate, supported override,
        // so uniqueness on (phone) or (name, dob) can't be enforced unconditionally.
        const lockKey = this.duplicateLockKey(dto);
        if (lockKey) {
          await withAdvisoryLock(manager, lockKey);
        }

        const duplicates = await this.findDuplicates(manager, {
          phoneNumber: dto.phoneNumber,
          firstName: dto.firstName,
          lastName: dto.lastName,
          dateOfBirth: dto.dateOfBirth,
        });

        if (duplicates.length > 0) {
          throw new ConflictException({
            message: 'Potential duplicate patient record(s) found',
            duplicates,
          });
        }
      }

      const patient = manager.create(Patient, {
        patientNo,
        firstName: dto.firstName,
        middleName: dto.middleName ?? null,
        lastName: dto.lastName,
        gender: dto.gender,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
        age: dto.age ?? null,
        phoneNumber: dto.phoneNumber ?? null,
        email: dto.email ?? null,
        bloodGroup: dto.bloodGroup ?? null,
        allergies: dto.allergies ?? null,
        governmentIdType: dto.governmentIdType ?? null,
        governmentIdNumber: dto.governmentIdNumber ?? null,
        addresses: (dto.addresses ?? []).map((addr) => manager.create(PatientAddress, addr)),
        kins: (dto.kins ?? []).map((kin) => manager.create(PatientKin, kin)),
      });

      return manager.save(patient);
    });
  }

  async findAll(query: SearchPatientsDto): Promise<PaginatedResponseDto<Patient>> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const qb = manager
        .createQueryBuilder(Patient, 'p')
        .leftJoinAndSelect('p.addresses', 'addresses')
        .leftJoinAndSelect('p.kins', 'kins')
        .where('p.isActive = true');

      if (query.patientNo) {
        qb.andWhere('p.patientNo = :patientNo', { patientNo: query.patientNo });
      }
      if (query.phoneNumber) {
        qb.andWhere('p.phoneNumber LIKE :phone', { phone: `%${query.phoneNumber}%` });
      }
      if (query.q) {
        qb.andWhere(
          '(p.firstName ILIKE :q OR p.lastName ILIKE :q OR p.patientNo ILIKE :q OR p.phoneNumber ILIKE :q)',
          { q: `%${query.q}%` },
        );
      }

      qb.orderBy('p.createdAt', 'DESC');

      return paginate(qb, query);
    });
  }

  async findOne(id: string): Promise<Patient> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const patient = await manager.findOne(Patient, {
        where: { id, isActive: true },
        relations: { addresses: true, kins: true },
      });
      if (!patient) {
        throw new NotFoundException(`Patient with ID "${id}" not found`);
      }
      return patient;
    });
  }

  async update(id: string, dto: UpdatePatientDto): Promise<Patient> {
    await this.findOne(id);

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const patient = await manager.findOneOrFail(Patient, { where: { id } });

      if (dto.firstName !== undefined) patient.firstName = dto.firstName;
      if (dto.middleName !== undefined) patient.middleName = dto.middleName;
      if (dto.lastName !== undefined) patient.lastName = dto.lastName;
      if (dto.gender !== undefined) patient.gender = dto.gender;
      if (dto.dateOfBirth !== undefined) patient.dateOfBirth = dto.dateOfBirth ? new Date(dto.dateOfBirth) : null;
      if (dto.age !== undefined) patient.age = dto.age;
      if (dto.phoneNumber !== undefined) patient.phoneNumber = dto.phoneNumber;
      if (dto.email !== undefined) patient.email = dto.email;
      if (dto.bloodGroup !== undefined) patient.bloodGroup = dto.bloodGroup;
      if (dto.allergies !== undefined) patient.allergies = dto.allergies;
      if (dto.governmentIdType !== undefined) patient.governmentIdType = dto.governmentIdType;
      if (dto.governmentIdNumber !== undefined) patient.governmentIdNumber = dto.governmentIdNumber;

      // Full-replace semantics, matching create(): the client sends the complete list it wants
      // on the record, not a diff. cascade:true on the OneToMany only inserts/updates the array
      // it's given — it doesn't drop rows missing from it — so stale rows are deleted explicitly.
      if (dto.addresses !== undefined) {
        await manager.delete(PatientAddress, { patientId: id });
        patient.addresses = dto.addresses.map((addr) => manager.create(PatientAddress, addr));
      }
      if (dto.kins !== undefined) {
        await manager.delete(PatientKin, { patientId: id });
        patient.kins = dto.kins.map((kin) => manager.create(PatientKin, kin));
      }

      return manager.save(patient);
    });
  }

  /**
   * Front-desk-initiated patient-portal invite, anchored to an existing chart. findOne() (not a
   * raw lookup) both confirms the patient exists and rejects a deactivated one — an inactive
   * patient record shouldn't gain a fresh login path.
   */
  async createPortalInvite(id: string, dto: CreatePortalInviteDto): Promise<CreatePatientAccountResult> {
    const patient = await this.findOne(id);
    return this.accountsService.createPatientAccount({
      patientId: patient.id,
      username: dto.username,
      email: dto.email ?? patient.email,
      displayName: `${patient.firstName} ${patient.lastName}`,
    });
  }

  async deactivate(id: string): Promise<void> {
    // save(), not update(): a raw update() broadcasts the plain values object ({ isActive: false })
    // to TypeORM subscribers, not a real Patient instance, so AuditColumnsSubscriber's
    // `instanceof AuditableEntity` check silently fails and updatedBy never gets set (updatedAt
    // still bumps — TypeORM handles @UpdateDateColumn directly in its own SQL generation,
    // independent of subscribers — so the gap is easy to miss without an explicit updatedBy check).
    const patient = await this.findOne(id);
    patient.isActive = false;
    await this.tenantConnection.runInTenantSchema(async (manager) => {
      await manager.save(Patient, patient);
    });
    // Revokes any linked portal login too — a deactivated patient shouldn't keep a working
    // account just because deactivation only ever touched the Patient row.
    await this.accountsService.deactivatePatientAccount(id);
  }
}
