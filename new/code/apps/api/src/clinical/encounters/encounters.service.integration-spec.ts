import { Test, TestingModule } from '@nestjs/testing';
import { EncountersService } from './encounters.service.js';
import { TenantConnectionService } from '../../database/tenant-connection.service.js';
import { createDataSource } from '../../database/data-source.js';
import { AccountsService } from '../../accounts/accounts.service.js';

describe('EncountersService (integration)', () => {
  let service: EncountersService;
  const dataSource = createDataSource();
  const accountsService = new AccountsService(new TenantConnectionService(dataSource), dataSource);
  const tenantId = 'test_encounters_svc';

  beforeAll(async () => {
    await dataSource.initialize();
    await accountsService.provisionTenantSchema(dataSource, tenantId);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EncountersService,
        {
          provide: TenantConnectionService,
          useValue: {
            runInTenantSchema: async (cb: any) => {
              return dataSource.transaction(async (manager) => {
                await manager.query(`SET search_path TO "tenant_${tenantId}", public`);
                return cb(manager);
              });
            },
          },
        },
      ],
    }).compile();

    service = module.get<EncountersService>(EncountersService);
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_${tenantId}" CASCADE`);
    await dataSource.destroy();
  });

  it('creates, retrieves and updates clinical notes', async () => {
    const note = await service.createNote({
      patientId: '00000000-0000-0000-0000-000000000001',
      doctorId: '00000000-0000-0000-0000-000000000002',
      chiefComplaint: 'Headache',
    });
    expect(note.id).toBeDefined();
    expect(note.status).toBe('Draft');

    const notes = await service.getNotesByPatient('00000000-0000-0000-0000-000000000001');
    expect(notes.length).toBe(1);
    expect(notes[0].chiefComplaint).toBe('Headache');

    const updated = await service.updateNote(note.id, { plan: 'Rest', status: 'Finalized' });
    expect(updated.plan).toBe('Rest');
    expect(updated.status).toBe('Finalized');
  });

  it('creates, retrieves and deletes diagnoses', async () => {
    const dx = await service.createDiagnosis({
      patientId: '00000000-0000-0000-0000-000000000001',
      doctorId: '00000000-0000-0000-0000-000000000002',
      description: 'Migraine',
      isPrimary: true,
    });
    expect(dx.id).toBeDefined();
    expect(dx.description).toBe('Migraine');

    const diagnoses = await service.getDiagnosesByPatient('00000000-0000-0000-0000-000000000001');
    expect(diagnoses.length).toBe(1);

    await service.deleteDiagnosis(dx.id);
    const afterDelete = await service.getDiagnosesByPatient('00000000-0000-0000-0000-000000000001');
    expect(afterDelete.length).toBe(0);
  });

  it('creates, retrieves and deletes prescriptions', async () => {
    const rx = await service.createPrescription({
      patientId: '00000000-0000-0000-0000-000000000001',
      doctorId: '00000000-0000-0000-0000-000000000002',
      medicationName: 'Ibuprofen',
      dosage: '400mg',
      frequency: 'TID',
      route: 'Oral',
      durationDays: 3,
    });
    expect(rx.id).toBeDefined();

    const scripts = await service.getPrescriptionsByPatient('00000000-0000-0000-0000-000000000001');
    expect(scripts.length).toBe(1);

    await service.deletePrescription(rx.id);
    const afterDelete = await service.getPrescriptionsByPatient('00000000-0000-0000-0000-000000000001');
    expect(afterDelete.length).toBe(0);
  });
});
