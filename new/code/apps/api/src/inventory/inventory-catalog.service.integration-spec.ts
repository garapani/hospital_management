import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { InventoryCatalogService } from './inventory-catalog.service.js';
import { FefoStockDecrementService } from './fefo-stock-decrement.service.js';
import { PharmacyDispensingService } from '../pharmacy/pharmacy-dispensing.service.js';
import { PharmacyDispensingNumberGeneratorService } from '../pharmacy/pharmacy-dispensing-number-generator.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('InventoryCatalogService catalog update/deactivate (integration)', () => {
  let ctx: TenantTestContext;
  let inventoryCatalogService: InventoryCatalogService;
  let ordersService: OrdersService;
  let dispensingService: PharmacyDispensingService;
  let patientsService: PatientsService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'inventory_catalog_gap' });
    inventoryCatalogService = new InventoryCatalogService(ctx.tenantConnection);
    ordersService = new OrdersService(ctx.tenantConnection);
    dispensingService = new PharmacyDispensingService(
      ctx.tenantConnection,
      new PharmacyDispensingNumberGeneratorService(ctx.tenantConnection),
      inventoryCatalogService,
      ordersService,
      new FefoStockDecrementService(),
      ctx.tenantContext,
    );
    patientsService = new PatientsService(
      ctx.tenantConnection,
      new PatientNumberGeneratorService(ctx.tenantConnection),
      new AccountsService(ctx.tenantConnection, ctx.dataSource, ctx.tenantContext),
    );
  });

  afterAll(() => teardownTenantTestContext(ctx));

  const DOCTOR_ID = '00000000-0000-0000-0000-0000000000e5';

  async function makeCategory(suffix: string) {
    return ctx.inTenant(() => inventoryCatalogService.createCategory({ name: `Category ${suffix}` }));
  }

  async function makeSubCategory(suffix: string) {
    return ctx.inTenant(async () => {
      const category = await makeCategory(`for-${suffix}`);
      return inventoryCatalogService.createSubCategory({
        categoryId: category.id,
        name: `SubCategory ${suffix}`,
        isConsumable: true,
      });
    });
  }

  async function makeItem(suffix: string) {
    return ctx.inTenant(async () => {
      const subCategory = await makeSubCategory(`for-${suffix}`);
      return inventoryCatalogService.createItem({
        subCategoryId: subCategory.id,
        name: `Item ${suffix}`,
        code: `ITEM-${suffix}`,
        unitOfMeasure: 'Tablet',
        reorderLevel: 5,
        minimumStock: 2,
        salePrice: 100,
      });
    });
  }

  async function makeVendor(suffix: string) {
    return ctx.inTenant(() => inventoryCatalogService.createVendor({ name: `Vendor ${suffix}` }));
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
        items: [{ itemType: 'Pharmacy', itemDescription: 'Paracetamol 500mg' }],
      });
      return order.items[0];
    });
  }

  describe('createItem', () => {
    it('rejects a duplicate code', async () => {
      const subCategory = await makeSubCategory('duplicate-code');
      await ctx.inTenant(() =>
        inventoryCatalogService.createItem({
          subCategoryId: subCategory.id,
          name: 'First Item',
          code: 'DUP-CODE',
          unitOfMeasure: 'Tablet',
        }),
      );

      await expect(
        ctx.inTenant(() =>
          inventoryCatalogService.createItem({
            subCategoryId: subCategory.id,
            name: 'Second Item',
            code: 'DUP-CODE',
            unitOfMeasure: 'Tablet',
          }),
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateItem', () => {
    it('applies only the provided fields and leaves the rest untouched', async () => {
      const item = await makeItem('update-fields');

      const updated = await ctx.inTenant(() =>
        inventoryCatalogService.updateItem(item.id, {
          name: 'Updated Item',
          unitOfMeasure: 'Bottle',
          reorderLevel: 10,
          minimumStock: 3,
          salePrice: 250.5,
        }),
      );

      expect(updated.name).toBe('Updated Item');
      expect(updated.code).toBe(item.code);
      expect(updated.unitOfMeasure).toBe('Bottle');
      expect(updated.reorderLevel).toBe('10');
      expect(updated.minimumStock).toBe('3');
      expect(updated.salePrice).toBe(250.5);

      const refetched = await ctx.inTenant(() => inventoryCatalogService.getItem(item.id));
      expect(refetched.name).toBe('Updated Item');
      expect(refetched.reorderLevel).toBe('10');
      expect(refetched.salePrice).toBe(250.5);
    });

    it('updates code when provided', async () => {
      const item = await makeItem('update-code');

      const updated = await ctx.inTenant(() =>
        inventoryCatalogService.updateItem(item.id, { code: 'ITEM-UPD' }),
      );

      expect(updated.code).toBe('ITEM-UPD');
      expect(updated.name).toBe(item.name);
      expect(updated.salePrice).toBe(100);
    });

    it('rejects a negative reorderLevel with BadRequestException', async () => {
      const item = await makeItem('update-negative-reorder');

      await expect(
        ctx.inTenant(() => inventoryCatalogService.updateItem(item.id, { reorderLevel: -1 })),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects updating to a code already used by another item', async () => {
      const existing = await makeItem('update-code-conflict-existing');
      const item = await makeItem('update-code-conflict');

      await expect(
        ctx.inTenant(() => inventoryCatalogService.updateItem(item.id, { code: existing.code })),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a negative minimumStock with BadRequestException', async () => {
      const item = await makeItem('update-negative-minstock');

      await expect(
        ctx.inTenant(() => inventoryCatalogService.updateItem(item.id, { minimumStock: -1 })),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a negative salePrice with BadRequestException', async () => {
      const item = await makeItem('update-negative-price');

      await expect(
        ctx.inTenant(() => inventoryCatalogService.updateItem(item.id, { salePrice: -1 })),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a non-finite salePrice with BadRequestException', async () => {
      const item = await makeItem('update-nan-price');

      await expect(
        ctx.inTenant(() => inventoryCatalogService.updateItem(item.id, { salePrice: Number.NaN })),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for an unknown id', async () => {
      await expect(
        ctx.inTenant(() =>
          inventoryCatalogService.updateItem('00000000-0000-0000-0000-000000000000', { name: 'Ghost' }),
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deactivateItem / reactivateItem', () => {
    it('deactivates an item; a second deactivate throws ConflictException', async () => {
      const item = await makeItem('deactivate-twice');

      const deactivated = await ctx.inTenant(() => inventoryCatalogService.deactivateItem(item.id));
      expect(deactivated.isActive).toBe(false);

      await expect(ctx.inTenant(() => inventoryCatalogService.deactivateItem(item.id))).rejects.toThrow(
        ConflictException,
      );
      await expect(ctx.inTenant(() => inventoryCatalogService.deactivateItem(item.id))).rejects.toThrow(
        'is already deactivated',
      );
    });

    it('reactivates a deactivated item', async () => {
      const item = await makeItem('reactivate');

      await ctx.inTenant(() => inventoryCatalogService.deactivateItem(item.id));
      const reactivated = await ctx.inTenant(() => inventoryCatalogService.reactivateItem(item.id));

      expect(reactivated.isActive).toBe(true);
    });

    it('deactivate/reactivate on an unknown id throws NotFoundException', async () => {
      await expect(
        ctx.inTenant(() => inventoryCatalogService.deactivateItem('00000000-0000-0000-0000-000000000000')),
      ).rejects.toThrow(NotFoundException);
      await expect(
        ctx.inTenant(() => inventoryCatalogService.reactivateItem('00000000-0000-0000-0000-000000000000')),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deactivateCategory / reactivateCategory', () => {
    it('deactivates a category; a second deactivate throws ConflictException', async () => {
      const category = await makeCategory('category-deactivate');

      const deactivated = await ctx.inTenant(() => inventoryCatalogService.deactivateCategory(category.id));
      expect(deactivated.isActive).toBe(false);

      await expect(
        ctx.inTenant(() => inventoryCatalogService.deactivateCategory(category.id)),
      ).rejects.toThrow(ConflictException);
      await expect(
        ctx.inTenant(() => inventoryCatalogService.deactivateCategory(category.id)),
      ).rejects.toThrow('is already deactivated');
    });

    it('reactivates a deactivated category', async () => {
      const category = await makeCategory('category-reactivate');

      await ctx.inTenant(() => inventoryCatalogService.deactivateCategory(category.id));
      const reactivated = await ctx.inTenant(() => inventoryCatalogService.reactivateCategory(category.id));

      expect(reactivated.isActive).toBe(true);
    });

    it('deactivate/reactivate on an unknown id throws NotFoundException', async () => {
      await expect(
        ctx.inTenant(() => inventoryCatalogService.deactivateCategory('00000000-0000-0000-0000-000000000000')),
      ).rejects.toThrow(NotFoundException);
      await expect(
        ctx.inTenant(() => inventoryCatalogService.reactivateCategory('00000000-0000-0000-0000-000000000000')),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deactivateSubCategory / reactivateSubCategory', () => {
    it('deactivates a sub-category; a second deactivate throws ConflictException', async () => {
      const subCategory = await makeSubCategory('subcategory-deactivate');

      const deactivated = await ctx.inTenant(() =>
        inventoryCatalogService.deactivateSubCategory(subCategory.id),
      );
      expect(deactivated.isActive).toBe(false);

      await expect(
        ctx.inTenant(() => inventoryCatalogService.deactivateSubCategory(subCategory.id)),
      ).rejects.toThrow(ConflictException);
      await expect(
        ctx.inTenant(() => inventoryCatalogService.deactivateSubCategory(subCategory.id)),
      ).rejects.toThrow('is already deactivated');
    });

    it('reactivates a deactivated sub-category', async () => {
      const subCategory = await makeSubCategory('subcategory-reactivate');

      await ctx.inTenant(() => inventoryCatalogService.deactivateSubCategory(subCategory.id));
      const reactivated = await ctx.inTenant(() =>
        inventoryCatalogService.reactivateSubCategory(subCategory.id),
      );

      expect(reactivated.isActive).toBe(true);
    });

    it('deactivate/reactivate on an unknown id throws NotFoundException', async () => {
      await expect(
        ctx.inTenant(() =>
          inventoryCatalogService.deactivateSubCategory('00000000-0000-0000-0000-000000000000'),
        ),
      ).rejects.toThrow(NotFoundException);
      await expect(
        ctx.inTenant(() =>
          inventoryCatalogService.reactivateSubCategory('00000000-0000-0000-0000-000000000000'),
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deactivateVendor / reactivateVendor', () => {
    it('deactivates a vendor; a second deactivate throws ConflictException', async () => {
      const vendor = await makeVendor('vendor-deactivate');

      const deactivated = await ctx.inTenant(() => inventoryCatalogService.deactivateVendor(vendor.id));
      expect(deactivated.isActive).toBe(false);

      await expect(
        ctx.inTenant(() => inventoryCatalogService.deactivateVendor(vendor.id)),
      ).rejects.toThrow(ConflictException);
      await expect(
        ctx.inTenant(() => inventoryCatalogService.deactivateVendor(vendor.id)),
      ).rejects.toThrow('is already deactivated');
    });

    it('reactivates a deactivated vendor', async () => {
      const vendor = await makeVendor('vendor-reactivate');

      await ctx.inTenant(() => inventoryCatalogService.deactivateVendor(vendor.id));
      const reactivated = await ctx.inTenant(() => inventoryCatalogService.reactivateVendor(vendor.id));

      expect(reactivated.isActive).toBe(true);
    });

    it('deactivate/reactivate on an unknown id throws NotFoundException', async () => {
      await expect(
        ctx.inTenant(() => inventoryCatalogService.deactivateVendor('00000000-0000-0000-0000-000000000000')),
      ).rejects.toThrow(NotFoundException);
      await expect(
        ctx.inTenant(() => inventoryCatalogService.reactivateVendor('00000000-0000-0000-0000-000000000000')),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('lists/get keep returning deactivated rows', () => {
    it('listItemsBySubCategory and getItem still surface a deactivated item', async () => {
      const subCategory = await makeSubCategory('item-stays-visible');
      const item = await ctx.inTenant(() =>
        inventoryCatalogService.createItem({
          subCategoryId: subCategory.id,
          name: 'Item stays-visible',
          code: 'ITEM-STAYS-VISIBLE',
          unitOfMeasure: 'Tablet',
        }),
      );

      await ctx.inTenant(() => inventoryCatalogService.deactivateItem(item.id));

      const list = await ctx.inTenant(() => inventoryCatalogService.listItemsBySubCategory(subCategory.id));
      expect(list.some((i) => i.id === item.id && i.isActive === false)).toBe(true);

      const found = await ctx.inTenant(() => inventoryCatalogService.getItem(item.id));
      expect(found.isActive).toBe(false);
    });

    it('listCategories still surfaces a deactivated category', async () => {
      const category = await makeCategory('category-stays-visible');

      await ctx.inTenant(() => inventoryCatalogService.deactivateCategory(category.id));

      const list = await ctx.inTenant(() => inventoryCatalogService.listCategories());
      expect(list.some((c) => c.id === category.id && c.isActive === false)).toBe(true);
    });

    it('listSubCategoriesByCategory still surfaces a deactivated sub-category', async () => {
      const category = await makeCategory('subcategory-stays-visible');
      const subCategory = await ctx.inTenant(() =>
        inventoryCatalogService.createSubCategory({
          categoryId: category.id,
          name: 'SubCategory stays-visible',
        }),
      );

      await ctx.inTenant(() => inventoryCatalogService.deactivateSubCategory(subCategory.id));

      const list = await ctx.inTenant(() =>
        inventoryCatalogService.listSubCategoriesByCategory(category.id),
      );
      expect(list.some((s) => s.id === subCategory.id && s.isActive === false)).toBe(true);
    });

    it('listVendors still surfaces a deactivated vendor', async () => {
      const vendor = await makeVendor('vendor-stays-visible');

      await ctx.inTenant(() => inventoryCatalogService.deactivateVendor(vendor.id));

      const list = await ctx.inTenant(() => inventoryCatalogService.listVendors());
      expect(list.some((v) => v.id === vendor.id && v.isActive === false)).toBe(true);
    });
  });

  describe('createDispensing guard', () => {
    it('rejects creating a dispensing against a deactivated item with ConflictException', async () => {
      const item = await makeItem('guard-reject');
      const orderItem = await makeOrderItem('4472000001');

      await ctx.inTenant(() => inventoryCatalogService.deactivateItem(item.id));

      await expect(
        ctx.inTenant(() =>
          dispensingService.createDispensing({
            orderItemId: orderItem.id,
            inventoryItemId: item.id,
            quantity: 2,
          }),
        ),
      ).rejects.toThrow(ConflictException);
      await expect(
        ctx.inTenant(() =>
          dispensingService.createDispensing({
            orderItemId: orderItem.id,
            inventoryItemId: item.id,
            quantity: 2,
          }),
        ),
      ).rejects.toThrow('is deactivated; cannot create a new dispensing against it');
    });

    it('accepts creating a dispensing against an active item', async () => {
      const item = await makeItem('guard-accept');
      const orderItem = await makeOrderItem('4472000002');

      const dispensing = await ctx.inTenant(() =>
        dispensingService.createDispensing({
          orderItemId: orderItem.id,
          inventoryItemId: item.id,
          quantity: 2,
        }),
      );

      expect(dispensing.status).toBe('Pending');
      expect(dispensing.inventoryItemId).toBe(item.id);
    });
  });
});
