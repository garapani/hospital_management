import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PdfService } from '@hospital/pdf';
import { ObjectStorageService } from '@hospital/object-storage';
import { LabCatalogService } from './lab-catalog.service.js';
import { LabWorkflowService } from './lab-workflow.service.js';
import { LabRequisitionNumberGeneratorService } from './lab-requisition-number-generator.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('LabCatalogService catalog update/deactivate (integration)', () => {
  let ctx: TenantTestContext;
  let catalogService: LabCatalogService;
  let labWorkflowService: LabWorkflowService;
  let ordersService: OrdersService;
  let patientsService: PatientsService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'lab_catalog_gap' });
    catalogService = new LabCatalogService(ctx.tenantConnection);
    ordersService = new OrdersService(ctx.tenantConnection);
    patientsService = new PatientsService(ctx.tenantConnection, new PatientNumberGeneratorService(ctx.tenantConnection), new AccountsService(ctx.tenantConnection, ctx.dataSource, ctx.tenantContext), new PdfService());
    labWorkflowService = new LabWorkflowService(
      ctx.tenantConnection,
      new LabRequisitionNumberGeneratorService(ctx.tenantConnection),
      catalogService,
      ordersService,
      patientsService,
      ctx.tenantContext,
      new PdfService(),
      new ObjectStorageService(),
    );
  });

  afterAll(() => teardownTenantTestContext(ctx));

  const DOCTOR_ID = '00000000-0000-4000-8000-0000000000e3';

  async function makeCategory(suffix: string) {
    return ctx.inTenant(() => catalogService.createCategory({ name: `Category ${suffix}` }));
  }

  async function makeTest(suffix: string) {
    return ctx.inTenant(async () => {
      const category = await makeCategory(`for-${suffix}`);
      const test = await catalogService.createTest({
        categoryId: category.id,
        name: `Test ${suffix}`,
        code: `TEST-${suffix}`,
        specimenType: 'Blood',
        price: 100,
      });
      await catalogService.createComponent(test.id, { name: 'Component 1' });
      return { category, test };
    });
  }

  async function makeOrderItem(phoneNumber: string) {
    return ctx.inTenant(async () => {
      const patient = await patientsService.create({
        firstName: 'Test',
        lastName: 'Patient',
        dateOfBirth: '1990-01-01',
        gender: 'Male',
        phoneNumber,
      });
      const order = await ordersService.create({
        patientId: patient.id,
        orderedBy: DOCTOR_ID,
        items: [{ itemType: 'Lab', itemDescription: 'CBC' }],
      });
      return order.items[0];
    });
  }

  describe('updateTest', () => {
    it('applies only the provided fields and leaves the rest untouched', async () => {
      const { test } = await makeTest('update-fields');

      const updated = await ctx.inTenant(() =>
        catalogService.updateTest(test.id, { name: 'Updated Name', price: 250.5 }),
      );

      expect(updated.name).toBe('Updated Name');
      expect(updated.code).toBe(test.code);
      expect(updated.specimenType).toBe(test.specimenType);
      expect(updated.price).toBe(250.5);

      const refetched = await ctx.inTenant(() => catalogService.getTest(test.id));
      expect(refetched.name).toBe('Updated Name');
      expect(refetched.price).toBe(250.5);
    });

    it('updates code and specimenType when provided', async () => {
      const { test } = await makeTest('update-code');

      const updated = await ctx.inTenant(() =>
        catalogService.updateTest(test.id, { code: 'TEST-UPD', specimenType: 'Urine' }),
      );

      expect(updated.code).toBe('TEST-UPD');
      expect(updated.specimenType).toBe('Urine');
      expect(updated.name).toBe(test.name);
    });

    it('rejects a negative price with BadRequestException', async () => {
      const { test } = await makeTest('update-negative-price');

      await expect(
        ctx.inTenant(() => catalogService.updateTest(test.id, { price: -1 })),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a non-finite price with BadRequestException', async () => {
      const { test } = await makeTest('update-nan-price');

      await expect(
        ctx.inTenant(() => catalogService.updateTest(test.id, { price: Number.NaN })),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for an unknown id', async () => {
      await expect(
        ctx.inTenant(() =>
          catalogService.updateTest('00000000-0000-0000-0000-000000000000', { name: 'Ghost' }),
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deactivateTest / reactivateTest', () => {
    it('deactivates a test; a second deactivate throws ConflictException', async () => {
      const { test } = await makeTest('deactivate-twice');

      const deactivated = await ctx.inTenant(() => catalogService.deactivateTest(test.id));
      expect(deactivated.isActive).toBe(false);

      await expect(ctx.inTenant(() => catalogService.deactivateTest(test.id))).rejects.toThrow(
        ConflictException,
      );
      await expect(ctx.inTenant(() => catalogService.deactivateTest(test.id))).rejects.toThrow(
        'is already deactivated',
      );
    });

    it('reactivates a deactivated test', async () => {
      const { test } = await makeTest('reactivate');

      await ctx.inTenant(() => catalogService.deactivateTest(test.id));
      const reactivated = await ctx.inTenant(() => catalogService.reactivateTest(test.id));

      expect(reactivated.isActive).toBe(true);
    });

    it('deactivate/reactivate on an unknown id throws NotFoundException', async () => {
      await expect(
        ctx.inTenant(() => catalogService.deactivateTest('00000000-0000-0000-0000-000000000000')),
      ).rejects.toThrow(NotFoundException);
      await expect(
        ctx.inTenant(() => catalogService.reactivateTest('00000000-0000-0000-0000-000000000000')),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deactivateCategory / reactivateCategory', () => {
    it('deactivates a category; a second deactivate throws ConflictException', async () => {
      const { category } = await makeTest('category-deactivate');

      const deactivated = await ctx.inTenant(() => catalogService.deactivateCategory(category.id));
      expect(deactivated.isActive).toBe(false);

      await expect(ctx.inTenant(() => catalogService.deactivateCategory(category.id))).rejects.toThrow(
        ConflictException,
      );
      await expect(ctx.inTenant(() => catalogService.deactivateCategory(category.id))).rejects.toThrow(
        'is already deactivated',
      );
    });

    it('reactivates a deactivated category', async () => {
      const { category } = await makeTest('category-reactivate');

      await ctx.inTenant(() => catalogService.deactivateCategory(category.id));
      const reactivated = await ctx.inTenant(() => catalogService.reactivateCategory(category.id));

      expect(reactivated.isActive).toBe(true);
    });

    it('deactivate/reactivate on an unknown id throws NotFoundException', async () => {
      await expect(
        ctx.inTenant(() => catalogService.deactivateCategory('00000000-0000-0000-0000-000000000000')),
      ).rejects.toThrow(NotFoundException);
      await expect(
        ctx.inTenant(() => catalogService.reactivateCategory('00000000-0000-0000-0000-000000000000')),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('lists/get keep returning deactivated rows', () => {
    it('listTestsByCategory and getTest still surface a deactivated test', async () => {
      const { category, test } = await makeTest('stays-visible');

      await ctx.inTenant(() => catalogService.deactivateTest(test.id));

      const list = await ctx.inTenant(() => catalogService.listTestsByCategory(category.id));
      expect(list.some((t) => t.id === test.id && t.isActive === false)).toBe(true);

      const found = await ctx.inTenant(() => catalogService.getTest(test.id));
      expect(found.isActive).toBe(false);
    });

    it('listCategories still surfaces a deactivated category', async () => {
      const { category } = await makeTest('category-stays-visible');

      await ctx.inTenant(() => catalogService.deactivateCategory(category.id));

      const list = await ctx.inTenant(() => catalogService.listCategories());
      expect(list.some((c) => c.id === category.id && c.isActive === false)).toBe(true);
    });
  });

  describe('createRequisition guard', () => {
    it('rejects creating a requisition against a deactivated test with ConflictException', async () => {
      const { test } = await makeTest('guard-reject');
      const orderItem = await makeOrderItem('4470000001');

      await ctx.inTenant(() => catalogService.deactivateTest(test.id));

      await expect(
        ctx.inTenant(() =>
          labWorkflowService.createRequisition({
            orderItemId: orderItem.id,
            testId: test.id,
            specimenType: 'Blood',
          }),
        ),
      ).rejects.toThrow(ConflictException);
      await expect(
        ctx.inTenant(() =>
          labWorkflowService.createRequisition({
            orderItemId: orderItem.id,
            testId: test.id,
            specimenType: 'Blood',
          }),
        ),
      ).rejects.toThrow('is deactivated; cannot create a new requisition against it');
    });

    it('accepts creating a requisition against an active test', async () => {
      const { test } = await makeTest('guard-accept');
      const orderItem = await makeOrderItem('4470000002');

      const requisition = await ctx.inTenant(() =>
        labWorkflowService.createRequisition({
          orderItemId: orderItem.id,
          testId: test.id,
          specimenType: 'Blood',
        }),
      );

      expect(requisition.testId).toBe(test.id);
      expect(requisition.status).toBe('Pending');
    });
  });

  describe('createTest guard', () => {
    it('rejects creating a test under a deactivated category with ConflictException', async () => {
      const category = await makeCategory('deactivated-for-test');
      await ctx.inTenant(() => catalogService.deactivateCategory(category.id));

      await expect(
        ctx.inTenant(() =>
          catalogService.createTest({
            categoryId: category.id,
            name: 'Should Not Be Created',
            code: 'GUARD-CAT-DEACT',
            specimenType: 'Blood',
          }),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a duplicate test code with ConflictException', async () => {
      const category = await makeCategory('dup-code');
      await ctx.inTenant(() =>
        catalogService.createTest({ categoryId: category.id, name: 'First', code: 'DUP-CODE-1', specimenType: 'Blood' }),
      );

      await expect(
        ctx.inTenant(() =>
          catalogService.createTest({ categoryId: category.id, name: 'Second', code: 'DUP-CODE-1', specimenType: 'Blood' }),
        ),
      ).rejects.toThrow(ConflictException);
      await expect(
        ctx.inTenant(() =>
          catalogService.createTest({ categoryId: category.id, name: 'Second', code: 'DUP-CODE-1', specimenType: 'Blood' }),
        ),
      ).rejects.toThrow('is already in use');
    });
  });
});
