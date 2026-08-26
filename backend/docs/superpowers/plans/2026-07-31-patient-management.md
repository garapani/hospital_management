# Patient Management Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Patient Management module inside `apps/api` (`src/patients`), adding patient master record registration, sub-entities (Address, Next-of-Kin), soft duplicate checking, tenant-scoped auto-incrementing MRN generation, RBAC permission gating, and audit logging integration.

**Architecture:** A NestJS domain module `PatientsModule` within `apps/api`. Tables (`patients`, `patient_addresses`, `patient_kins`, `patient_sequences`) are created per-tenant schema (`tenant_<hospitalId>`) via tenant migrations. Platform permissions (`patients.read`, `patients.create`, `patients.update`, `patients.manage`) are seeded into `public.permissions` and assigned to appropriate platform roles.

**Tech Stack:** NestJS, TypeORM, PostgreSQL (schema-per-tenant), `@hospital/auth-guards`, `@hospital/audit-emitter`, `@hospital/tenant-context`, Jest, Supertest.

## Global Constraints

- Node 20 LTS, pnpm, Nx (`new/code/`).
- All relative imports use explicit `.js` extensions (NodeNext module resolution).
- ESM has no `__dirname`/`__filename` — use `fileURLToPath(import.meta.url)` + `node:path` instead where needed.
- No `git commit --amend`; no `Co-Authored-By: Claude` trailer.
- All query operations touching tenant entities MUST go through `TenantConnectionService.runInTenantSchema()`.

---

### Task 1: RBAC Permission Seed & Patient Entities with Migration

**Files:**
- Create: `new/code/apps/api/src/patients/entities/patient.entity.ts`
- Create: `new/code/apps/api/src/patients/entities/patient-address.entity.ts`
- Create: `new/code/apps/api/src/patients/entities/patient-kin.entity.ts`
- Create: `new/code/apps/api/src/patients/entities/patient-sequence.entity.ts`
- Create: `new/code/apps/api/src/database/migrations/005_create_patient_tables.ts`
- Modify: `new/code/apps/api/src/rbac/seed-rbac-catalog.ts`
- Modify: `new/code/apps/api/src/database/data-source.ts`
- Test: `new/code/apps/api/src/patients/patient-entities.integration-spec.ts`

**Interfaces:**
- Produces: `Patient`, `PatientAddress`, `PatientKin`, `PatientSequence` entity definitions, migration `CreatePatientTables005`, and updated `seedRbacCatalog` seeding patient permissions.

- [ ] **Step 1: Update RBAC seed with Patient permissions**

In `new/code/apps/api/src/rbac/seed-rbac-catalog.ts`, add permissions to `PERMISSIONS_SEED`:
```typescript
{ name: 'patients.read', description: 'Read patient master records and search catalog' },
{ name: 'patients.create', description: 'Register new patient records' },
{ name: 'patients.update', description: 'Update patient demographics and details' },
{ name: 'patients.manage', description: 'Deactivate and manage patient records' },
```
Assign `patients.read`, `patients.create`, `patients.update` to roles: `Hospital Admin`, `Receptionist / Front Desk`, `Doctor`, `Nurse`.
Assign `patients.manage` to role: `Hospital Admin`.

- [ ] **Step 2: Create Patient entities**

Create `new/code/apps/api/src/patients/entities/patient.entity.ts`:
```typescript
import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { PatientAddress } from './patient-address.entity.js';
import { PatientKin } from './patient-kin.entity.js';

@Entity('patients')
export class Patient {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  patientNo!: string;

  @Column({ type: 'varchar', length: 100 })
  firstName!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  middleName!: string | null;

  @Column({ type: 'varchar', length: 100 })
  lastName!: string;

  @Column({ type: 'varchar', length: 20 })
  gender!: string;

  @Column({ type: 'date', nullable: true })
  dateOfBirth!: Date | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  age!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phoneNumber!: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  bloodGroup!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  governmentIdType!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  governmentIdNumber!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => PatientAddress, (address) => address.patient, { cascade: true })
  addresses!: PatientAddress[];

  @OneToMany(() => PatientKin, (kin) => kin.patient, { cascade: true })
  kins!: PatientKin[];
}
```

