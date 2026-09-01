import { DirectoryService } from './directory.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import { MasterDataService } from '../master-data/master-data.service.js';
import { InventoryCatalogService } from '../inventory/inventory-catalog.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('DirectoryService (integration)', () => {
  let ctx: TenantTestContext;
  let directoryService: DirectoryService;
  let patientsService: PatientsService;
  let masterDataService: MasterDataService;
  let inventoryCatalogService: InventoryCatalogService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'directory', seedRbac: true });
    directoryService = new DirectoryService(ctx.tenantConnection);
    const patientSequence = new PatientNumberGeneratorService(ctx.tenantConnection);
    patientsService = new PatientsService(ctx.tenantConnection, patientSequence, ctx.accountsService);
    masterDataService = new MasterDataService(ctx.tenantConnection);
    inventoryCatalogService = new InventoryCatalogService(ctx.tenantConnection);
  });

  afterAll(() => teardownTenantTestContext(ctx));

  it('resolves patients, doctors, wards, beds, and items in one call', async () => {
    const patient = await ctx.inTenant(() =>
      patientsService.create({
        firstName: 'Jane', lastName: 'Doe', gender: 'Female', phoneNumber: '9990000001',
      }),
    );
    const doctor = await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
        username: `dr.resolve.${Date.now()}`,
        email: 'dr.resolve@example.com',
        displayName: 'Dr. Resolve',
        password: 'correct horse battery staple',
        roleName: 'Doctor',
      }),
    );
    const ward = await ctx.inTenant(() => masterDataService.createWard({ wardCode: `DIR-${Date.now()}`, wardName: 'Directory Ward' }));
    const bed = await ctx.inTenant(() => masterDataService.createBed({ wardId: ward.id, bedNumber: 'D1' }));
    const category = await ctx.inTenant(() => inventoryCatalogService.createCategory({ name: 'Directory Category' }));
    const subCategory = await ctx.inTenant(() =>
      inventoryCatalogService.createSubCategory({ categoryId: category.id, name: 'Directory Sub-category' }),
    );
    const item = await ctx.inTenant(() =>
      inventoryCatalogService.createItem({
        subCategoryId: subCategory.id,
        name: 'Directory Item',
        code: `DIR-ITEM-${Date.now()}`,
        unitOfMeasure: 'unit',
      }),
    );

    const result = await ctx.inTenant(() =>
      directoryService.resolve({
        patientIds: [patient.id],
        doctorIds: [doctor.id],
        wardIds: [ward.id],
        bedIds: [bed.id],
        itemIds: [item.id],
      }),
    );

    expect(result.patients[patient.id]).toEqual({ displayName: 'Jane Doe', patientNo: patient.patientNo });
    expect(result.doctors[doctor.id]).toEqual({ displayName: 'Dr. Resolve' });
    expect(result.wards[ward.id]).toEqual({ displayName: 'Directory Ward' });
    expect(result.beds[bed.id]).toEqual({ displayName: 'D1' });
    expect(result.items[item.id]).toEqual({ displayName: 'Directory Item' });
  });

  it('returns empty maps when no ids are supplied, and silently omits unknown ids', async () => {
    const empty = await ctx.inTenant(() => directoryService.resolve({}));
    expect(empty).toEqual({ patients: {}, doctors: {}, wards: {}, beds: {}, items: {} });

    const unknown = await ctx.inTenant(() =>
      directoryService.resolve({ patientIds: ['00000000-0000-0000-0000-000000000000'] }),
    );
    expect(unknown.patients).toEqual({});
  });

  it('enforces tenant isolation — a patient from another tenant never resolves', async () => {
    const tenantB = await ctx.createTenant();
    const patient = await ctx.inTenant(() =>
      patientsService.create({
        firstName: 'Isolated', lastName: 'Patient', gender: 'Male', phoneNumber: '9990000002',
      }),
    );

    const result = await tenantB.inTenant(() =>
      directoryService.resolve({ patientIds: [patient.id] }),
    );
    expect(result.patients).toEqual({});
  });
});
