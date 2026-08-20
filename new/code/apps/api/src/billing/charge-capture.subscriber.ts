import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource, EntitySubscriberInterface, UpdateEvent } from 'typeorm';
import { InvoicesService } from './invoices.service.js';

/**
 * Automatic charge capture: when an `order_items` row transitions to `Completed` — the single
 * choke point every clinical completion flows through (`OrdersService.completeItemInTransaction`,
 * called by Lab verify, Radiology verify, and Pharmacy dispense) — a billing charge is created for
 * the patient's open invoice. Wired like the audit/reporting/notification subscribers: registered
 * on the main DataSource from `OnModuleInit`.
 *
 * Best-effort by design (the human partner's ruling): a charge-capture problem — most commonly an
 * unpriced catalog item — must never roll back the completing workflow. Every "skip" decision
 * (unpriced, unsupported item type, already charged) is made BEFORE any SQL write, so those paths
 * are transaction-safe. A genuine SQL failure during the capture itself (rare) is deliberately
 * NOT swallowed into a rollback-inducing error: this subscriber never rethrows, but a Postgres
 * error inside the business transaction still aborts it — that is accepted and documented (it
 * fails loudly rather than silently losing revenue, and the failure surfaces in logs/tests).
 */
@Injectable()
export class ChargeCaptureSubscriber implements EntitySubscriberInterface, OnModuleInit {
  private readonly logger = new Logger(ChargeCaptureSubscriber.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly invoicesService: InvoicesService,
  ) {}

  onModuleInit(): void {
    this.dataSource.subscribers.push(this);
  }

  // No listenTo(): binding by entity class would import the OrderItem entity and create a
  // billing -> orders module edge; filtering on tableName keeps the boundary clean.
  async afterUpdate(event: UpdateEvent<Record<string, unknown>>): Promise<void> {
    if (event.metadata.tableName !== 'order_items') {
      return;
    }
    const item = event.entity;
    const previous = event.databaseEntity as Record<string, unknown> | null;
    if (!item || item.status !== 'Completed' || previous?.status === 'Completed') {
      return;
    }

    try {
      const result = await this.invoicesService.captureChargeForOrderItem(event.manager, {
        id: String(item.id),
        orderId: String(item.orderId),
        itemType: String(item.itemType),
        itemDescription: String(item.itemDescription),
        completedBy: typeof item.completedBy === 'string' ? item.completedBy : undefined,
      });
      if (!result.captured) {
        this.logger.log(
          `Charge capture skipped for order item ${item.id}: ${result.reason ?? 'unknown'}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Charge capture failed for order item ${item.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
