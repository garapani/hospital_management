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
import { ListPendingPharmacyItemsDto } from './dto/list-pending-pharmacy-items.dto.js';
import { paginate, PaginatedResponseDto } from '@hospital/pagination';
import { PdfService } from '@hospital/pdf';
import { buildPharmacyDispensingLabelDocument } from './pharmacy-dispensing-label-document.js';
import { InvoicesService } from '../billing/invoices.service.js';
import { withAdvisoryLock } from '../database/advisory-lock.util.js';

export interface CreateDispensingInput {
  orderItemId: string;
  inventoryItemId: string;
  quantity: number;
}

export interface CreateWalkInSaleInput {
  patientId: string;
  inventoryItemId: string;
  quantity: number;
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  dispensedBy?: string;
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
    private readonly pdfService: PdfService,
    private readonly invoicesService: InvoicesService,
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

  /**
   * OTC/walk-in sale: dispensing with no doctor's order behind it — e.g. a patient buying an
   * over-the-counter item at the pharmacy counter (pending-tasks.md Phase 6 Pharmacy item's
   * "Not done" gap; every other dispensing path requires an existing `OrderItem`). Unlike
   * `createDispensing`+`dispenseDrug` (create Pending, then a separate dispense step), this is a
   * single atomic call: there is no clinical order to wait on, so create and dispense collapse
   * into one action, same as a real pharmacy counter sale. Requires the item to have a sale price
   * up front (InvoicesService.captureChargeForWalkInPharmacySale throws otherwise) — a walk-in
   * sale IS the billing event, so unlike order-routed dispensing (where charge capture is
   * best-effort and never blocks the clinical action), stock must never leave uncharged here.
   *
   * Deliberately not scoped to a "pharmacy items only" catalog subset for this first pass — any
   * active, priced `InventoryItem` can be sold this way (Pharmacist's `pharmacy.dispensing.dispense`
   * permission is the only current gate). Order-routed dispensing has an implicit control a
   * walk-in sale doesn't (a doctor's order determines what's dispensable); tracked as a follow-up
   * in pending-tasks.md rather than solved here — narrowing needs a real "is this catalog item
   * pharmacy-sellable" concept, which doesn't exist yet.
   */
  async createWalkInSale(input: CreateWalkInSaleInput): Promise<PharmacyDispensing> {
    const quantity = Number(input.quantity);
    if (typeof input.quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('quantity must be a positive number');
    }

    const dispensedBy = this.resolveActor(input.dispensedBy);
    if (!dispensedBy?.trim()) {
      throw new BadRequestException('dispensedBy is required');
    }

    const item = await this.inventoryCatalogService.getItem(input.inventoryItemId); // throws NotFoundException if missing
    if (!item.isActive) {
      throw new ConflictException(
        `Inventory item ${input.inventoryItemId} is deactivated; cannot dispense`,
      );
    }

    const dispensingNumber = await this.dispensingNumberGenerator.generateNextDispensingNumber();

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      // Unlike an order-routed dispensing (naturally deduplicated by
      // UQ_pharmacy_dispensings_active_order_item on orderItemId), a walk-in sale has no order to
      // key off, so a double-click or client retry on this single-call endpoint would otherwise
      // sell and bill twice with nothing to catch it. The lock serializes concurrent walk-in sales
      // of the same item to the same patient; the window check inside it treats an identical sale
      // within the last 10s as the same submit and returns the original instead of creating a
      // second one.
      await withAdvisoryLock(manager, `walk_in_sale:${input.patientId}:${input.inventoryItemId}`);

      const patientRows: Array<{ id: string }> = await manager.query(
        `SELECT id FROM patients WHERE id = $1`,
        [input.patientId],
      );
      if (patientRows.length === 0) {
        throw new NotFoundException(`Patient ${input.patientId} not found`);
      }

      const dispensingRepository = manager.getRepository(PharmacyDispensing);

      const recentDuplicate = await dispensingRepository.findOne({
        where: {
          patientId: input.patientId,
          inventoryItemId: input.inventoryItemId,
          quantity: String(quantity),
          status: 'Dispensed',
        },
        order: { createdAt: 'DESC' },
      });
      if (recentDuplicate?.dispensedAt && Date.now() - recentDuplicate.dispensedAt.getTime() < 10_000) {
        return recentDuplicate;
      }

      const dispensing = await dispensingRepository.save(
        dispensingRepository.create({
          orderItemId: null,
          patientId: input.patientId,
          inventoryItemId: input.inventoryItemId,
          dispensingNumber,
          quantity: String(quantity),
          status: 'Dispensed',
          dispensedBy,
          dispensedAt: new Date(),
        }),
      );

      await this.fefoStockDecrement.decrementInTransaction(manager, {
        itemId: input.inventoryItemId,
        quantity,
        transactionType: 'PharmacyDispense',
        referenceId: dispensing.id,
        recordedBy: dispensedBy,
      });

      await this.invoicesService.captureChargeForWalkInPharmacySale(manager, {
        patientId: input.patientId,
        dispensingId: dispensing.id,
        inventoryItemId: input.inventoryItemId,
        quantity,
        completedBy: dispensedBy,
      });

      return dispensing;
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

  /**
   * The Add Dispensing picker's source: order items awaiting dispensing, across all patients — a
   * Pharmacist has no patient search access, so this is the only way they can find work without
   * already knowing an order item's UUID (code-review-findings-2026-09-02 pharmacy: Add Dispensing
   * required hand-typing both orderItemId and inventoryItemId). Same worklist shape as Lab/
   * Radiology's `listByOrderItem`/`findAll` (status-filtered, patientId joined in bulk), scoped
   * here to itemType 'Pharmacy' since that's the only kind of order item this screen ever acts on.
   */
  async listPendingItems(query: ListPendingPharmacyItemsDto): Promise<PaginatedResponseDto<OrderItem & { patientId: string | null }>> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const qb = manager.getRepository(OrderItem).createQueryBuilder('oi').where('oi.itemType = :itemType', { itemType: 'Pharmacy' });
      if (query.status) {
        qb.andWhere('oi.status = :status', { status: query.status });
      }
      qb.orderBy('oi.createdAt', 'DESC');
      const result = await paginate(qb, query);
      if (result.data.length === 0) {
        return { ...result, data: [] };
      }
      const orderRows: Array<{ id: string; patientId: string }> = await manager.query(
        `SELECT oi.id AS "id", o."patientId" AS "patientId"
         FROM order_items oi JOIN orders o ON o.id = oi."orderId"
         WHERE oi.id = ANY($1)`,
        [result.data.map((r) => r.id)],
      );
      const patientIdByItem = new Map(orderRows.map((r) => [r.id, r.patientId]));
      return {
        ...result,
        data: result.data.map((r) => ({ ...r, patientId: patientIdByItem.get(r.id) ?? null })),
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

      if (dispensing.orderItemId === null) {
        // A walk-in sale (createWalkInSale) never leaves status 'Pending' — it's created and
        // dispensed in one call — so this dispensing must be order-routed to have reached here.
        throw new Error(`Invariant violation: dispensing ${id} is Pending with no orderItemId`);
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
   * wrong-quantity dispense). For an order-routed dispensing this is scoped to stock only: the
   * linked order item stays Completed and no billing charge is reversed here — a resulting invoice
   * correction is a separate, staff-initiated `InvoicesService.createReturn` call, same as every
   * other reversal in this codebase (fraction, insurance). Once reversed, `createDispensing`'s
   * duplicate-guard allows a new dispensing to be created against the same order item (see the
   * guard above) — re-dispensing then completes an already-Completed order item, which
   * `completeItemInTransaction` no-ops on, so billing is never double-charged.
   * (code-review-findings-2026-08-25 pharmacy P2.)
   *
   * A walk-in sale (orderItemId null) is different: it's typically reversed within seconds, almost
   * always before any payment is recorded, and `createReturn` refuses to run against an invoice
   * with zero recorded payments — it would force cancelling the patient's entire open invoice just
   * to undo one line. So for that path only, this also voids the charge
   * (InvoicesService.voidWalkInPharmacySaleCharge) in the same transaction as the stock credit.
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

      if (dispensing.orderItemId === null) {
        await this.invoicesService.voidWalkInPharmacySaleCharge(manager, dispensing.id);
      }

      dispensing.status = 'Reversed';
      dispensing.reversedBy = reversedBy;
      dispensing.reversedAt = new Date();
      dispensing.reversalReason = input.reversalReason ?? null;
      return dispensingRepository.save(dispensing);
    });
  }

  /**
   * Not mirrored to object storage: same reasoning as the patient ID / lab / radiology labels
   * (Development-Standards.md §129) — a live, always-regeneratable document, printed to identify
   * a dispensed medication packet, available before dispensing (not just after) since that's when
   * it needs to be attached to the packet.
   */
  async renderDispensingLabelPdf(id: string): Promise<Buffer> {
    const item = await this.tenantConnection.runInTenantSchema(async (manager) => {
      const dispensing = await manager.getRepository(PharmacyDispensing).findOne({ where: { id } });
      if (!dispensing) {
        throw new NotFoundException(`Pharmacy dispensing ${id} not found`);
      }

      const inventoryItem = await this.inventoryCatalogService.getItem(dispensing.inventoryItemId);

      // A walk-in dispensing has no orderItemId to join through — its patient comes directly off
      // the dispensing row instead (populated only on that path; see the entity's comment).
      let patientId: string | null = dispensing.patientId;
      if (patientId === null && dispensing.orderItemId !== null) {
        const orderRows = await manager.query(
          `SELECT o."patientId" FROM orders o JOIN order_items oi ON oi."orderId" = o.id WHERE oi.id = $1`,
          [dispensing.orderItemId],
        );
        patientId = orderRows.length > 0 ? orderRows[0].patientId : null;
      }
      const patient = patientId !== null
        ? await manager.query(`SELECT "firstName", "lastName", "patientNo" FROM patients WHERE id = $1`, [patientId])
        : [];
      const patientName = patient.length > 0 ? `${patient[0].firstName} ${patient[0].lastName}` : 'Unknown';
      const patientNo = patient[0]?.patientNo ?? '';

      return buildPharmacyDispensingLabelDocument({
        dispensingId: dispensing.id,
        dispensingNumber: dispensing.dispensingNumber,
        patientName,
        patientNo,
        drugName: inventoryItem.name,
        quantity: dispensing.quantity,
        unitOfMeasure: inventoryItem.unitOfMeasure,
        dispensedAt: dispensing.dispensedAt?.toISOString() ?? null,
      });
    });

    return this.pdfService.render(item);
  }
}