Create `new/code/apps/api/src/patients/entities/patient-address.entity.ts`:
```typescript
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Patient } from './patient.entity.js';

@Entity('patient_addresses')
export class PatientAddress {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  patientId!: string;

  @Column({ type: 'varchar', length: 20, default: 'home' })
  addressType!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  streetAddress!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  state!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  postalCode!: string | null;

  @Column({ type: 'varchar', length: 100, default: 'India' })
  country!: string;

  @ManyToOne(() => Patient, (patient) => patient.addresses, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'patientId' })
  patient!: Patient;
}
```

Create `new/code/apps/api/src/patients/entities/patient-kin.entity.ts`:
```typescript
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Patient } from './patient.entity.js';

@Entity('patient_kins')
export class PatientKin {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  patientId!: string;

  @Column({ type: 'varchar', length: 150 })
  kinName!: string;

  @Column({ type: 'varchar', length: 50 })
  relationship!: string;

  @Column({ type: 'varchar', length: 20 })
  phoneNumber!: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address!: string | null;

  @ManyToOne(() => Patient, (patient) => patient.kins, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'patientId' })
  patient!: Patient;
}
```

Create `new/code/apps/api/src/patients/entities/patient-sequence.entity.ts`:
```typescript
import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('patient_sequences')
export class PatientSequence {
  @PrimaryColumn({ type: 'varchar', length: 20 })
  prefix!: string;

  @PrimaryColumn({ type: 'integer' })
  year!: number;

  @Column({ type: 'integer', default: 0 })
  lastSequence!: number;
}
```

- [ ] **Step 3: Create migration `005_create_patient_tables.ts`**

Create `new/code/apps/api/src/database/migrations/005_create_patient_tables.ts`:
```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePatientTables005 implements MigrationInterface {
  name = 'CreatePatientTables005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE patients (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "patientNo" varchar(50) NOT NULL UNIQUE,
        "firstName" varchar(100) NOT NULL,
        "middleName" varchar(100),
        "lastName" varchar(100) NOT NULL,
        gender varchar(20) NOT NULL,
        "dateOfBirth" date,
        age varchar(20),
        "phoneNumber" varchar(20),
        email varchar(150),
        "bloodGroup" varchar(10),
        "governmentIdType" varchar(50),
        "governmentIdNumber" varchar(100),
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE patient_addresses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "patientId" uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        "addressType" varchar(20) NOT NULL DEFAULT 'home',
        "streetAddress" varchar(255),
        city varchar(100),
        state varchar(100),
        "postalCode" varchar(20),
        country varchar(100) NOT NULL DEFAULT 'India'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE patient_kins (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "patientId" uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        "kinName" varchar(150) NOT NULL,
        relationship varchar(50) NOT NULL,
        "phoneNumber" varchar(20) NOT NULL,
        email varchar(150),
        address varchar(255)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE patient_sequences (
        prefix varchar(20) NOT NULL,
        year integer NOT NULL,
        "lastSequence" integer NOT NULL DEFAULT 0,
        PRIMARY KEY (prefix, year)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE patient_sequences`);
    await queryRunner.query(`DROP TABLE patient_kins`);
    await queryRunner.query(`DROP TABLE patient_addresses`);
    await queryRunner.query(`DROP TABLE patients`);
  }
}
```

Register new entities & migration in `new/code/apps/api/src/database/data-source.ts`.

- [ ] **Step 4: Write failing integration test for entities & migration**

Create `new/code/apps/api/src/patients/patient-entities.integration-spec.ts`:
```typescript
import { TenantContextService } from '@hospital/tenant-context';
import { dataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { CreatePatientTables005 } from '../database/migrations/005_create_patient_tables.js';
import { Patient } from './entities/patient.entity.js';
import { PatientAddress } from './entities/patient-address.entity.js';
import { PatientKin } from './entities/patient-kin.entity.js';

describe('Patient Entities & Migration (integration)', () => {
  let tenantContext: TenantContextService;
  let tenantConnection: TenantConnectionService;
  const schema = 'tenant_patient_test';

  beforeAll(async () => {
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }
    tenantContext = new TenantContextService();
    tenantConnection = new TenantConnectionService(dataSource, tenantContext);

    await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await dataSource.query(`CREATE SCHEMA "${schema}"`);

    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.query(`SET search_path TO "${schema}"`);
    await new CreatePatientTables005().up(queryRunner);
    await queryRunner.release();
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  });

  it('inserts and retrieves patient with addresses and kins in tenant schema', async () => {
    await tenantContext.run({ tenantId: 'patient_test', correlationId: 'c1' }, async () => {
      await tenantConnection.runInTenantSchema(async (manager) => {
        const patient = manager.create(Patient, {
          patientNo: 'PAT-2026-00001',
          firstName: 'John',
          lastName: 'Doe',
          gender: 'Male',
          phoneNumber: '9876543210',
          addresses: [
            manager.create(PatientAddress, { streetAddress: '123 Main St', city: 'Mumbai', state: 'Maharashtra', postalCode: '400001' })
          ],
          kins: [
            manager.create(PatientKin, { kinName: 'Jane Doe', relationship: 'Spouse', phoneNumber: '9876543211' })
          ]
        });
        await manager.save(patient);

        const found = await manager.findOne(Patient, {
          where: { patientNo: 'PAT-2026-00001' },
          relations: ['addresses', 'kins'],
        });

        expect(found).toBeDefined();
        expect(found?.firstName).toBe('John');
        expect(found?.addresses).toHaveLength(1);
        expect(found?.addresses[0].city).toBe('Mumbai');
        expect(found?.kins).toHaveLength(1);
        expect(found?.kins[0].kinName).toBe('Jane Doe');
      });
    });
  });
});
```

- [ ] **Step 5: Run integration test and verify pass**

Run: `pnpm exec nx test api --testPathPattern=patient-entities`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add new/code/apps/api/src/patients new/code/apps/api/src/database
git commit -m "feat: add patient entities, migration, and RBAC permissions"
```

