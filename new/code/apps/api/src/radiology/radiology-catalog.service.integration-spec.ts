import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { RadiologyCatalogService } from './radiology-catalog.service.js';
import { RadiologyWorkflowService } from './radiology-workflow.service.js';
import { RadiologyRequisitionNumberGeneratorService } from './radiology-requisition-number-generator.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('RadiologyCatalogService catalog update/deactivate (integration)', () => {
  let ctx: TenantTestContext;
  let catalogService: RadiologyCatalogService;
  let workflowService: RadiologyWorkflowService;
  let ordersService: OrdersService;
  let patientsService: PatientsService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'radiology_catalog_gap' });
    catalogService = new RadiologyCatalogService(ctx.tenantConnection);
    ordersService = new OrdersService(ctx.tenantConnection);
    workflowService = new RadiologyWorkflowService(
      ctx.tenantConnection,
      new RadiologyRequisitionNumberGeneratorService(ctx.tenantConnection),
      catalogService,
      ordersService,
      ctx.tenantContext,
    );
    patientsService = new PatientsService(ctx.tenantConnection, new PatientNumberGeneratorService(ctx.tenantConnection));
  });

  afterAll(() => teardownTenantTestContext(ctx));

  const DOCTOR_ID = '00000000-0000-0000-0000-0000000000e4';

  async function makeType(suffix: string) {
    return ctx.inTenant(() =>
      catalogService.createType({ name: `Type ${suffix}`, procedureCoding: `TYPE-${suffix}`, displaySequence: 1 }),
    );
  }

  async function makeItem(suffix: string) {
    return ctx.inTenant(async () => {
      const type = await makeType(`for-${suffix}`);
      const item = await catalogService.createItem({
        imagingTypeId: type.id,
        name: `Item ${suffix}`,
        procedureCode: `ITEM-${suffix}`,
        displaySequence: 2,
        price: 100,
      });
      return { type, item };
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
        items: [{ itemType: 'Radiology', itemDescription: 'Chest X-Ray' }],
      });
      return order.items[0];
    });
  }

  describe('updateItem', () => {
    it('applies only the provided fields and leaves the rest untouched', async () => {
      const { item } = await makeItem('update-fields');

      const updated = await ctx.inTenant(() =>
        catalogService.updateItem(item.id, { name: 'Updated Name', price: 250.5 }),
      );

      expect(updated.name).toBe('Updated Name');
      expect(updated.procedureCode).toBe(item.procedureCode);
      expect(updated.displaySequence).toBe(item.displaySequence);
      expect(updated.price).toBe(250.5);

      const refetched = await ctx.inTenant(() => catalogService.getItem(item.id));
      expect(refetched.name).toBe('Updated Name');
      expect(refetched.price).toBe(250.5);
    });

    it('updates procedureCode and displaySequence when provided', async () => {
      const { item } = await makeItem('update-code');

      const updated = await ctx.inTenant(() =>
        catalogService.updateItem(item.id, { procedureCode: 'ITEM-UPD', displaySequence: 7 }),
      );

      expect(updated.procedureCode).toBe('ITEM-UPD');
      expect(updated.displaySequence).toBe(7);
      expect(updated.name).toBe(item.name);
    });

    it('rejects a negative price with BadRequestException', async () => {
      const { item } = await makeItem('update-negative-price');

      await expect(
        ctx.inTenant(() => catalogService.updateItem(item.id, { price: -1 })),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a non-finite price with BadRequestException', async () => {
      const { item } = await makeItem('update-nan-price');

      await expect(
        ctx.inTenant(() => catalogService.updateItem(item.id, { price: Number.NaN })),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for an unknown id', async () => {
      await expect(
        ctx.inTenant(() =>
          catalogService.updateItem('00000000-0000-0000-0000-000000000000', { name: 'Ghost' }),
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deactivateItem / reactivateItem', () => {
    it('deactivates an item; a second deactivate throws ConflictException', async () => {
      const { item } = await makeItem('deactivate-twice');

      const deactivated = await ctx.inTenant(() => catalogService.deactivateItem(item.id));
      expect(deactivated.isActive).toBe(false);

      await expect(ctx.inTenant(() => catalogService.deactivateItem(item.id))).rejects.toThrow(
        ConflictException,
      );
      await expect(ctx.inTenant(() => catalogService.deactivateItem(item.id))).rejects.toThrow(
        'is already deactivated',
      );
    });

    it('reactivates a deactivated item', async () => {
      const { item } = await makeItem('reactivate');

      await ctx.inTenant(() => catalogService.deactivateItem(item.id));
      const reactivated = await ctx.inTenant(() => catalogService.reactivateItem(item.id));

      expect(reactivated.isActive).toBe(true);
    });

    it('deactivate/reactivate on an unknown id throws NotFoundException', async () => {
      await expect(
        ctx.inTenant(() => catalogService.deactivateItem('00000000-0000-0000-0000-000000000000')),
      ).rejects.toThrow(NotFoundException);
      await expect(
        ctx.inTenant(() => catalogService.reactivateItem('00000000-0000-0000-0000-000000000000')),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deactivateType / reactivateType', () => {
    it('deactivates a type; a second deactivate throws ConflictException', async () => {
      const { type } = await makeItem('type-deactivate');

      const deactivated = await ctx.inTenant(() => catalogService.deactivateType(type.id));
      expect(deactivated.isActive).toBe(false);

      await expect(ctx.inTenant(() => catalogService.deactivateType(type.id))).rejects.toThrow(
        ConflictException,
      );
      await expect(ctx.inTenant(() => catalogService.deactivateType(type.id))).rejects.toThrow(
        'is already deactivated',
      );
    });

    it('reactivates a deactivated type', async () => {
      const { type } = await makeItem('type-reactivate');

      await ctx.inTenant(() => catalogService.deactivateType(type.id));
      const reactivated = await ctx.inTenant(() => catalogService.reactivateType(type.id));

      expect(reactivated.isActive).toBe(true);
    });

    it('deactivate/reactivate on an unknown id throws NotFoundException', async () => {
      await expect(
        ctx.inTenant(() => catalogService.deactivateType('00000000-0000-0000-0000-000000000000')),
      ).rejects.toThrow(NotFoundException);
      await expect(
        ctx.inTenant(() => catalogService.reactivateType('00000000-0000-0000-0000-000000000000')),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('lists/get keep returning deactivated rows', () => {
    it('listItemsByType and getItem still surface a deactivated item', async () => {
      const { type, item } = await makeItem('stays-visible');

      await ctx.inTenant(() => catalogService.deactivateItem(item.id));

      const list = await ctx.inTenant(() => catalogService.listItemsByType(type.id));
      expect(list.some((i) => i.id === item.id && i.isActive === false)).toBe(true);

      const found = await ctx.inTenant(() => catalogService.getItem(item.id));
      expect(found.isActive).toBe(false);
    });

    it('listTypes still surfaces a deactivated type', async () => {
      const { type } = await makeItem('type-stays-visible');

      await ctx.inTenant(() => catalogService.deactivateType(type.id));

      const list = await ctx.inTenant(() => catalogService.listTypes());
      expect(list.some((t) => t.id === type.id && t.isActive === false)).toBe(true);
    });
  });

  describe('createRequisition guard', () => {
    it('rejects creating a requisition against a deactivated imaging item with ConflictException', async () => {
      const { item } = await makeItem('guard-reject');
      const orderItem = await makeOrderItem('4480000001');

      await ctx.inTenant(() => catalogService.deactivateItem(item.id));

      await expect(
        ctx.inTenant(() =>
          workflowService.createRequisition({ orderItemId: orderItem.id, imagingItemId: item.id }),
        ),
      ).rejects.toThrow(ConflictException);
      await expect(
        ctx.inTenant(() =>
          workflowService.createRequisition({ orderItemId: orderItem.id, imagingItemId: item.id }),
        ),
      ).rejects.toThrow('is deactivated; cannot create a new requisition against it');
    });

    it('accepts creating a requisition against an active imaging item', async () => {
      const { item } = await makeItem('guard-accept');
      const orderItem = await makeOrderItem('4480000002');

      const requisition = await ctx.inTenant(() =>
        workflowService.createRequisition({ orderItemId: orderItem.id, imagingItemId: item.id }),
      );

      expect(requisition.imagingItemId).toBe(item.id);
      expect(requisition.status).toBe('Pending');
    });
  });
});
