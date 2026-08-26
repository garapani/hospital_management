import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { IsNull } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { PurchaseOrder } from './entities/purchase-order.entity.js';
import { PurchaseOrderItem } from './entities/purchase-order-item.entity.js';
import { PurchaseOrderNumberGeneratorService } from './purchase-order-number-generator.service.js';
import { InventoryCatalogService } from './inventory-catalog.service.js';
import { StockBatch } from './entities/stock-batch.entity.js';
import { StockBalance } from './entities/stock-balance.entity.js';
import { StockTransaction } from './entities/stock-transaction.entity.js';
import { InventoryItem } from './entities/inventory-item.entity.js';
import { paginate, paginateRaw, PaginatedResponseDto, requireParam } from '@hospital/pagination';
import { SearchPurchaseOrdersDto } from './dto/search-purchase-orders.dto.js';
import { SearchStockBalancesDto } from './dto/search-stock-balances.dto.js';

export interface CreatePurchaseOrderItemInput {
  itemId: string;
  orderedQuantity: number;
  unitCost: number;
}

export interface CreatePurchaseOrderInput {
  vendorId: string;
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  orderedBy?: string;
  notes?: string;
  items: CreatePurchaseOrderItemInput[];
}

export interface RecordGoodsReceiptInput {
  batchNumber: string;
  expiryDate?: string;
  unitCost: number;
  mrp?: number;
  receivedQuantity: number;
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  recordedBy?: string;
}

export interface StockBalanceView {
  itemId: string;
  stockBatchId: string;
  batchNumber: string;
  expiryDate: string | null;
  availableQuantity: string;
}

export interface LowStockItemView {
  itemId: string;
  code: string;
  name: string;
  reorderLevel: string;
  minimumStock: string;
  availableQuantity: string;
}

const NON_TERMINAL_PO_STATUSES = ['Ordered', 'PartiallyReceived'];

