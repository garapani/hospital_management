import { ConflictException, NotFoundException } from '@nestjs/common';
import { TenantContextService } from '@hospital/tenant-context';
import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { MasterDataService } from './master-data.service.js';

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
});
