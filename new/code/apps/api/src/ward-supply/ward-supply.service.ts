import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { PaginationQueryDto, PaginatedResponseDto, paginate } from '@hospital/pagination';
import {
  WardStockBalance,
  WardStockTransaction,
  WardStockTransactionType,
} from './entities/ward-stock.entity.js';

export interface WardStockMovementInput {
  patientId?: string;
  admissionId?: string;
  remarks?: string;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  performedBy?: string;
}

export interface ListBalancesQuery {
  departmentId?: string;
}

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

  /**
   * Receives stock into a ward (department) sub-store: upserts the per-item balance (atomically
   * incrementing on the UNIQUE (departmentId, itemId) conflict) and records a 'Receive' ledger
   * entry.
   */
  async receiveStock(
    departmentId: string,
    itemId: string,
    quantity: number,
    input: WardStockMovementInput = {},
  ): Promise<WardStockBalance> {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('quantity must be a positive number');
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const item = await manager.query(`SELECT id FROM inventory_items WHERE id = $1`, [itemId]);
      if (item.length === 0) {
        throw new NotFoundException(`Inventory item ${itemId} not found`);
      }

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

      await manager.getRepository(WardStockTransaction).save(
        manager.getRepository(WardStockTransaction).create({
          departmentId,
          itemId,
          transactionType: 'Receive',
          quantity,
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
   * go negative, decrements, and records a 'Consume' ledger entry.
   */
  async consumeStock(
    departmentId: string,
    itemId: string,
    quantity: number,
    input: WardStockMovementInput = {},
  ): Promise<WardStockBalance> {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('quantity must be a positive number');
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
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

      await manager.getRepository(WardStockTransaction).save(
        manager.getRepository(WardStockTransaction).create({
          departmentId,
          itemId,
          transactionType: 'Consume',
          quantity,
          patientId: input.patientId ?? null,
          admissionId: input.admissionId ?? null,
          performedBy: this.resolveActor(input.performedBy),
          remarks: input.remarks ?? null,
        }),
      );

      return balance;
    });
  }

  /** All ward balances, optionally scoped to one department, ordered by itemId. */
  async listBalances(query: ListBalancesQuery = {}): Promise<WardStockBalance[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(WardStockBalance).find({
        where: query.departmentId ? { departmentId: query.departmentId } : {},
        order: { itemId: 'ASC' },
      }),
    );
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
