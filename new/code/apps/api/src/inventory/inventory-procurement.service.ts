import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { PurchaseOrder } from './entities/purchase-order.entity.js';
import { PurchaseOrderItem } from './entities/purchase-order-item.entity.js';
import { PurchaseOrderNumberGeneratorService } from './purchase-order-number-generator.service.js';
import { InventoryCatalogService } from './inventory-catalog.service.js';

export interface CreatePurchaseOrderItemInput {
  itemId: string;
  orderedQuantity: number;
  unitCost: number;
}

export interface CreatePurchaseOrderInput {
  vendorId: string;
  orderedBy: string;
  notes?: string;
  items: CreatePurchaseOrderItemInput[];
}

const NON_TERMINAL_PO_STATUSES = ['Ordered', 'PartiallyReceived'];

@Injectable()
export class InventoryProcurementService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly purchaseOrderNumberGenerator: PurchaseOrderNumberGeneratorService,
    private readonly inventoryCatalogService: InventoryCatalogService,
  ) {}

  async createPurchaseOrder(
    input: CreatePurchaseOrderInput,
  ): Promise<PurchaseOrder & { items: PurchaseOrderItem[] }> {
    if (!input.items || input.items.length === 0) {
      throw new BadRequestException('A purchase order must include at least one item');
    }
    for (const line of input.items) {
      if (line.orderedQuantity <= 0) {
        throw new BadRequestException(`Item ${line.itemId} must have a positive orderedQuantity`);
      }
      if (line.unitCost < 0) {
        throw new BadRequestException(`Item ${line.itemId} has a negative unitCost`);
      }
    }

    await this.inventoryCatalogService.getVendor(input.vendorId); // throws NotFoundException if missing
    for (const line of input.items) {
      await this.inventoryCatalogService.getItem(line.itemId); // throws NotFoundException if missing
    }

    const purchaseOrderNumber = await this.purchaseOrderNumberGenerator.generateNextPurchaseOrderNumber();

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const purchaseOrderRepository = manager.getRepository(PurchaseOrder);
      const purchaseOrder = await purchaseOrderRepository.save(
        purchaseOrderRepository.create({
          vendorId: input.vendorId,
          purchaseOrderNumber,
          orderedBy: input.orderedBy,
          notes: input.notes ?? null,
          status: 'Ordered',
        }),
      );

      const itemRepository = manager.getRepository(PurchaseOrderItem);
      const items = await itemRepository.save(
        input.items.map((line) => {
          const itemData: Partial<PurchaseOrderItem> = {
            purchaseOrderId: purchaseOrder.id,
            itemId: line.itemId,
            orderedQuantity: String(line.orderedQuantity),
            unitCost: String(line.unitCost),
          };
          return itemRepository.create(itemData);
        }),
      );

      return { ...purchaseOrder, items };
    });
  }

  async findOne(id: string): Promise<PurchaseOrder & { items: PurchaseOrderItem[] }> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const purchaseOrder = await manager.getRepository(PurchaseOrder).findOne({ where: { id } });
      if (!purchaseOrder) {
        throw new NotFoundException(`Purchase order ${id} not found`);
      }
      const items = await manager
        .getRepository(PurchaseOrderItem)
        .find({ where: { purchaseOrderId: id }, order: { createdAt: 'ASC' } });
      return { ...purchaseOrder, items };
    });
  }

  async listByVendor(vendorId: string): Promise<PurchaseOrder[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(PurchaseOrder).find({ where: { vendorId }, order: { createdAt: 'DESC' } }),
    );
  }

  async cancel(id: string, cancelReason?: string): Promise<PurchaseOrder> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(PurchaseOrder);
      const purchaseOrder = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!purchaseOrder) {
        throw new NotFoundException(`Purchase order ${id} not found`);
      }
      if (purchaseOrder.status !== 'Ordered') {
        throw new ConflictException(
          `Purchase order ${id} can only be cancelled while status is Ordered (current: ${purchaseOrder.status})`,
        );
      }

      purchaseOrder.status = 'Cancelled';
      purchaseOrder.cancelReason = cancelReason ?? null;
      return repository.save(purchaseOrder);
    });
  }
}