@Injectable()
export class InventoryProcurementService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly purchaseOrderNumberGenerator: PurchaseOrderNumberGeneratorService,
    private readonly inventoryCatalogService: InventoryCatalogService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Actor fields (`orderedBy`, `recordedBy`) are never trusted from the caller: the authenticated
   * principal (TenantContextService.accountId, set by TenantContextMiddleware from the verified
   * JWT) wins; the passed value is only a fallback for non-HTTP callers (service specs) that run
   * without a tenant context. These fields are audit-trail integrity markers, so spoofing them
   * would be an audit-trail integrity breach.
   */
  private resolveActor(fallback?: string): string {
    return this.tenantContext.getAccountId() ?? (fallback as string);
  }

  async createPurchaseOrder(
    input: CreatePurchaseOrderInput,
  ): Promise<PurchaseOrder & { items: PurchaseOrderItem[] }> {
    if (!input.items || input.items.length === 0) {
      throw new BadRequestException('A purchase order must include at least one item');
    }

    const validatedItems: Array<{ itemId: string; orderedQuantity: number; unitCost: number }> = [];
    for (const line of input.items) {
      const orderedQuantity = Number(line.orderedQuantity);
      if (
        typeof line.orderedQuantity !== 'number' ||
        !Number.isFinite(orderedQuantity) ||
        orderedQuantity <= 0
      ) {
        throw new BadRequestException(`Item ${line.itemId} must have a positive orderedQuantity`);
      }
      const unitCost = Number(line.unitCost);
      if (typeof line.unitCost !== 'number' || !Number.isFinite(unitCost) || unitCost < 0) {
        throw new BadRequestException(`Item ${line.itemId} has a negative unitCost`);
      }
      validatedItems.push({ itemId: line.itemId, orderedQuantity, unitCost });
    }

    await this.inventoryCatalogService.getVendor(input.vendorId); // throws NotFoundException if missing
    // Single batched existence check instead of one getItem call (and transaction) per line.
    await this.inventoryCatalogService.getItemsByIds(validatedItems.map((line) => line.itemId));

    const purchaseOrderNumber = await this.purchaseOrderNumberGenerator.generateNextPurchaseOrderNumber();

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const purchaseOrderRepository = manager.getRepository(PurchaseOrder);
      const purchaseOrder = await purchaseOrderRepository.save(
        purchaseOrderRepository.create({
          vendorId: input.vendorId,
          purchaseOrderNumber,
          orderedBy: this.resolveActor(input.orderedBy),
          notes: input.notes ?? null,
          status: 'Ordered',
        }),
      );

      const itemRepository = manager.getRepository(PurchaseOrderItem);
      const items = await itemRepository.save(
        validatedItems.map((line) => {
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

  async listByVendor(query: SearchPurchaseOrdersDto): Promise<PaginatedResponseDto<PurchaseOrder>> {
    const vendorId = requireParam(query.vendorId, 'vendorId');
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(PurchaseOrder).createQueryBuilder('po');
      qb.where('po.vendorId = :vendorId', { vendorId });
      qb.orderBy('po.createdAt', 'DESC');
      return paginate(qb, query);
    });
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

  async recordGoodsReceipt(
    purchaseOrderItemId: string,
    input: RecordGoodsReceiptInput,
  ): Promise<PurchaseOrderItem> {
    const receivedQuantity = Number(input.receivedQuantity);
    if (
      typeof input.receivedQuantity !== 'number' ||
      !Number.isFinite(receivedQuantity) ||
      receivedQuantity <= 0
    ) {
      throw new BadRequestException('receivedQuantity must be a positive number');
    }
    const unitCost = Number(input.unitCost);
    if (typeof input.unitCost !== 'number' || !Number.isFinite(unitCost) || unitCost < 0) {
      throw new BadRequestException('unitCost must be a non-negative number');
    }
    const mrp = input.mrp === undefined || input.mrp === null ? null : Number(input.mrp);
    if (mrp !== null && (typeof input.mrp !== 'number' || !Number.isFinite(mrp))) {
      throw new BadRequestException('mrp must be a number');
    }
    // Receiving already-expired stock is never a legitimate goods receipt — almost always a
    // data-entry error — and would otherwise feed FEFO a batch that's dead on arrival (plain
    // ISO-string comparison, safe since expiryDate is a validated YYYY-MM-DD date; matches
    // vaccination's administeredDate future-date guard from the same review pass).
    if (input.expiryDate && input.expiryDate < new Date().toISOString().slice(0, 10)) {
      throw new BadRequestException(`expiryDate ${input.expiryDate} is in the past`);
    }

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const poItemRepository = manager.getRepository(PurchaseOrderItem);
      const poItem = await poItemRepository.findOne({
        where: { id: purchaseOrderItemId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!poItem) {
        throw new NotFoundException(`Purchase order item ${purchaseOrderItemId} not found`);
      }

      const purchaseOrderRepository = manager.getRepository(PurchaseOrder);
      const purchaseOrder = await purchaseOrderRepository.findOne({
        where: { id: poItem.purchaseOrderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!purchaseOrder) {
        throw new NotFoundException(`Purchase order ${poItem.purchaseOrderId} not found`);
      }
      if (!NON_TERMINAL_PO_STATUSES.includes(purchaseOrder.status)) {
        throw new ConflictException(
          `Purchase order ${purchaseOrder.id} cannot receive goods from status ${purchaseOrder.status}`,
        );
      }

      const newReceivedQuantity = Number(poItem.receivedQuantity) + receivedQuantity;
      if (newReceivedQuantity > Number(poItem.orderedQuantity)) {
        throw new BadRequestException(
          `Receiving ${receivedQuantity} would exceed the ordered quantity for line ${purchaseOrderItemId} ` +
            `(ordered: ${poItem.orderedQuantity}, already received: ${poItem.receivedQuantity})`,
        );
      }

      const stockBatch = await this.findOrCreateStockBatch(manager, {
        itemId: poItem.itemId,
        batchNumber: input.batchNumber,
        expiryDate: input.expiryDate ?? null,
        unitCost,
        mrp,
      });

      await manager.getRepository(StockTransaction).save(
        manager.getRepository(StockTransaction).create({
          itemId: poItem.itemId,
          stockBatchId: stockBatch.id,
          transactionType: 'GoodsReceipt',
          referenceId: poItem.id,
          quantity: String(receivedQuantity),
          recordedBy: this.resolveActor(input.recordedBy),
        }),
      );

      await manager.query(
        `
        INSERT INTO stock_balances ("itemId", "stockBatchId", "availableQuantity")
        VALUES ($1, $2, $3)
        ON CONFLICT ("itemId", "stockBatchId")
        DO UPDATE SET "availableQuantity" = stock_balances."availableQuantity" + excluded."availableQuantity"
        `,
        [poItem.itemId, stockBatch.id, receivedQuantity],
      );

      poItem.receivedQuantity = String(newReceivedQuantity);
      const savedPoItem = await poItemRepository.save(poItem);

      const siblingItems = await poItemRepository.find({ where: { purchaseOrderId: purchaseOrder.id } });
      const fullyReceived = siblingItems.every(
        (line) => Number(line.receivedQuantity) >= Number(line.orderedQuantity),
      );
      purchaseOrder.status = fullyReceived ? 'Received' : 'PartiallyReceived';
      await purchaseOrderRepository.save(purchaseOrder);

      return savedPoItem;
    });
  }

  private async findOrCreateStockBatch(
    manager: EntityManager,
    input: { itemId: string; batchNumber: string; expiryDate: string | null; unitCost: number; mrp: number | null },
  ): Promise<StockBatch> {
    const repository = manager.getRepository(StockBatch);

    if (input.expiryDate === null) {
      const inserted = await manager.query<Array<{ id: string }>>(
        `
        INSERT INTO stock_batches ("itemId", "batchNumber", "expiryDate", "unitCost", mrp)
        VALUES ($1, $2, NULL, $3, $4)
        ON CONFLICT ("itemId", "batchNumber") WHERE "expiryDate" IS NULL DO NOTHING
        RETURNING *
        `,
        [input.itemId, input.batchNumber, input.unitCost, input.mrp],
      );
      if (inserted.length > 0) {
        return repository.findOneOrFail({ where: { id: inserted[0].id } });
      }
      const existing = await repository.findOne({
        where: { itemId: input.itemId, batchNumber: input.batchNumber, expiryDate: IsNull() },
      });
      if (!existing) {
        throw new ConflictException(
          `Stock batch race for item ${input.itemId} / batch ${input.batchNumber} (no expiry) could not be resolved`,
        );
      }
      // Batch cost is fixed at first receipt by design: a subsequent goods receipt against the
      // same item/batchNumber (no expiry) that reports a different unitCost/mrp does NOT update
      // the existing batch row. This is intentional, not an oversight — do not silently "fix" it
      // without also deciding what should happen to already-issued stock priced at the old cost.
      return existing;
    }

    const inserted = await manager.query<Array<{ id: string }>>(
      `
      INSERT INTO stock_batches ("itemId", "batchNumber", "expiryDate", "unitCost", mrp)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT ("itemId", "batchNumber", "expiryDate") WHERE "expiryDate" IS NOT NULL DO NOTHING
      RETURNING *
      `,
      [input.itemId, input.batchNumber, input.expiryDate, input.unitCost, input.mrp],
    );
    if (inserted.length > 0) {
      return repository.findOneOrFail({ where: { id: inserted[0].id } });
    }
    const existing = await repository.findOne({
      where: { itemId: input.itemId, batchNumber: input.batchNumber, expiryDate: input.expiryDate },
    });
    if (!existing) {
      throw new ConflictException(
        `Stock batch race for item ${input.itemId} / batch ${input.batchNumber} / expiry ${input.expiryDate} could not be resolved`,
      );
    }
    // Batch cost is fixed at first receipt by design: a subsequent goods receipt against the same
    // item/batchNumber/expiryDate that reports a different unitCost/mrp does NOT update the
    // existing batch row. This is intentional, not an oversight — do not silently "fix" it without
    // also deciding what should happen to already-issued stock priced at the old cost.
    return existing;
  }

  async listStockBalances(query: SearchStockBalancesDto): Promise<PaginatedResponseDto<StockBalanceView>> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const qb = manager
        .createQueryBuilder(StockBalance, 'balance')
        .innerJoin(StockBatch, 'batch', 'batch.id = balance.stockBatchId')
        .select('balance.itemId', 'itemId')
        .addSelect('balance.stockBatchId', 'stockBatchId')
        .addSelect('batch.batchNumber', 'batchNumber')
        .addSelect("to_char(batch.expiryDate, 'YYYY-MM-DD')", 'expiryDate')
        .addSelect('balance.availableQuantity', 'availableQuantity');
      if (query.itemId) {
        qb.where('balance.itemId = :itemId', { itemId: query.itemId });
      }
      return paginateRaw(qb, query);
    });
  }

  /**
   * `reorderLevel`/`minimumStock` were stored on every item but never queried anywhere
   * (code-review-findings-2026-08-25 inventory P2) — this is the first read path for them.
   * Not paginated: unlike every other list in this module, the result set is bounded by business
   * meaning (only items actually low on stock), not by data volume, and `paginateRaw`'s shared
   * `getCount()` isn't a good fit for a GROUP BY/HAVING aggregate query.
   */
  async listLowStockItems(): Promise<LowStockItemView[]> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      return manager
        .createQueryBuilder(InventoryItem, 'item')
        .leftJoin(StockBalance, 'balance', 'balance."itemId" = item.id')
        .where('item."isActive" = true')
        .select('item.id', 'itemId')
        .addSelect('item.code', 'code')
        .addSelect('item.name', 'name')
        .addSelect('item."reorderLevel"', 'reorderLevel')
        .addSelect('item."minimumStock"', 'minimumStock')
        .addSelect('COALESCE(SUM(balance."availableQuantity"), 0)', 'availableQuantity')
        .groupBy('item.id')
        .having('COALESCE(SUM(balance."availableQuantity"), 0) <= item."reorderLevel"')
        .orderBy('(item."reorderLevel" - COALESCE(SUM(balance."availableQuantity"), 0))', 'DESC')
        .getRawMany<LowStockItemView>();
    });
  }
}
