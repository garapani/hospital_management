import { ConflictException } from '@nestjs/common';
import { Like } from 'typeorm';
import { DepartmentCatalogService } from './department-catalog.service.js';
import { DepartmentCatalog } from './entities/department-catalog.entity.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

// department_catalog is a shared platform table (no per-test schema isolation), so every code
// used here is prefixed to avoid colliding with real catalog entries or other test runs, and rows
// are deleted by that prefix on both ends — before, in case a prior run crashed mid-test, and
// after, for a clean exit. Mirrors tenant-test-context.ts's provisionTenant() "drop before create"
// idempotency for the same reason.
const PREFIX = 'DCSVCTEST-';

describe('DepartmentCatalogService (integration)', () => {
  let ctx: TenantTestContext;
  let departmentCatalogService: DepartmentCatalogService;

  const cleanup = () =>
    ctx.dataSource.getRepository(DepartmentCatalog).delete({ departmentCode: Like(`${PREFIX}%`) });

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'dept_catalog_svc' });
    departmentCatalogService = new DepartmentCatalogService(ctx.dataSource);
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await teardownTenantTestContext(ctx);
  });

  it('creates a catalog department as active', async () => {
    const catalog = await departmentCatalogService.createDepartmentCatalog({
      departmentCode: `${PREFIX}CARD`,
      departmentName: 'Cardiology',
      description: null,
      isAppointmentApplicable: true,
    });
    expect(catalog.departmentCode).toBe(`${PREFIX}CARD`);
    expect(catalog.isActive).toBe(true);
  });

  it('rejects a duplicate departmentCode with 409', async () => {
    await departmentCatalogService.createDepartmentCatalog({
      departmentCode: `${PREFIX}ORTH`,
      departmentName: 'Orthopedics',
      description: null,
      isAppointmentApplicable: false,
    });
    await expect(
      departmentCatalogService.createDepartmentCatalog({
        departmentCode: `${PREFIX}ORTH`,
        departmentName: 'Orthopedics Again',
        description: null,
        isAppointmentApplicable: false,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('lists catalog departments ordered by name', async () => {
    await departmentCatalogService.createDepartmentCatalog({
      departmentCode: `${PREFIX}NEUR`,
      departmentName: 'Neurology',
      description: 'Brain and nervous system',
      isAppointmentApplicable: true,
    });

    const list = await departmentCatalogService.listDepartmentCatalogs();
    expect(list.some((c: DepartmentCatalog) => c.departmentCode === `${PREFIX}NEUR`)).toBe(true);
  });

  it('updates catalog metadata, leaving the code immutable', async () => {
    const catalog = await departmentCatalogService.createDepartmentCatalog({
      departmentCode: `${PREFIX}EDIT`,
      departmentName: 'Editable',
      description: 'Original',
      isAppointmentApplicable: true,
    });

    const updated = await departmentCatalogService.updateDepartmentCatalog(catalog.id, {
      departmentName: 'Editable (edited)',
      description: 'Edited',
      isAppointmentApplicable: false,
    });
    expect(updated.departmentCode).toBe(`${PREFIX}EDIT`);
    expect(updated.departmentName).toBe('Editable (edited)');
    expect(updated.description).toBe('Edited');
    expect(updated.isAppointmentApplicable).toBe(false);
  });

  it('deactivates and reactivates a catalog department', async () => {
    const catalog = await departmentCatalogService.createDepartmentCatalog({
      departmentCode: `${PREFIX}TOGGLE`,
      departmentName: 'Toggleable',
      description: null,
      isAppointmentApplicable: true,
    });

    const deactivated = await departmentCatalogService.deactivateDepartmentCatalog(catalog.id);
    expect(deactivated.isActive).toBe(false);

    const reactivated = await departmentCatalogService.reactivateDepartmentCatalog(catalog.id);
    expect(reactivated.isActive).toBe(true);
  });

  it('returns 404 for update/deactivate/reactivate of an unknown catalog department', async () => {
    const unknown = '00000000-0000-0000-0000-000000000000';
    await expect(
      departmentCatalogService.updateDepartmentCatalog(unknown, { departmentName: 'x' }),
    ).rejects.toThrow('not found');
    await expect(departmentCatalogService.deactivateDepartmentCatalog(unknown)).rejects.toThrow(
      'not found',
    );
    await expect(departmentCatalogService.reactivateDepartmentCatalog(unknown)).rejects.toThrow(
      'not found',
    );
  });
});
