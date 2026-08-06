import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { MasterDataService } from '../master-data/master-data.service.js';
import { StockRequisition } from './entities/stock-requisition.entity.js';
import { StockRequisitionItem } from './entities/stock-requisition-item.entity.js';
import { StockRequisitionNumberGeneratorService } from './stock-requisition-number-generator.service.js';
import { InventoryCatalogService } from './inventory-catalog.service.js';
import { StockBatch } from './entities/stock-batch.entity.js';
import { StockBalance } from './entities/stock-balance.entity.js';
import { StockTransaction } from './entities/stock-transaction.entity.js';

export interface CreateRequisitionItemInput {
  itemId: string;
  requestedQuantity: number;
}

export interface CreateRequisitionInput {
  departmentId: string;
  requestedBy: string;
  notes?: string;
  items: CreateRequisitionItemInput[];
}

const NON_TERMINAL_REQUISITION_STATUSES = ['Pending', 'PartiallyFulfilled'];

export interface FulfillRequisitionItemInput {
  quantity: number;
  fulfilledBy: string;
}

@Injectable()
export class InventoryRequisitionService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly requisitionNumberGenerator: StockRequisitionNumberGeneratorService,
    private readonly inventoryCatalogService: InventoryCatalogService,
    private readonly masterDataService: MasterDataService,
  ) {}

  async createRequisition(
    input: CreateRequisitionInput,
  ): Promise<StockRequisition & { items: StockRequisitionItem[] }> {
    if (!input.requestedBy?.trim()) {
      throw new BadRequestException('requestedBy is required');
    }
    if (!input.items || input.items.length === 0) {
      throw new BadRequestException('A requisition must include at least one item');
    }

    const validatedItems: Array<{ itemId: string; requestedQuantity: number }> = [];
    for (const line of input.items) {
      const requestedQuantity = Number(line.requestedQuantity);
      if (
        typeof line.requestedQuantity !== 'number' ||
        !Number.isFinite(requestedQuantity) ||
        requestedQuantity <= 0
      ) {
        throw new BadRequestException(`Item ${line.itemId} must have a positive requestedQuantity`);
      }
      validatedItems.push({ itemId: line.itemId, requestedQuantity });
    }

    const department = await this.masterDataService.getDepartment(input.departmentId);
    if (!department) {
      throw new NotFoundException(`Department ${input.departmentId} not found`);
    }
    // Single batched existence check instead of one getItem call (and transaction) per line.
    await this.inventoryCatalogService.getItemsByIds(validatedItems.map((line) => line.itemId));

    const requisitionNumber = await this.requisitionNumberGenerator.generateNextRequisitionNumber();

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const requisitionRepository = manager.getRepository(StockRequisition);
      const requisition = await requisitionRepository.save(
        requisitionRepository.create({
          departmentId: input.departmentId,
          requestedBy: input.requestedBy,
          requisitionNumber,
          notes: input.notes ?? null,
          status: 'Pending',
        }),
      );

      const itemRepository = manager.getRepository(StockRequisitionItem);
      const items = await itemRepository.save(
        validatedItems.map((line) => {
          const itemData: Partial<StockRequisitionItem> = {
            requisitionId: requisition.id,
            itemId: line.itemId,
            requestedQuantity: String(line.requestedQuantity),
          };
          return itemRepository.create(itemData);
        }),
      );

      return { ...requisition, items };
    });
  }

  async findOne(id: string): Promise<StockRequisition & { items: StockRequisitionItem[] }> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const requisition = await manager.getRepository(StockRequisition).findOne({ where: { id } });
      if (!requisition) {
        throw new NotFoundException(`Stock requisition ${id} not found`);
      }
      const items = await manager
        .getRepository(StockRequisitionItem)
        .find({ where: { requisitionId: id }, order: { createdAt: 'ASC' } });
      return { ...requisition, items };
    });
  }

  async listByDepartment(departmentId: string): Promise<StockRequisition[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(StockRequisition).find({ where: { departmentId }, order: { createdAt: 'DESC' } }),
    );
  }

  async cancel(id: string, cancelReason?: string): Promise<StockRequisition> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(StockRequisition);
      const requisition = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!requisition) {
        throw new NotFoundException(`Stock requisition ${id} not found`);
      }
      if (requisition.status !== 'Pending') {
        throw new ConflictException(
          `Requisition ${id} can only be cancelled while status is Pending (current: ${requisition.status})`,
        );
      }

      requisition.status = 'Cancelled';
      requisition.cancelReason = cancelReason ?? null;
      return repository.save(requisition);
    });
  }

  async fulfillRequisitionItem(
    stockRequisitionItemId: string,
    input: FulfillRequisitionItemInput,
  ): Promise<StockRequisitionItem> {
    if (!input.fulfilledBy?.trim()) {
      throw new BadRequestException('fulfilledBy is required');
    }
    const quantity = Number(input.quantity);
    if (typeof input.quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('quantity must be a positive number');
    }

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const reqItemRepository = manager.getRepository(StockRequisitionItem);
      const reqItem = await reqItemRepository.findOne({
        where: { id: stockRequisitionItemId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!reqItem) {
        throw new NotFoundException(`Stock requisition item ${stockRequisitionItemId} not found`);
      }

      const requisitionRepository = manager.getRepository(StockRequisition);
      const requisition = await requisitionRepository.findOne({
        where: { id: reqItem.requisitionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!requisition) {
        throw new NotFoundException(`Stock requisition ${reqItem.requisitionId} not found`);
      }
      if (!NON_TERMINAL_REQUISITION_STATUSES.includes(requisition.status)) {
        throw new ConflictException(
          `Requisition ${requisition.id} cannot be fulfilled from status ${requisition.status}`,
        );
      }

      const newFulfilledQuantity = Number(reqItem.fulfilledQuantity) + quantity;
      if (newFulfilledQuantity > Number(reqItem.requestedQuantity)) {
        throw new BadRequestException(
          `Fulfilling ${quantity} would exceed the requested quantity for line ${stockRequisitionItemId} ` +
            `(requested: ${reqItem.requestedQuantity}, already fulfilled: ${reqItem.fulfilledQuantity})`,
        );
      }

      // FEFO: lock every StockBalance row for this item with available stock, ordered so
      // nearer-expiry batches are consumed first and no-expiry batches are consumed last.
      const balanceRows = await manager
        .createQueryBuilder(StockBalance, 'balance')
        .innerJoin(StockBatch, 'batch', 'batch.id = balance.stockBatchId')
        .where('balance.itemId = :itemId', { itemId: reqItem.itemId })
        .andWhere('balance.availableQuantity > 0')
        .orderBy('batch.expiryDate', 'ASC', 'NULLS LAST')
        .setLock('pessimistic_write')
        .getMany();

      const totalAvailable = balanceRows.reduce((sum, row) => sum + Number(row.availableQuantity), 0);
      if (totalAvailable < quantity) {
        throw new BadRequestException(
          `Insufficient stock for item ${reqItem.itemId}: requested ${quantity}, available ${totalAvailable}`,
        );
      }

      let remaining = quantity;
      const transactionRepository = manager.getRepository(StockTransaction);
      for (const balanceRow of balanceRows) {
        if (remaining <= 0) break;
        const portion = Math.min(remaining, Number(balanceRow.availableQuantity));

        const updated = await manager.query<Array<{ id: string }>>(
          `
          UPDATE stock_balances
          SET "availableQuantity" = "availableQuantity" - $1
          WHERE id = $2 AND "availableQuantity" >= $1
          RETURNING id
          `,
          [portion, balanceRow.id],
        );
        if (updated.length === 0) {
          throw new Error(
            `Invariant violation: stock balance ${balanceRow.id} changed under lock during fulfillment`,
          );
        }

        await transactionRepository.save(
          transactionRepository.create({
            itemId: reqItem.itemId,
            stockBatchId: balanceRow.stockBatchId,
            transactionType: 'Dispatch',
            referenceId: reqItem.id,
            quantity: String(portion),
            recordedBy: input.fulfilledBy,
          }),
        );

        remaining -= portion;
      }

      reqItem.fulfilledQuantity = String(newFulfilledQuantity);
      const savedReqItem = await reqItemRepository.save(reqItem);

      const siblingItems = await reqItemRepository.find({ where: { requisitionId: requisition.id } });
      const fullyFulfilled = siblingItems.every(
        (line) => Number(line.fulfilledQuantity) >= Number(line.requestedQuantity),
      );
      requisition.status = fullyFulfilled ? 'Fulfilled' : 'PartiallyFulfilled';
      await requisitionRepository.save(requisition);

      return savedReqItem;
    });
  }
}
