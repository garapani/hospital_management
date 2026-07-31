import { ConflictException, NotFoundException } from '@nestjs/common';
import { TenantContextService } from '@hospital/tenant-context';
import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { MasterDataService } from './master-data.service.js';
import { Bed } from './entities/bed.entity.js';

describe('MasterDataService (integration)', () => {
  const dataSource = createDataSource();
  const tenantContext = new TenantContextService();
  const tenantConnection = new TenantConnectionService(dataSource, tenantContext);
  const accountsService = new AccountsService(tenantConnection, dataSource);
  const masterDataService = new MasterDataService(tenantConnection);

  beforeAll(async () => {
    await dataSource.initialize();
    await accountsService.provisionTenantSchema(dataSource, 'test_masterdata_svc');
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_masterdata_svc" CASCADE`);
    await dataSource.destroy();
  });

  function inTenant<T>(work: () => Promise<T>): Promise<T> {
    return tenantContext.run({ tenantId: 'test_masterdata_svc', correlationId: 'test' }, work);
  }

  describe('departments', () => {
    it('creates a department as active', async () => {
      const department = await inTenant(() =>
        masterDataService.createDepartment({ departmentCode: 'CARD', departmentName: 'Cardiology' }),
      );
      expect(department.departmentCode).toBe('CARD');
      expect(department.isActive).toBe(true);
    });

    it('rejects a duplicate departmentCode with 409', async () => {
      await inTenant(() =>
        masterDataService.createDepartment({ departmentCode: 'ORTH', departmentName: 'Orthopedics' }),
      );
      await expect(
        inTenant(() =>
          masterDataService.createDepartment({ departmentCode: 'ORTH', departmentName: 'Orthopedics Again' }),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('lists and gets departments, returns null for an unknown id', async () => {
      const created = await inTenant(() =>
        masterDataService.createDepartment({ departmentCode: 'NEUR', departmentName: 'Neurology' }),
      );

      const list = await inTenant(() => masterDataService.listDepartments());
      expect(list.some((d) => d.departmentCode === 'NEUR')).toBe(true);

      const found = await inTenant(() => masterDataService.getDepartment(created.id));
      expect(found?.departmentName).toBe('Neurology');

      const missing = await inTenant(() =>
        masterDataService.getDepartment('00000000-0000-0000-0000-000000000000'),
      );
      expect(missing).toBeNull();
    });

    it('deactivates and reactivates a department', async () => {
      const created = await inTenant(() =>
        masterDataService.createDepartment({ departmentCode: 'ENT', departmentName: 'ENT' }),
      );

      const deactivated = await inTenant(() => masterDataService.deactivateDepartment(created.id));
      expect(deactivated.isActive).toBe(false);

      const reactivated = await inTenant(() => masterDataService.reactivateDepartment(created.id));
      expect(reactivated.isActive).toBe(true);
    });

    it('rejects deactivating a department that is the parent of an active child, with 409', async () => {
      const parent = await inTenant(() =>
        masterDataService.createDepartment({ departmentCode: 'SURG', departmentName: 'Surgery' }),
      );
      await inTenant(() =>
        masterDataService.createDepartment({
          departmentCode: 'SURG-ORTHO',
          departmentName: 'Orthopedic Surgery',
          parentDepartmentId: parent.id,
        }),
      );

      await expect(inTenant(() => masterDataService.deactivateDepartment(parent.id))).rejects.toThrow(
        ConflictException,
      );
    });

    it('deactivate/reactivate on an unknown id throws NotFoundException', async () => {
      await expect(
        inTenant(() => masterDataService.deactivateDepartment('00000000-0000-0000-0000-000000000000')),
      ).rejects.toThrow(NotFoundException);
      await expect(
        inTenant(() => masterDataService.reactivateDepartment('00000000-0000-0000-0000-000000000000')),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('wards', () => {
    it('creates a ward as active', async () => {
      const ward = await inTenant(() =>
        masterDataService.createWard({ wardCode: 'W1', wardName: 'General Ward 1', bedCapacity: 20 }),
      );
      expect(ward.wardCode).toBe('W1');
      expect(ward.isActive).toBe(true);
      expect(ward.bedCapacity).toBe(20);
    });

    it('rejects a duplicate wardCode with 409', async () => {
      await inTenant(() => masterDataService.createWard({ wardCode: 'W2', wardName: 'ICU' }));
      await expect(
        inTenant(() => masterDataService.createWard({ wardCode: 'W2', wardName: 'ICU Again' })),
      ).rejects.toThrow(ConflictException);
    });

    it('lists and gets wards, returns null for an unknown id', async () => {
      const created = await inTenant(() => masterDataService.createWard({ wardCode: 'W3', wardName: 'Maternity' }));

      const list = await inTenant(() => masterDataService.listWards());
      expect(list.some((w) => w.wardCode === 'W3')).toBe(true);

      const found = await inTenant(() => masterDataService.getWard(created.id));
      expect(found?.wardName).toBe('Maternity');

      const missing = await inTenant(() => masterDataService.getWard('00000000-0000-0000-0000-000000000000'));
      expect(missing).toBeNull();
    });

    it('deactivates and reactivates a ward', async () => {
      const created = await inTenant(() => masterDataService.createWard({ wardCode: 'W4', wardName: 'Pediatrics' }));

      const deactivated = await inTenant(() => masterDataService.deactivateWard(created.id));
      expect(deactivated.isActive).toBe(false);

      const reactivated = await inTenant(() => masterDataService.reactivateWard(created.id));
      expect(reactivated.isActive).toBe(true);
    });

    it('deactivate/reactivate on an unknown id throws NotFoundException', async () => {
      await expect(
        inTenant(() => masterDataService.deactivateWard('00000000-0000-0000-0000-000000000000')),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('beds', () => {
    it('creates a bed as available under a ward', async () => {
      const ward = await inTenant(() => masterDataService.createWard({ wardCode: 'ICU', wardName: 'ICU' }));
      const bed = await inTenant(() =>
        masterDataService.createBed({ wardId: ward.id, bedNumber: '1', bedType: 'ICU' }),
      );
      expect(bed.wardId).toBe(ward.id);
      expect(bed.bedNumber).toBe('1');
      expect(bed.status).toBe('Available');
      expect(bed.isActive).toBe(true);
    });

    it('rejects a duplicate bedNumber within the same ward with 409', async () => {
      const ward = await inTenant(() => masterDataService.createWard({ wardCode: 'GEN1', wardName: 'General 1' }));
      await inTenant(() => masterDataService.createBed({ wardId: ward.id, bedNumber: 'A1' }));

      await expect(
        inTenant(() => masterDataService.createBed({ wardId: ward.id, bedNumber: 'A1' })),
      ).rejects.toThrow(ConflictException);
    });

    it('allows the same bedNumber in two different wards', async () => {
      const wardA = await inTenant(() => masterDataService.createWard({ wardCode: 'GEN2A', wardName: 'General 2A' }));
      const wardB = await inTenant(() => masterDataService.createWard({ wardCode: 'GEN2B', wardName: 'General 2B' }));
      await inTenant(() => masterDataService.createBed({ wardId: wardA.id, bedNumber: '1' }));

      const bedB = await inTenant(() => masterDataService.createBed({ wardId: wardB.id, bedNumber: '1' }));
      expect(bedB.wardId).toBe(wardB.id);
    });

    it('rejects creating a bed under an unknown ward with 404', async () => {
      await expect(
        inTenant(() =>
          masterDataService.createBed({ wardId: '00000000-0000-0000-0000-000000000000', bedNumber: '1' }),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('lists beds by ward and gets a single bed, returns null for an unknown id', async () => {
      const ward = await inTenant(() => masterDataService.createWard({ wardCode: 'GEN3', wardName: 'General 3' }));
      const bed = await inTenant(() => masterDataService.createBed({ wardId: ward.id, bedNumber: '1' }));

      const beds = await inTenant(() => masterDataService.listBedsByWard(ward.id));
      expect(beds.some((b) => b.id === bed.id)).toBe(true);

      const found = await inTenant(() => masterDataService.getBed(bed.id));
      expect(found?.bedNumber).toBe('1');

      const missing = await inTenant(() => masterDataService.getBed('00000000-0000-0000-0000-000000000000'));
      expect(missing).toBeNull();
    });

    it('deactivates and reactivates a bed', async () => {
      const ward = await inTenant(() => masterDataService.createWard({ wardCode: 'GEN4', wardName: 'General 4' }));
      const bed = await inTenant(() => masterDataService.createBed({ wardId: ward.id, bedNumber: '1' }));

      const deactivated = await inTenant(() => masterDataService.deactivateBed(bed.id));
      expect(deactivated.isActive).toBe(false);

      const reactivated = await inTenant(() => masterDataService.reactivateBed(bed.id));
      expect(reactivated.isActive).toBe(true);
    });

    it('rejects deactivating an occupied bed with 409', async () => {
      const ward = await inTenant(() => masterDataService.createWard({ wardCode: 'GEN5', wardName: 'General 5' }));
      const bed = await inTenant(() => masterDataService.createBed({ wardId: ward.id, bedNumber: '1' }));
      // Simulate occupancy the same way AdmissionsService will (Task 5) — directly via the repository,
      // since MasterDataService itself never sets status to 'Occupied'. `tenantConnection` and `Bed`
      // are already in scope in this file (the existing top-of-file setup and the import added below).
      await inTenant(() =>
        tenantConnection.runInTenantSchema(async (manager) => {
          const repo = manager.getRepository(Bed);
          const occupied = await repo.findOneOrFail({ where: { id: bed.id } });
          occupied.status = 'Occupied';
          await repo.save(occupied);
        }),
      );

      await expect(inTenant(() => masterDataService.deactivateBed(bed.id))).rejects.toThrow(ConflictException);
    });

    it('deactivate/reactivate on an unknown id throws NotFoundException', async () => {
      await expect(
        inTenant(() => masterDataService.deactivateBed('00000000-0000-0000-0000-000000000000')),
      ).rejects.toThrow(NotFoundException);
      await expect(
        inTenant(() => masterDataService.reactivateBed('00000000-0000-0000-0000-000000000000')),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