---

### Task 2: PatientNumberGeneratorService

**Files:**
- Create: `new/code/apps/api/src/patients/patient-number-generator.service.ts`
- Test: `new/code/apps/api/src/patients/patient-number-generator.service.integration-spec.ts`

**Interfaces:**
- Produces: `PatientNumberGeneratorService.generateNextPatientNumber(prefix?: string): Promise<string>`

- [ ] **Step 1: Write integration test for patient number generator**

Create `new/code/apps/api/src/patients/patient-number-generator.service.integration-spec.ts`:
```typescript
import { TenantContextService } from '@hospital/tenant-context';
import { dataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { CreatePatientTables005 } from '../database/migrations/005_create_patient_tables.js';
import { PatientNumberGeneratorService } from './patient-number-generator.service.js';

describe('PatientNumberGeneratorService (integration)', () => {
  let tenantContext: TenantContextService;
  let tenantConnection: TenantConnectionService;
  let generatorService: PatientNumberGeneratorService;
  const schema = 'tenant_patient_num_test';

  beforeAll(async () => {
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }
    tenantContext = new TenantContextService();
    tenantConnection = new TenantConnectionService(dataSource, tenantContext);
    generatorService = new PatientNumberGeneratorService(tenantConnection);

    await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await dataSource.query(`CREATE SCHEMA "${schema}"`);

    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.query(`SET search_path TO "${schema}"`);
    await new CreatePatientTables005().up(queryRunner);
    await queryRunner.release();
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  });

  it('generates sequential patient numbers in tenant schema', async () => {
    await tenantContext.run({ tenantId: 'patient_num_test', correlationId: 'c1' }, async () => {
      const year = new Date().getFullYear();
      const num1 = await generatorService.generateNextPatientNumber('PAT');
      const num2 = await generatorService.generateNextPatientNumber('PAT');

      expect(num1).toBe(`PAT-${year}-00001`);
      expect(num2).toBe(`PAT-${year}-00002`);
    });
  });
});
```

- [ ] **Step 2: Implement PatientNumberGeneratorService**

Create `new/code/apps/api/src/patients/patient-number-generator.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';

@Injectable()
export class PatientNumberGeneratorService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async generateNextPatientNumber(prefix = 'PAT'): Promise<string> {
    const currentYear = new Date().getFullYear();

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const result = await manager.query(
        `
        INSERT INTO patient_sequences (prefix, year, "lastSequence")
        VALUES ($1, $2, 1)
        ON CONFLICT (prefix, year)
        DO UPDATE SET "lastSequence" = patient_sequences."lastSequence" + 1
        RETURNING "lastSequence"
        `,
        [prefix, currentYear],
      );

      const nextSeq = result[0].lastSequence as number;
      const paddedSeq = String(nextSeq).padStart(5, '0');
      return `${prefix}-${currentYear}-${paddedSeq}`;
    });
  }
}
```

- [ ] **Step 3: Run integration test and verify pass**

