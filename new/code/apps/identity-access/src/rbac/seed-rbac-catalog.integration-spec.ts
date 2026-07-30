import { createDataSource } from '../database/data-source.js';
import { Role } from './entities/role.entity.js';
import { seedRbacCatalog } from './seed-rbac-catalog.js';

describe('seedRbacCatalog (integration)', () => {
  const dataSource = createDataSource();

  beforeAll(async () => {
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM role_permissions');
    await dataSource.query('DELETE FROM permissions');
    await dataSource.query('DELETE FROM roles');
  });

  it('creates the fixed 14-role platform catalog', async () => {
    await seedRbacCatalog(dataSource);
    const roles = await dataSource.getRepository(Role).find();
    expect(roles).toHaveLength(14);
    expect(roles.map((r) => r.name)).toEqual(
      expect.arrayContaining(['Super Admin', 'Hospital Admin', 'Doctor', 'Patient']),
    );
  });

  it('marks Super Admin as bypassing checks and cross-tenant', async () => {
    await seedRbacCatalog(dataSource);
    const superAdmin = await dataSource.getRepository(Role).findOneOrFail({
      where: { name: 'Super Admin' },
    });
    expect(superAdmin.bypassesPermissionChecks).toBe(true);
    expect(superAdmin.isCrossTenant).toBe(true);
  });

  it('is idempotent — running it twice does not duplicate roles', async () => {
    await seedRbacCatalog(dataSource);
    await seedRbacCatalog(dataSource);
    const roles = await dataSource.getRepository(Role).find();
    expect(roles).toHaveLength(14);
  });
});
