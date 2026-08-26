import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource, EntitySubscriberInterface, InsertEvent, UpdateEvent } from 'typeorm';
import { FractionService } from './fraction.service.js';

/**
 * Automatic fraction-entry reversal: when an invoice is cancelled, or a return is created against
 * it, the invoice's live fraction entries are reversed in the same transaction — a doctor must
 * never be paid a share of revenue that was returned or voided (code-review-findings-2026-08-25
 * fraction P2). Wired like the other subscribers: tableName-filtered, no cross-module entity
 * imports (fraction -> billing would be a new module edge; filtering on tableName keeps the
 * boundary clean — same shape as ChargeCaptureSubscriber).
 *
 * The return path hooks `invoices` afterUpdate rather than `returns` afterInsert deliberately:
 * `InvoicesService.createReturn()` saves the Return row *before* updating the invoice's
 * totalAmount, so a returns-insert hook would fire with the old total; the invoice update fires
 * after the money moved, inside the same transaction.
 *
 * Fail-loud by design: a reversal that throws aborts the cancel/return transaction rather than
 * silently leaving a stale payable share behind (same stance as createReturn's journal post).
 */
@Injectable()
export class FractionReversalSubscriber implements EntitySubscriberInterface, OnModuleInit {
  private readonly logger = new Logger(FractionReversalSubscriber.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly fractionService: FractionService,
  ) {}

  onModuleInit(): void {
    this.dataSource.subscribers.push(this);
  }

  async afterInsert(event: InsertEvent<Record<string, unknown>>): Promise<void> {
    if (event.metadata.tableName !== 'returns') {
      return;
    }
    const record = event.entity as Record<string, unknown> | null;
    if (!record?.invoiceId) {
      return;
    }
    try {
      await this.fractionService.reverseEntriesForInvoice(event.manager, String(record.invoiceId));
    } catch (error) {
      this.logger.error(
        `Fraction reversal failed for return on invoice ${record.invoiceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  async afterUpdate(event: UpdateEvent<Record<string, unknown>>): Promise<void> {
    if (event.metadata.tableName !== 'invoices') {
      return;
    }
    const item = event.entity as Record<string, unknown> | null;
    const previous = event.databaseEntity as Record<string, unknown> | null;
    if (!item || item.status !== 'Cancelled' || previous?.status === 'Cancelled') {
      return;
    }
    try {
      await this.fractionService.reverseEntriesForInvoice(event.manager, String(item.id));
    } catch (error) {
      this.logger.error(
        `Fraction reversal failed for cancelled invoice ${item.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }
}