Run: `pnpm exec nx test api --testPathPattern=patient-number-generator`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add new/code/apps/api/src/patients/patient-number-generator.service.ts new/code/apps/api/src/patients/patient-number-generator.service.integration-spec.ts
git commit -m "feat: add PatientNumberGeneratorService with atomic sequence generation"
```

---

### Task 3: PatientsService & Duplicate Detection

**Files:**
- Create: `new/code/apps/api/src/patients/dto/create-patient.dto.ts`
- Create: `new/code/apps/api/src/patients/dto/update-patient.dto.ts`
- Create: `new/code/apps/api/src/patients/dto/search-patients.dto.ts`
- Create: `new/code/apps/api/src/patients/patients.service.ts`
- Test: `new/code/apps/api/src/patients/patients.service.integration-spec.ts`

**Interfaces:**
- Produces: `PatientsService` methods: `create`, `checkDuplicates`, `findAll`, `findOne`, `update`, `deactivate`.

- [ ] **Step 1: Write DTOs**

Create DTOs in `new/code/apps/api/src/patients/dto/`:
- `create-patient.dto.ts`: Contains patient fields, address array, kin array, `allowDuplicate?: boolean`.
- `update-patient.dto.ts`: Partial patient DTO.
- `search-patients.dto.ts`: `q?: string`, `phoneNumber?: string`, `patientNo?: string`, `page?: number`, `limit?: number`.

- [ ] **Step 2: Write integration test for PatientsService**

Create `new/code/apps/api/src/patients/patients.service.integration-spec.ts`:
```typescript
import { ConflictException, NotFoundException } from '@nestjs/common';
import { TenantContextService } from '@hospital/tenant-context';
import { dataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { CreatePatientTables005 } from '../database/migrations/005_create_patient_tables.js';
import { PatientNumberGeneratorService } from './patient-number-generator.service.js';
import { PatientsService } from './patients.service.js';

describe('PatientsService (integration)', () => {
  let tenantContext: TenantContextService;
  let tenantConnection: TenantConnectionService;
  let generatorService: PatientNumberGeneratorService;
  let service: PatientsService;
  const schema = 'tenant_patients_service_test';

  beforeAll(async () => {
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }
    tenantContext = new TenantContextService();
    tenantConnection = new TenantConnectionService(dataSource, tenantContext);
    generatorService = new PatientNumberGeneratorService(tenantConnection);
    service = new PatientsService(tenantConnection, generatorService);

    await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await dataSource.query(`CREATE SCHEMA "${schema}"`);

    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.query(`SET search_path TO "${schema}"`);
    await new CreatePatientTables005().up(queryRunner);
    await queryRunner.release();
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  });

  it('registers patient and triggers conflict exception on duplicate phone without override', async () => {
    await tenantContext.run({ tenantId: 'patients_service_test', correlationId: 'c1' }, async () => {
      const p1 = await service.create({
        firstName: 'Alice',
        lastName: 'Smith',
        gender: 'Female',
        phoneNumber: '9998887770',
      });
      expect(p1.patientNo).toBeDefined();

      await expect(
        service.create({
          firstName: 'Alice',
          lastName: 'Smith',
          gender: 'Female',
          phoneNumber: '9998887770',
          allowDuplicate: false,
        }),
      ).rejects.toThrow(ConflictException);

      const p2 = await service.create({
        firstName: 'Alice',
        lastName: 'Smith',
        gender: 'Female',
        phoneNumber: '9998887770',
        allowDuplicate: true,
      });
      expect(p2.patientNo).not.toEqual(p1.patientNo);
    });
  });

  it('searches and updates patient record', async () => {
    await tenantContext.run({ tenantId: 'patients_service_test', correlationId: 'c2' }, async () => {
      const created = await service.create({
        firstName: 'Robert',
        lastName: 'Brown',
        gender: 'Male',
        phoneNumber: '9123456789',
      });

      const found = await service.findAll({ q: 'Robert' });
      expect(found.data).toHaveLength(1);
      expect(found.data[0].id).toBe(created.id);

      const updated = await service.update(created.id, { email: 'robert.b@example.com' });
      expect(updated.email).toBe('robert.b@example.com');
    });
  });
});
```

- [ ] **Step 3: Implement PatientsService**

Create `new/code/apps/api/src/patients/patients.service.ts`:
```typescript
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { PatientNumberGeneratorService } from './patient-number-generator.service.js';
import { Patient } from './entities/patient.entity.js';
import { PatientAddress } from './entities/patient-address.entity.js';
import { PatientKin } from './entities/patient-kin.entity.js';
import { CreatePatientDto } from './dto/create-patient.dto.js';
import { UpdatePatientDto } from './dto/update-patient.dto.js';
import { SearchPatientsDto } from './dto/search-patients.dto.js';

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

  async findAll(query: SearchPatientsDto): Promise<{ data: Patient[]; total: number; page: number; limit: number }> {
    const page = Number(query.page ?? 1);
    const limit = Number(query.limit ?? 20);
    const skip = (page - 1) * limit;

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

      qb.orderBy('p.createdAt', 'DESC').skip(skip).take(limit);

      const [data, total] = await qb.getManyAndCount();
      return { data, total, page, limit };
    });
  }

  async findOne(id: string): Promise<Patient> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const patient = await manager.findOne(Patient, {
        where: { id, isActive: true },
        relations: ['addresses', 'kins'],
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
```

- [ ] **Step 4: Run integration test and verify pass**

Run: `pnpm exec nx test api --testPathPattern=patients.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add new/code/apps/api/src/patients
git commit -m "feat: add PatientsService with duplicate detection and CRUD operations"
```

---

### Task 4: PatientsController, PatientsModule, and E2E Tests

**Files:**
- Create: `new/code/apps/api/src/patients/patients.controller.ts`
- Create: `new/code/apps/api/src/patients/patients.module.ts`
- Modify: `new/code/apps/api/src/app/app.module.ts`
- Test: `new/code/apps/api/src/patients/patients.controller.integration-spec.ts`

**Interfaces:**
- Produces: REST API endpoints at `/api/patients`, `PatientsModule` integrated into `AppModule`.

- [ ] **Step 1: Create PatientsController**

Create `new/code/apps/api/src/patients/patients.controller.ts`:
```typescript
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { PatientsService } from './patients.service.js';
import { CreatePatientDto } from './dto/create-patient.dto.js';
import { UpdatePatientDto } from './dto/update-patient.dto.js';
import { SearchPatientsDto } from './dto/search-patients.dto.js';

@Controller('patients')
@UseGuards(PermissionGuard)
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Post()
  @RequirePermission('patients.create')
  async create(@Body() dto: CreatePatientDto) {
    return this.patientsService.create(dto);
  }

  @Post('check-duplicates')
  @RequirePermission('patients.read')
  async checkDuplicates(@Body() dto: { phoneNumber?: string; firstName?: string; lastName?: string; dateOfBirth?: string }) {
    return this.patientsService.checkDuplicates(dto);
  }

  @Get()
  @RequirePermission('patients.read')
  async findAll(@Query() query: SearchPatientsDto) {
    return this.patientsService.findAll(query);
  }

  @Get(':id')
  @RequirePermission('patients.read')
  async findOne(@Param('id') id: string) {
    return this.patientsService.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('patients.update')
  async update(@Param('id') id: string, @Body() dto: UpdatePatientDto) {
    return this.patientsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('patients.manage')
  async deactivate(@Param('id') id: string) {
    await this.patientsService.deactivate(id);
    return { success: true };
  }
}
```

- [ ] **Step 2: Create PatientsModule and wire into AppModule**

Create `new/code/apps/api/src/patients/patients.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { PatientNumberGeneratorService } from './patient-number-generator.service.js';
import { PatientsService } from './patients.service.js';
import { PatientsController } from './patients.controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [PatientsController],
  providers: [PatientNumberGeneratorService, PatientsService],
  exports: [PatientsService, PatientNumberGeneratorService],
})
export class PatientsModule {}
```

Wire `PatientsModule` into `AppModule` (`new/code/apps/api/src/app/app.module.ts`).

- [ ] **Step 3: Write E2E HTTP Controller integration test**

Create `new/code/apps/api/src/patients/patients.controller.integration-spec.ts` testing:
- Creation via HTTP POST `/api/patients` with Bearer JWT.
- Permission gating (`403 Forbidden` without `patients.create`).
- Duplicate detection conflict returning `409`.
- Retrieval via GET `/api/patients/:id`.

- [ ] **Step 4: Run integration test and verify pass**

Run: `pnpm exec nx test api --testPathPattern=patients.controller`
Expected: PASS.

- [ ] **Step 5: Run full test suite workspace-wide**

Run: `pnpm exec nx run-many -t test`
Expected: All tests pass workspace-wide.

- [ ] **Step 6: Commit**

```bash
git add new/code/apps/api/src/patients new/code/apps/api/src/app/app.module.ts
git commit -m "feat: add PatientsController, wire PatientsModule into AppModule, add HTTP E2E tests"
```
