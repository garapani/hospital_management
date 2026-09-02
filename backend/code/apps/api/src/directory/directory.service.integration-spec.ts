import { DirectoryService } from './directory.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import { PdfService } from '@hospital/pdf';
import { MasterDataService } from '../master-data/master-data.service.js';
import { InventoryCatalogService } from '../inventory/inventory-catalog.service.js';
import { LabCatalogService } from '../lab/lab-catalog.service.js';
import { RadiologyCatalogService } from '../radiology/radiology-catalog.service.js';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { Invoice } from '../billing/entities/invoice.entity.js';
import { Employee } from '../employee/entities/employee.entity.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

const EMPTY_RESULT = { patients: {}, doctors: {}, wards: {}, beds: {}, items: {}, orderItems: {}, tests: {}, imagingItems: {}, invoices: {}, employees: {}, departments: {} };

describe('DirectoryService (integration)', () => {
  let ctx: TenantTestContext;
  let directoryService: DirectoryService;
  let patientsService: PatientsService;
  let masterDataService: MasterDataService;
  let inventoryCatalogService: InventoryCatalogService;
  let labCatalogService: LabCatalogService;
  let radiologyCatalogService: RadiologyCatalogService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'directory', seedRbac: true });
    directoryService = new DirectoryService(ctx.tenantConnection);
    const patientSequence = new PatientNumberGeneratorService(ctx.tenantConnection);
    patientsService = new PatientsService(ctx.tenantConnection, patientSequence, ctx.accountsService, new PdfService());
    masterDataService = new MasterDataService(ctx.tenantConnection);
    inventoryCatalogService = new InventoryCatalogService(ctx.tenantConnection);
    labCatalogService = new LabCatalogService(ctx.tenantConnection);
    radiologyCatalogService = new RadiologyCatalogService(ctx.tenantConnection);
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

  it('resolves order items, lab tests, radiology imaging items, invoices, employees, and departments in one call', async () => {
    const orderItem = await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) => {
        const repository = manager.getRepository(OrderItem);
        return repository.save(
          repository.create({
            orderId: '00000000-0000-4000-8000-000000000000',
            itemType: 'Lab',
            itemDescription: 'Directory CBC',
          }),
        );
      }),
    );
    const labCategory = await ctx.inTenant(() => labCatalogService.createCategory({ name: 'Directory Lab Category' }));
    const test = await ctx.inTenant(() =>
      labCatalogService.createTest({
        categoryId: labCategory.id,
        name: 'Directory Test',
        code: `DIR-TEST-${Date.now()}`,
        specimenType: 'Blood',
      }),
    );
    const imagingType = await ctx.inTenant(() => radiologyCatalogService.createType({ name: 'Directory Imaging Type' }));
    const imagingItem = await ctx.inTenant(() =>
      radiologyCatalogService.createItem({ imagingTypeId: imagingType.id, name: 'Directory Chest X-Ray' }),
    );
    // invoices.createdBy is NOT NULL (stricter than the base AuditableEntity's nullable default,
    // for financial-record traceability) — InvoicesService normally resolves it itself
    // (resolveActor(), predating AuditColumnsSubscriber per that subscriber's own doc comment), so
    // a direct entity-manager insert bypassing that service needs to set it explicitly too.
    const invoice = await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) => {
        const repository = manager.getRepository(Invoice);
        return repository.save(
          repository.create({
            patientId: '00000000-0000-4000-8000-000000000000',
            invoiceNumber: 1,
            financialYear: '2025-26',
            subtotal: 0,
            discountAmount: 0,
            taxableAmount: 0,
            taxAmount: 0,
            totalAmount: 0,
            createdBy: '00000000-0000-4000-8000-0000000000aa',
          }),
        );
      }),
    );
    const employee = await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) => {
        const repository = manager.getRepository(Employee);
        return repository.save(
          repository.create({
            employeeCode: `DIR-EMP-${Date.now()}`,
            firstName: 'Priya',
            lastName: 'Rao',
            joinDate: '2026-01-01',
          }),
        );
      }),
    );

    const department = await ctx.inTenant(() =>
      masterDataService.createDepartment({ departmentCode: `DIR-DEPT-${Date.now()}`, departmentName: 'Directory Department' }),
    );

    const result = await ctx.inTenant(() =>
      directoryService.resolve({
        orderItemIds: [orderItem.id],
        testIds: [test.id],
        imagingItemIds: [imagingItem.id],
        invoiceIds: [invoice.id],
        employeeIds: [employee.id],
        departmentIds: [department.id],
      }),
    );

    expect(result.orderItems[orderItem.id]).toEqual({ displayName: 'Directory CBC' });
    expect(result.tests[test.id]).toEqual({ displayName: 'Directory Test' });
    expect(result.departments[department.id]).toEqual({ displayName: 'Directory Department' });
    expect(result.imagingItems[imagingItem.id]).toEqual({ displayName: 'Directory Chest X-Ray' });
    expect(result.invoices[invoice.id].displayName).toMatch(/^INV-\d{4}-\d{2}-\d{2}-00001$/);
    expect(result.employees[employee.id]).toEqual({ displayName: `Priya Rao (${employee.employeeCode})` });
  });

  it('returns empty maps when no ids are supplied, and silently omits unknown ids', async () => {
    const empty = await ctx.inTenant(() => directoryService.resolve({}));
    expect(empty).toEqual(EMPTY_RESULT);

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
