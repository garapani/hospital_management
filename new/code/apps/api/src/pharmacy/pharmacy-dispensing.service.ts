import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Not, QueryFailedError } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { InventoryCatalogService } from '../inventory/inventory-catalog.service.js';
import { PharmacyDispensing } from './entities/pharmacy-dispensing.entity.js';
import { PharmacyDispensingNumberGeneratorService } from './pharmacy-dispensing-number-generator.service.js';
import { StockBatch } from '../inventory/entities/stock-batch.entity.js';
import { StockBalance } from '../inventory/entities/stock-balance.entity.js';
import { StockTransaction } from '../inventory/entities/stock-transaction.entity.js';
import { InvoicesService } from '../billing/invoices.service.js';

export interface CreateDispensingInput {
  orderItemId: string;
  inventoryItemId: string;
  quantity: number;
}

export interface DispenseDrugInput {
  dispensedBy: string;
}

export interface PharmacyQueryParams {
  orderItemId: string;
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class PharmacyDispensingService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly dispensingNumberGenerator: PharmacyDispensingNumberGeneratorService,
    private readonly inventoryCatalogService: InventoryCatalogService,
    private readonly invoicesService: InvoicesService,
  ) {}

  async createDispensing(input: CreateDispensingInput): Promise<PharmacyDispensing> {
    const quantity = Number(input.quantity);
    if (typeof input.quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('quantity must be a positive number');
    }

    await this.inventoryCatalogService.getItem(input.inventoryItemId); // throws NotFoundException if missing

    const dispensingNumber = await this.dispensingNumberGenerator.generateNextDispensingNumber();

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const orderItem = await manager.getRepository(OrderItem).findOne({ where: { id: input.orderItemId } });
      if (!orderItem) {
        throw new NotFoundException(`Order item ${input.orderItemId} not found`);
      }
      if (orderItem.itemType !== 'Pharmacy') {
        throw new BadRequestException(
          `Order item ${input.orderItemId} is not a Pharmacy order (itemType: ${orderItem.itemType})`,
        );
      }
      if (orderItem.status === 'Cancelled') {
        throw new BadRequestException(`Order item ${input.orderItemId} is cancelled and cannot be dispensed`);
      }

      const dispensingRepository = manager.getRepository(PharmacyDispensing);
      const existing = await dispensingRepository.findOne({
        where: { orderItemId: input.orderItemId, status: Not('Cancelled') },
      });
      if (existing) {
        throw new ConflictException(
          `Order item ${input.orderItemId} already has a non-cancelled dispensing (${existing.id})`,
        );
      }

      try {
        return await dispensingRepository.save(
          dispensingRepository.create({
            orderItemId: input.orderItemId,
            inventoryItemId: input.inventoryItemId,
            dispensingNumber,
            quantity: String(quantity),
            status: 'Pending',
          }),
        );
      } catch (error) {
        if (
          error instanceof QueryFailedError &&
          (error as QueryFailedError & { constraint?: string }).constraint ===
            'UQ_pharmacy_dispensings_active_order_item'
        ) {
          throw new ConflictException(`Order item ${input.orderItemId} already has a non-cancelled dispensing`);
        }
        throw error;
      }
    });
  }

  async findOne(id: string): Promise<PharmacyDispensing> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const dispensing = await manager.getRepository(PharmacyDispensing).findOne({ where: { id } });
      if (!dispensing) {
        throw new NotFoundException(`Pharmacy dispensing ${id} not found`);
      }
      return dispensing;
    });
  }

  async listByOrderItem(params: PharmacyQueryParams): Promise<PaginatedResult<PharmacyDispensing>> {
    const { orderItemId, page = 1, limit = 10 } = params;
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(PharmacyDispensing);
      const queryBuilder = repository.createQueryBuilder('dispensing')
        .where('dispensing.orderItemId = :orderItemId', { orderItemId })
        .orderBy('dispensing.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);
      
      const [data, total] = await queryBuilder.getManyAndCount();
      
      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });
  }

  async cancel(id: string, cancelReason?: string): Promise<PharmacyDispensing> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(PharmacyDispensing);
      const dispensing = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!dispensing) {
        throw new NotFoundException(`Pharmacy dispensing ${id} not found`);
      }
      if (dispensing.status !== 'Pending') {
        throw new ConflictException(
          `Dispensing ${id} can only be cancelled while status is Pending (current: ${dispensing.status})`,
        );
      }

      dispensing.status = 'Cancelled';
      dispensing.cancelReason = cancelReason ?? null;
      return repository.save(dispensing);
    });
  }

  async dispenseDrug(id: string, input: DispenseDrugInput): Promise<PharmacyDispensing> {
    if (!input.dispensedBy?.trim()) {
      throw new BadRequestException('dispensedBy is required');
    }

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const dispensingRepository = manager.getRepository(PharmacyDispensing);
      const dispensing = await dispensingRepository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!dispensing) {
        throw new NotFoundException(`Pharmacy dispensing ${id} not found`);
      }
      if (dispensing.status !== 'Pending') {
        throw new ConflictException(
          `Dispensing ${id} must be Pending to dispense (current status: ${dispensing.status})`,
        );
      }

      const orderItem = await manager.getRepository(OrderItem).findOne({ where: { id: dispensing.orderItemId } });
      if (!orderItem) {
        throw new NotFoundException(`Order item ${dispensing.orderItemId} not found`);
      }
      if (orderItem.status === 'Cancelled') {
        throw new ConflictException(
          `Order item ${dispensing.orderItemId} was cancelled after this dispensing was created; cannot dispense`,
        );
      }

      const quantity = Number(dispensing.quantity);

      // FEFO: lock every StockBalance row for this item with available stock, ordered so
      // nearer-expiry batches are consumed first and no-expiry batches are consumed last.
      const balanceRows = await manager
        .createQueryBuilder(StockBalance, 'balance')
        .innerJoin(StockBatch, 'batch', 'batch.id = balance.stockBatchId')
        .where('balance.itemId = :itemId', { itemId: dispensing.inventoryItemId })
        .andWhere('balance.availableQuantity > 0')
        .orderBy('batch.expiryDate', 'ASC', 'NULLS LAST')
        .addOrderBy('batch.createdAt', 'ASC')
        .addOrderBy('balance.id', 'ASC')
        .setLock('pessimistic_write', undefined, ['balance'])
        .getMany();

      const totalAvailable = balanceRows.reduce((sum, row) => sum + Number(row.availableQuantity), 0);
      if (totalAvailable < quantity) {
        throw new BadRequestException(
          `Insufficient stock for item ${dispensing.inventoryItemId}: requested ${quantity}, available ${totalAvailable}`,
        );
      }

      let remaining = quantity;
      const transactionRepository = manager.getRepository(StockTransaction);
      for (const balanceRow of balanceRows) {
        if (remaining <= 0) break;
        const portion = Math.min(remaining, Number(balanceRow.availableQuantity));

        const updated = await manager.query<[Array<{ id: string }>, number]>(
          `
          UPDATE stock_balances
          SET "availableQuantity" = "availableQuantity" - $1, "updatedAt" = now()
          WHERE id = $2 AND "availableQuantity" >= $1
          RETURNING id
          `,
          [portion, balanceRow.id],
        );
        if (updated[1] === 0) {
          throw new Error(
            `Invariant violation: stock balance ${balanceRow.id} changed under lock during dispensing`,
          );
        }

        await transactionRepository.save(
          transactionRepository.create({
            itemId: dispensing.inventoryItemId,
            stockBatchId: balanceRow.stockBatchId,
            transactionType: 'PharmacyDispense',
            referenceId: dispensing.id,
            quantity: String(portion),
            recordedBy: input.dispensedBy,
          }),
        );

        remaining -= portion;
      }

      if (remaining > 0) {
        throw new Error(
          `Invariant violation: ${remaining} units of item ${dispensing.inventoryItemId} remained ` +
            `unfulfilled after consuming all locked stock balance rows`,
        );
      }

      dispensing.status = 'Dispensed';
      dispensing.dispensedBy = input.dispensedBy;
      dispensing.dispensedAt = new Date();
      const savedDispensing = await dispensingRepository.save(dispensing);
      
      // Mark order item as completed and trigger auto-billing
      const orderItem = await manager.getRepository(OrderItem).findOne({ where: { id: savedDispensing.orderItemId } });
      if (orderItem && orderItem.status !== 'Completed') {
        orderItem.status = 'Completed';
        orderItem.completedBy = input.dispensedBy;
        orderItem.completedAt = new Date();
        await manager.getRepository(OrderItem).save(orderItem);
        
        // Trigger auto-billing
        try {
          await this.invoicesService.autoChargeForCompletedOrder(orderItem.id, input.dispensedBy);
        } catch (billingError) {
          // Log but don't fail the dispensing - billing issues should be handled separately
          console.error(`Auto-charge failed for pharmacy order ${orderItem.id}:`, billingError);
        }
      }
      
      return savedDispensing;
    });
  }
}
}
