import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { PaginationQueryDto, PaginatedResponseDto, paginate } from '@hospital/pagination';
import {
  WardStockBalance,
  WardStockBatch,
  WardStockTransaction,
  WardStockTransactionType,
} from './entities/ward-stock.entity.js';

export interface WardStockMovementInput {
  patientId?: string;
  admissionId?: string;
  /** Batch lot this movement refers to; omitted/empty = unbatchable stock ('' sentinel in the DB). */
  batchNumber?: string;
  /** ISO date (YYYY-MM-DD); only valid together with a batchNumber. */
  expiryDate?: string;
  remarks?: string;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  performedBy?: string;
}

export type ListBalancesQuery = PaginationQueryDto & {
  departmentId?: string;
};

export type ListTransactionsQuery = PaginationQueryDto & {
  departmentId?: string;
  itemId?: string;
  transactionType?: WardStockTransactionType;
};

@Injectable()
export class WardSupplyService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Actor fields (`performedBy`) derive from the authenticated principal (see
   * Development-Standards.md §25) — the caller-supplied value is only a fallback for non-HTTP
   * callers, so a spoofed value can never overwrite the audit trail of who actually moved stock.
   */
  private resolveActor(fallback?: string): string {
    return this.tenantContext.getAccountId() ?? (fallback as string);
  }

  private assertPositiveQuantity(quantity: number): void {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('quantity must be a positive number');
    }
  }

  /** Cross-module reference check, same shape as every sibling module: raw query, no entity import. */
  private async assertDepartmentExists(manager: EntityManager, departmentId: string): Promise<void> {
    const rows = await manager.query(`SELECT id FROM departments WHERE id = $1`, [departmentId]);
    if (rows.length === 0) {
      throw new NotFoundException(`Department ${departmentId} not found`);
    }
  }

  private async assertPatientExists(manager: EntityManager, patientId?: string): Promise<void> {
    if (!patientId) return;
    const rows = await manager.query(`SELECT id FROM patients WHERE id = $1`, [patientId]);
    if (rows.length === 0) {
      throw new NotFoundException(`Patient ${patientId} not found`);
    }
  }

  private async assertAdmissionExists(manager: EntityManager, admissionId?: string): Promise<void> {
    if (!admissionId) return;
    const rows = await manager.query(`SELECT id FROM admissions WHERE id = $1`, [admissionId]);
    if (rows.length === 0) {
      throw new NotFoundException(`Admission ${admissionId} not found`);
    }
  }

  private assertBatchInput(input: WardStockMovementInput): void {
    const batchNumber = input.batchNumber?.trim();
    if (input.expiryDate && !batchNumber) {
      throw new BadRequestException('expiryDate requires a batchNumber');
    }
    if (input.expiryDate && input.expiryDate < new Date().toISOString().slice(0, 10)) {
      throw new BadRequestException('expiryDate must not be in the past');
    }
  }

  /**
   * Receives stock into a ward (department) sub-store: upserts the per-item balance (atomically
   * incrementing on the UNIQUE (departmentId, itemId) conflict), upserts the per-batch lot the
   * receipt refers to ('' sentinel when no batchNumber is supplied), and records a 'Receive'
   * ledger entry carrying the batch provenance.
   */
  async receiveStock(
    departmentId: string,
    itemId: string,
    quantity: number,
    input: WardStockMovementInput = {},
  ): Promise<WardStockBalance> {
    this.assertPositiveQuantity(quantity);
    this.assertBatchInput(input);
    const batchNumber = input.batchNumber?.trim() || '';
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const item = await manager.query(`SELECT id FROM inventory_items WHERE id = $1`, [itemId]);
      if (item.length === 0) {
        throw new NotFoundException(`Inventory item ${itemId} not found`);
      }
      await this.assertDepartmentExists(manager, departmentId);
      await this.assertPatientExists(manager, input.patientId);
      await this.assertAdmissionExists(manager, input.admissionId);

      await manager.query(
        `
        INSERT INTO ward_stock_balances ("departmentId", "itemId", "availableQuantity")
        VALUES ($1, $2, $3)
        ON CONFLICT ("departmentId", "itemId")
        DO UPDATE SET
          "availableQuantity" = ward_stock_balances."availableQuantity" + excluded."availableQuantity",
          "updatedAt" = now()
        `,
        [departmentId, itemId, quantity],
      );

      await manager.query(
        `
        INSERT INTO ward_stock_batches ("departmentId", "itemId", "batchNumber", "expiryDate", "quantity")
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT ("departmentId", "itemId", "batchNumber")
        DO UPDATE SET
          quantity = ward_stock_batches.quantity + excluded.quantity,
          "updatedAt" = now()
        `,
        [departmentId, itemId, batchNumber, input.expiryDate ?? null, quantity],
      );

      await manager.getRepository(WardStockTransaction).save(
        manager.getRepository(WardStockTransaction).create({
          departmentId,
          itemId,
          transactionType: 'Receive',
          quantity,
          batchNumber: batchNumber || null,
          expiryDate: input.expiryDate ?? null,
          patientId: input.patientId ?? null,
          admissionId: input.admissionId ?? null,
          performedBy: this.resolveActor(input.performedBy),
          remarks: input.remarks ?? null,
        }),
      );

      const balance = await manager.getRepository(WardStockBalance).findOne({
        where: { departmentId, itemId },
      });
      if (!balance) {
        throw new NotFoundException(
          `Ward stock balance for item ${itemId} in department ${departmentId} not found`,
        );
      }
      return balance;
    });
  }

  /**
   * Consumes stock from a ward sub-store: row-locks the balance (pessimistic_write), refuses to
   * go negative, decrements the balance, decrements the batch lots FEFO (first-expiry-first-out,
   * expired lots excluded — same rule as the central store's pharmacy P1 fix), and records one
   * 'Consume' ledger entry per lot touched, carrying that lot's provenance.
   */
  async consumeStock(
    departmentId: string,
    itemId: string,
    quantity: number,
    input: WardStockMovementInput = {},
  ): Promise<WardStockBalance> {
    this.assertPositiveQuantity(quantity);
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      await this.assertPatientExists(manager, input.patientId);
      await this.assertAdmissionExists(manager, input.admissionId);
      return this.decrementStock(manager, departmentId, itemId, quantity, 'Consume', input);
    });
  }

  /** Returns surplus stock to the central store: same decrement path as Consume, 'Return' type. */
  async returnStock(
    departmentId: string,
    itemId: string,
    quantity: number,
    input: WardStockMovementInput = {},
  ): Promise<WardStockBalance> {
    this.assertPositiveQuantity(quantity);
    return this.tenantConnection.runInTenantSchema((manager) =>
      this.decrementStock(manager, departmentId, itemId, quantity, 'Return', input),
    );
  }

  /** Writes off damaged/expired stock: same decrement path as Consume, 'Wastage' type. */
  async wasteStock(
    departmentId: string,
    itemId: string,
    quantity: number,
    input: WardStockMovementInput = {},
  ): Promise<WardStockBalance> {
    this.assertPositiveQuantity(quantity);
    return this.tenantConnection.runInTenantSchema((manager) =>
      this.decrementStock(manager, departmentId, itemId, quantity, 'Wastage', input),
    );
  }

  /**
   * Records a stocktake adjustment (signed delta): positive adds stock to the balance and the
   * unbatched ('' sentinel) lot — provenance is unknown for a stocktake surplus — negative
   * removes it FEFO across lots like any other decrement. Always records exactly one 'Adjust'
   * ledger entry with the signed delta.
   */
  async adjustStock(
    departmentId: string,
    itemId: string,
    delta: number,
    input: WardStockMovementInput = {},
  ): Promise<WardStockBalance> {
    if (!Number.isFinite(delta) || delta === 0) {
      throw new BadRequestException('adjustment delta must be a non-zero finite number');
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(WardStockBalance);
      const balance = await repository.findOne({
        where: { departmentId, itemId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!balance) {
        throw new ConflictException(
          `No ward stock balance for item ${itemId} in department ${departmentId} — use receiveStock to create one`,
        );
      }
      const newQuantity = balance.availableQuantity + delta;
      if (newQuantity < 0) {
        throw new ConflictException(
          `Adjustment would drive item ${itemId} in department ${departmentId} below zero: ` +
            `available ${balance.availableQuantity}, delta ${delta}`,
        );
      }
      balance.availableQuantity = newQuantity;
      await repository.save(balance);

      if (delta > 0) {
        await manager.query(
          `
          INSERT INTO ward_stock_batches ("departmentId", "itemId", "batchNumber", "expiryDate", "quantity")
          VALUES ($1, $2, '', NULL, $3)
          ON CONFLICT ("departmentId", "itemId", "batchNumber")
          DO UPDATE SET
            quantity = ward_stock_batches.quantity + excluded.quantity,
            "updatedAt" = now()
          `,
          [departmentId, itemId, delta],
        );
      } else {
        // Batch lots decrement FEFO, but without per-lot ledger rows — the single signed Adjust
        // entry below is the ledger record for the whole movement.
        await this.decrementBatchesFefo(manager, departmentId, itemId, -delta, 'Adjust', input, false);
      }

      await manager.getRepository(WardStockTransaction).save(
        manager.getRepository(WardStockTransaction).create({
          departmentId,
          itemId,
          transactionType: 'Adjust',
          quantity: delta,
          batchNumber: null,
          expiryDate: null,
          patientId: null,
          admissionId: null,
          performedBy: this.resolveActor(input.performedBy),
          remarks: input.remarks ?? null,
        }),
      );

      return balance;
    });
  }

  /** Shared decrement path: lock balance, refuse to go negative, decrement, record per-lot ledger entries. */
  private async decrementStock(
    manager: EntityManager,
    departmentId: string,
    itemId: string,
    quantity: number,
    transactionType: Exclude<WardStockTransactionType, 'Receive' | 'Adjust'>,
    input: WardStockMovementInput,
  ): Promise<WardStockBalance> {
    const repository = manager.getRepository(WardStockBalance);
    const balance = await repository.findOne({
      where: { departmentId, itemId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!balance || balance.availableQuantity < quantity) {
      throw new ConflictException(
        `Insufficient ward stock for item ${itemId} in department ${departmentId}: ` +
          `requested ${quantity}, available ${balance?.availableQuantity ?? 0}`,
      );
    }

    balance.availableQuantity -= quantity;
    await repository.save(balance);

    await this.decrementBatchesFefo(manager, departmentId, itemId, quantity, transactionType, input);

    return balance;
  }

  /**
   * Decrements batch lots FEFO (earliest expiry first, expired lots and the unbatched '' sentinel
   * last via NULLS LAST), each UPDATE ... RETURNING guarded by a `quantity >= portion` predicate
   * under a pessimistic lock — the same locked-decrement shape as the central store's
   * FefoStockDecrementService. Records one ledger entry per lot touched, unless suppressed
   * (Adjust records a single signed entry instead).
   */
  private async decrementBatchesFefo(
    manager: EntityManager,
    departmentId: string,
    itemId: string,
    quantity: number,
    transactionType: WardStockTransactionType,
    input: WardStockMovementInput,
    recordTransactions = true,
  ): Promise<void> {
    const batchRows = await manager
      .createQueryBuilder(WardStockBatch, 'batch')
      .where('batch.departmentId = :departmentId', { departmentId })
      .andWhere('batch.itemId = :itemId', { itemId })
      .andWhere('batch.quantity > 0')
      // Expired lots are never consumable — without this, expiryDate ASC would sort an
      // already-expired lot first and make it the *preferred* pick (same rule as the central
      // store's pharmacy P1 fix; the '' sentinel lot has a NULL expiry, so it sorts last).
      .andWhere('(batch.expiryDate IS NULL OR batch.expiryDate >= CURRENT_DATE)')
      .orderBy('batch.expiryDate', 'ASC', 'NULLS LAST')
      .addOrderBy('batch.batchNumber', 'ASC')
      .addOrderBy('batch.createdAt', 'ASC')
      .setLock('pessimistic_write', undefined, ['batch'])
      .getMany();

    const totalAvailable = batchRows.reduce((sum, row) => sum + Number(row.quantity), 0);
    if (totalAvailable < quantity) {
      throw new ConflictException(
        `Insufficient consumable ward stock for item ${itemId} in department ${departmentId}: ` +
          `requested ${quantity}, consumable (non-expired lots) ${totalAvailable}`,
      );
    }

    let remaining = quantity;
    const transactionRepository = manager.getRepository(WardStockTransaction);
    for (const batch of batchRows) {
      if (remaining <= 0) break;
      const portion = Math.min(remaining, Number(batch.quantity));

      // UPDATE ... RETURNING on this driver returns a [rows, rowCount] tuple — check the
      // row-count element (see Development-Standards.md §17).
      const updated = await manager.query<[Array<{ id: string }>, number]>(
        `
        UPDATE ward_stock_batches
        SET quantity = quantity - $1, "updatedAt" = now()
        WHERE id = $2 AND quantity >= $1
        RETURNING id
        `,
        [portion, batch.id],
      );
      if (updated[1] === 0) {
        throw new Error(
          `Invariant violation: ward stock batch ${batch.id} changed under lock during ${transactionType}`,
        );
      }

      if (recordTransactions) {
        await transactionRepository.save(
          transactionRepository.create({
            departmentId,
            itemId,
            transactionType,
            quantity: portion,
            batchNumber: batch.batchNumber || null,
            expiryDate: batch.expiryDate ?? null,
            patientId: input.patientId ?? null,
            admissionId: input.admissionId ?? null,
            performedBy: this.resolveActor(input.performedBy),
            remarks: input.remarks ?? null,
          }),
        );
      }
      remaining -= portion;
    }
  }

  /** All ward balances, optionally scoped to one department, ordered by itemId, paginated. */
  async listBalances(query: ListBalancesQuery = {}): Promise<PaginatedResponseDto<WardStockBalance>> {
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(WardStockBalance).createQueryBuilder('balance');
      if (query.departmentId) {
        qb.andWhere('balance.departmentId = :departmentId', { departmentId: query.departmentId });
      }
      qb.orderBy('balance.itemId', 'ASC');
      return paginate(qb, query);
    });
  }

  /** Ward stock ledger entries, paginated, newest first. */
  async listTransactions(
    query: ListTransactionsQuery = {},
  ): Promise<PaginatedResponseDto<WardStockTransaction>> {
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(WardStockTransaction).createQueryBuilder('txn');
      if (query.departmentId) {
        qb.andWhere('txn.departmentId = :departmentId', { departmentId: query.departmentId });
      }
      if (query.itemId) {
        qb.andWhere('txn.itemId = :itemId', { itemId: query.itemId });
      }
      if (query.transactionType) {
        qb.andWhere('txn.transactionType = :transactionType', {
          transactionType: query.transactionType,
        });
      }
      qb.orderBy('txn.performedAt', 'DESC');
      return paginate(qb, query);
    });
  }
}
