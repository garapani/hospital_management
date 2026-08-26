import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { StockBatch } from './entities/stock-batch.entity.js';
import { StockBalance } from './entities/stock-balance.entity.js';
import { StockTransaction } from './entities/stock-transaction.entity.js';

export interface FefoDecrementInput {
  itemId: string;
  quantity: number;
  transactionType: string;
  referenceId: string;
  recordedBy: string;
}

/**
 * Shared FEFO (first-expiry-first-out) locked stock decrement, used by both Inventory's
 * requisition fulfillment and Pharmacy's drug dispensing — previously two independent,
 * line-for-line-identical copies of this locking/atomicity logic (see Development-Standards.md
 * §17/§18). Runs inside the caller's own transaction (`manager`), so the decrement is atomic
 * with whatever status transition the caller is also making.
 */
@Injectable()
export class FefoStockDecrementService {
  async decrementInTransaction(manager: EntityManager, input: FefoDecrementInput): Promise<void> {
    // Lock every StockBalance row for this item with available stock, ordered so nearer-expiry
    // batches are consumed first and no-expiry batches are consumed last.
    const balanceRows = await manager
      .createQueryBuilder(StockBalance, 'balance')
      .innerJoin(StockBatch, 'batch', 'batch.id = balance.stockBatchId')
      .where('balance.itemId = :itemId', { itemId: input.itemId })
      .andWhere('balance.availableQuantity > 0')
      // Excludes expired batches from being dispensed at all — without this, expiryDate ASC
      // sorts an already-expired batch first, making it the *preferred* pick rather than merely
      // eligible (code-review-findings-2026-08-25 P1). A batch with no expiry date is unaffected.
      .andWhere('(batch.expiryDate IS NULL OR batch.expiryDate >= CURRENT_DATE)')
      .orderBy('batch.expiryDate', 'ASC', 'NULLS LAST')
      .addOrderBy('batch.createdAt', 'ASC')
      .addOrderBy('balance.id', 'ASC')
      .setLock('pessimistic_write', undefined, ['balance'])
      .getMany();

    const totalAvailable = balanceRows.reduce((sum, row) => sum + Number(row.availableQuantity), 0);
    if (totalAvailable < input.quantity) {
      throw new BadRequestException(
        `Insufficient stock for item ${input.itemId}: requested ${input.quantity}, available ${totalAvailable}`,
      );
    }

    let remaining = input.quantity;
    const transactionRepository = manager.getRepository(StockTransaction);
    for (const balanceRow of balanceRows) {
      if (remaining <= 0) break;
      const portion = Math.min(remaining, Number(balanceRow.availableQuantity));

      // UPDATE ... RETURNING on this driver returns a [rows, rowCount] tuple, not a bare row
      // array (that shape is only for INSERT ... RETURNING) — the guard below checks the
      // row-count element, not the array's own .length. See Development-Standards.md §17.
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
          `Invariant violation: stock balance ${balanceRow.id} changed under lock during ${input.transactionType}`,
        );
      }

      await transactionRepository.save(
        transactionRepository.create({
          itemId: input.itemId,
          stockBatchId: balanceRow.stockBatchId,
          transactionType: input.transactionType,
          referenceId: input.referenceId,
          quantity: String(portion),
          recordedBy: input.recordedBy,
        }),
      );

      remaining -= portion;
    }

    if (remaining > 0) {
      throw new Error(
        `Invariant violation: ${remaining} units of item ${input.itemId} remained unfulfilled after ` +
          `consuming all locked stock balance rows`,
      );
    }
  }
}
