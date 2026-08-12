import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { PatientNumberGeneratorService } from './patient-number-generator.service.js';
import { Patient } from './entities/patient.entity.js';
import { PatientAddress } from './entities/patient-address.entity.js';
import { PatientKin } from './entities/patient-kin.entity.js';
import { CreatePatientDto } from './dto/create-patient.dto.js';
import { UpdatePatientDto } from './dto/update-patient.dto.js';
import { SearchPatientsDto } from './dto/search-patients.dto.js';
import { paginate, PaginatedResponseDto } from '@hospital/pagination';

@Injectable()
export class PatientsService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly patientNumberGenerator: PatientNumberGeneratorService,
  ) {}

  async checkDuplicates(dto: { phoneNumber?: string; firstName?: string; lastName?: string; dateOfBirth?: string }): Promise<Patient[]> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
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
    });
  }

  async create(dto: CreatePatientDto): Promise<Patient> {
    if (!dto.allowDuplicate) {
      const duplicates = await this.checkDuplicates({
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

    const patientNo = await this.patientNumberGenerator.generateNextPatientNumber();

    return this.tenantConnection.runInTenantSchema(async (manager) => {
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
      if (dto.governmentIdType !== undefined) patient.governmentIdType = dto.governmentIdType;
      if (dto.governmentIdNumber !== undefined) patient.governmentIdNumber = dto.governmentIdNumber;

      return manager.save(patient);
    });
  }

  async deactivate(id: string): Promise<void> {
    await this.findOne(id);
    await this.tenantConnection.runInTenantSchema(async (manager) => {
      await manager.update(Patient, { id }, { isActive: false });
    });
  }
}
