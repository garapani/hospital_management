import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntitySubscriberInterface, InsertEvent } from 'typeorm';
import { Order } from '../orders/entities/order.entity.js';
import { Invoice } from '../billing/entities/invoice.entity.js';
import { Payment } from '../billing/entities/payment.entity.js';
import { Deposit } from '../billing/entities/deposit.entity.js';
import { Admission } from '../admissions/entities/admission.entity.js';
import { BedTransfer } from '../admissions/entities/bed-transfer.entity.js';
import { PersistingReportingEventPublisher } from './persisting-reporting-event-publisher.js';
import { TenantContextService } from '@hospital/tenant-context';

@Injectable()
export class ReportingSubscriber implements EntitySubscriberInterface {
  private readonly logger = new Logger(ReportingSubscriber.name);

  private readonly eventCatalog = new Map<
    Function,
    {
      eventType: string;
      buildPayload: (
        entity: any,
        event: InsertEvent<any>,
      ) => Promise<Record<string, any>> | Record<string, any>;
    }
  >([
    [
      Order,
      {
        // Only Order-native columns are available here: afterInsert fires on the `orders` row
        // before OrdersService saves its OrderItem rows, so item data cannot be enriched at
        // insert time (see the insert-only Global Constraint in the reporting-archiver plan).
        eventType: 'OrderPlaced',
        buildPayload: (entity: Order) => ({
          orderId: entity.id,
          patientId: entity.patientId,
          orderedBy: entity.orderedBy,
          sourceAppointmentId: entity.sourceAppointmentId,
          sourceAdmissionId: entity.sourceAdmissionId,
        }),
      },
    ],
    [
      Invoice,
      {
        eventType: 'InvoiceCreated',
        buildPayload: (entity: Invoice) => ({
          invoiceId: entity.id,
          patientId: entity.patientId,
          invoiceNumber: entity.invoiceNumber,
          financialYear: entity.financialYear,
          totalAmount: entity.totalAmount,
        }),
      },
    ],
    [
      Payment,
      {
        eventType: 'PaymentRecorded',
        buildPayload: (entity: Payment) => ({
          paymentId: entity.id,
          invoiceId: entity.invoiceId,
          amount: entity.amount,
          paymentMode: entity.paymentMode,
        }),
      },
    ],
    [
      Deposit,
      {
        eventType: 'DepositReceived',
        buildPayload: (entity: Deposit) => ({
          depositId: entity.id,
          patientId: entity.patientId,
          amount: entity.amount,
        }),
      },
    ],
    [
      Admission,
      {
        eventType: 'PatientAdmitted',
        buildPayload: (entity: Admission) => ({
          admissionId: entity.id,
          patientId: entity.patientId,
          wardId: entity.wardId,
          bedId: entity.bedId,
          admissionSource: entity.admissionSource,
        }),
      },
    ],
    [
      BedTransfer,
      {
        eventType: 'BedTransferred',
        buildPayload: (entity: BedTransfer) => ({
          bedTransferId: entity.id,
          admissionId: entity.admissionId,
          fromBedId: entity.fromBedId,
          toBedId: entity.toBedId,
        }),
      },
    ],
  ]);

  constructor(
    dataSource: DataSource,
    private readonly publisher: PersistingReportingEventPublisher,
    private readonly tenantContextService: TenantContextService,
  ) {
    dataSource.subscribers.push(this);
  }

  async afterInsert(event: InsertEvent<any>) {
    if (!event.metadata || typeof event.metadata.target !== 'function') return;

    const handler = this.eventCatalog.get(event.metadata.target);
    if (!handler) {
      return;
    }

    try {
      const payload = await handler.buildPayload(event.entity, event);
      const correlationId = this.tenantContextService.getCorrelationId();

      await this.publisher.publish(
        {
          eventType: handler.eventType,
          entityId: event.entity.id,
          payload,
          correlationId: correlationId ?? null,
        },
        event.manager,
      );
    } catch (error) {
      this.logger.error(
        `Failed to build/publish reporting event for ${handler.eventType}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
