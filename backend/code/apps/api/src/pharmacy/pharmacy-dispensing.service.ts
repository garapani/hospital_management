import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { In, QueryFailedError } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { OrdersService } from '../orders/orders.service.js';
import { InventoryCatalogService } from '../inventory/inventory-catalog.service.js';
import { PharmacyDispensing } from './entities/pharmacy-dispensing.entity.js';
import { PharmacyDispensingNumberGeneratorService } from './pharmacy-dispensing-number-generator.service.js';
import { FefoStockDecrementService } from '../inventory/fefo-stock-decrement.service.js';
import { StockBalance } from '../inventory/entities/stock-balance.entity.js';
import { StockTransaction } from '../inventory/entities/stock-transaction.entity.js';
import { ListPharmacyDispensingDto } from './dto/list-pharmacy-dispensing.dto.js';
import { paginate, PaginatedResponseDto } from '@hospital/pagination';

export interface CreateDispensingInput {
  orderItemId: string;
  inventoryItemId: string;
  quantity: number;
}

export interface DispenseDrugInput {
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  dispensedBy?: string;
}

export interface ReverseDispensingInput {
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  reversedBy?: string;
  reversalReason?: string;
}

@Injectable()
export class PharmacyDispensingService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly dispensingNumberGenerator: PharmacyDispensingNumberGeneratorService,
    private readonly inventoryCatalogService: InventoryCatalogService,
    private readonly ordersService: OrdersService,
    private readonly fefoStockDecrement: FefoStockDecrementService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Actor fields (`dispensedBy`) are never trusted from the caller: the authenticated principal
   * (TenantContextService.accountId, set by TenantContextMiddleware from the verified JWT) wins;
   * the passed value is only a fallback for non-HTTP callers (service specs) that run without a
   * tenant context. Dispensing is a clinical sign-off, so spoofing it would be an audit-trail
   * integrity breach.
   */
  private resolveActor(fallback?: string): string {
    return this.tenantContext.getAccountId() ?? (fallback as string);
  }

  async createDispensing(input: CreateDispensingInput): Promise<PharmacyDispensing> {
    const quantity = Number(input.quantity);
    if (typeof input.quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('quantity must be a positive number');
    }

    const item = await this.inventoryCatalogService.getItem(input.inventoryItemId); // throws NotFoundException if missing
    if (!item.isActive) {
      throw new ConflictException(
        `Inventory item ${input.inventoryItemId} is deactivated; cannot create a new dispensing against it`,
      );
    }

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

      // A Reversed dispensing does not block a new one: reverseDispensing() means the drug was
      // returned to stock, and the order item can be dispensed again against the same order item
      // (code-review-findings-2026-08-25 pharmacy P2 — no reversal path once stock is dispensed).
      const dispensingRepository = manager.getRepository(PharmacyDispensing);
      const existing = await dispensingRepository.findOne({
        where: { orderItemId: input.orderItemId, status: In(['Pending', 'Dispensed']) },
      });
      if (existing) {
        throw new ConflictException(
          `Order item ${input.orderItemId} already has an active dispensing (${existing.id})`,
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
          throw new ConflictException(`Order item ${input.orderItemId} already has an active dispensing`);
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

  async findAll(query: ListPharmacyDispensingDto): Promise<PaginatedResponseDto<PharmacyDispensing>> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const qb = manager.getRepository(PharmacyDispensing).createQueryBuilder('dispensing')
        .leftJoinAndSelect('dispensing.orderItem', 'orderItem')
        .orderBy('dispensing.createdAt', 'DESC');

      if (query.orderItemId) {
        qb.andWhere('dispensing.orderItemId = :orderItemId', { orderItemId: query.orderItemId });
      }

      if (query.status) {
        qb.andWhere('dispensing.status = :status', { status: query.status });
      }

      return paginate(qb, { page: query.page, limit: query.limit });
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
    const dispensedBy = this.resolveActor(input.dispensedBy);
    if (!dispensedBy?.trim()) {
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

      await this.fefoStockDecrement.decrementInTransaction(manager, {
        itemId: dispensing.inventoryItemId,
        quantity,
        transactionType: 'PharmacyDispense',
        referenceId: dispensing.id,
        recordedBy: dispensedBy,
      });

      dispensing.status = 'Dispensed';
      dispensing.dispensedBy = dispensedBy;
      dispensing.dispensedAt = new Date();
      const savedDispensing = await dispensingRepository.save(dispensing);

      // Completes the order item via OrdersService (in this same transaction) instead of
      // mutating the OrderItem repository directly. Completing the item fires
      // ChargeCaptureSubscriber (billing, Dev Standards §27), which captures a charge for the
      // patient's open invoice — best-effort: unpriced/unsupported items are skipped, never
      // rolled back.
      await this.ordersService.completeItemInTransaction(manager, orderItem.id, {
        completedBy: dispensedBy,
      });

      return savedDispensing;
    });
  }

  /**
   * Credits stock back for a Dispensed record and marks it Reversed (e.g. a wrong-drug or
   * wrong-quantity dispense). Scoped to stock only: the linked order item stays Completed and no
   * billing charge is reversed here — a resulting invoice correction is a separate, staff-initiated
   * `InvoicesService.createReturn` call, same as every other reversal in this codebase (fraction,
   * insurance). Once reversed, `createDispensing`'s duplicate-guard allows a new dispensing to be
   * created against the same order item (see the guard above) — re-dispensing then completes an
   * already-Completed order item, which `completeItemInTransaction` no-ops on, so billing is never
   * double-charged. (code-review-findings-2026-08-25 pharmacy P2.)
   */
  async reverseDispensing(id: string, input: ReverseDispensingInput = {}): Promise<PharmacyDispensing> {
    const reversedBy = this.resolveActor(input.reversedBy);
    if (!reversedBy?.trim()) {
      throw new BadRequestException('reversedBy is required');
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
      if (dispensing.status !== 'Dispensed') {
        throw new ConflictException(
          `Dispensing ${id} must be Dispensed to reverse (current status: ${dispensing.status})`,
        );
      }

      const originalTransactions = await manager.getRepository(StockTransaction).find({
        where: { referenceId: dispensing.id, transactionType: 'PharmacyDispense' },
      });

      const balanceRepository = manager.getRepository(StockBalance);
      const transactionRepository = manager.getRepository(StockTransaction);
      for (const original of originalTransactions) {
        const balance = await balanceRepository.findOne({
          where: { stockBatchId: original.stockBatchId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!balance) {
          throw new Error(
            `Invariant violation: stock balance for batch ${original.stockBatchId} no longer exists ` +
              `while reversing dispensing ${id}`,
          );
        }
        balance.availableQuantity = String(Number(balance.availableQuantity) + Number(original.quantity));
        await balanceRepository.save(balance);

        await transactionRepository.save(
          transactionRepository.create({
            itemId: original.itemId,
            stockBatchId: original.stockBatchId,
            transactionType: 'PharmacyDispenseReversal',
            referenceId: dispensing.id,
            quantity: original.quantity,
            recordedBy: reversedBy,
          }),
        );
      }

      dispensing.status = 'Reversed';
      dispensing.reversedBy = reversedBy;
      dispensing.reversedAt = new Date();
      dispensing.reversalReason = input.reversalReason ?? null;
      return dispensingRepository.save(dispensing);
    });
  }
}
