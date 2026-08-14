import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryRunner, DataSource } from 'typeorm';
import { Invoice, InvoiceStatus, Payment } from './entities/invoice.entity';
import { TenantConnectionService } from '../../database/tenant-connection.service';

export interface RecordPaymentInput {
  amount: number;
  paymentMethod: string;
  reference?: string;
  notes?: string;
}

export interface CreateReturnInput {
  items: Array<{
    invoiceItemId: string;
    quantity: number;
    reason: string;
    refundAmount: number;
  }>;
  notes?: string;
}

@Injectable()
export class InvoicePaymentService {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly tenantConnection: TenantConnectionService
  ) {}

  /**
   * Records a payment against an invoice with pessimistic locking.
   */
  async recordPayment(invoiceId: string, input: RecordPaymentInput): Promise<Payment> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const queryRunner = manager.connection.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        // Pessimistic lock to prevent concurrent payment race conditions
        const invoice = await queryRunner.manager.findOne(Invoice, {
          where: { id: invoiceId },
          lock: { mode: 'pessimistic_write' }
        });

        if (!invoice) {
          throw new Error(`Invoice ${invoiceId} not found`);
        }

        if (invoice.status === InvoiceStatus.CANCELLED) {
          throw new Error(`Cannot record payment for cancelled invoice ${invoiceId}`);
        }

        if (input.amount <= 0) {
          throw new Error('Payment amount must be greater than zero');
        }

        const newPaidAmount = invoice.paidAmount + input.amount;
        
        // Update invoice status based on payment
        if (newPaidAmount >= invoice.totalAmount) {
          invoice.status = InvoiceStatus.FULLY_PAID;
          invoice.paidAt = new Date();
        } else {
          invoice.status = InvoiceStatus.PARTIALLY_PAID;
        }

        invoice.paidAmount = newPaidAmount;
        invoice.dueAmount = invoice.totalAmount - newPaidAmount;

        // Create payment record
        const payment = manager.create(Payment, {
          invoiceId: invoice.id,
          amount: input.amount,
          paymentMethod: input.paymentMethod,
          reference: input.reference,
          notes: input.notes
        });

        const savedInvoice = await queryRunner.manager.save(invoice);
        const savedPayment = await queryRunner.manager.save(payment);
        
        await queryRunner.commitTransaction();
        return savedPayment;
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
      } finally {
        await queryRunner.release();
      }
    });
  }

  /**
   * Creates a return/credit note for a paid invoice.
   * Uses pessimistic locking to ensure data consistency.
   */
  async createReturn(invoiceId: string, input: CreateReturnInput): Promise<any> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const queryRunner = manager.connection.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        // Pessimistic lock the invoice
        const invoice = await queryRunner.manager.findOne(Invoice, {
          where: { id: invoiceId },
          relations: ['items'],
          lock: { mode: 'pessimistic_write' }
        });

        if (!invoice) {
          throw new Error(`Invoice ${invoiceId} not found`);
        }

        if (invoice.status !== InvoiceStatus.FULLY_PAID && 
            invoice.status !== InvoiceStatus.PARTIALLY_PAID) {
          throw new Error(`Can only create returns for paid invoices. Current status: ${invoice.status}`);
        }

        // Calculate total refund amount
        const totalRefund = input.items.reduce((sum, item) => sum + item.refundAmount, 0);

        if (totalRefund > invoice.paidAmount) {
          throw new Error(`Refund amount (${totalRefund}) exceeds paid amount (${invoice.paidAmount})`);
        }

        // Create credit note/return record
        const returnRecord = manager.create('InvoiceReturn', { // Assuming InvoiceReturn entity exists
          invoiceId: invoice.id,
          totalAmount: totalRefund,
          status: 'COMPLETED',
          items: input.items.map(item => ({
            invoiceItemId: item.invoiceItemId,
            quantity: item.quantity,
            reason: item.reason,
            refundAmount: item.refundAmount
          })),
          notes: input.notes
        });

        // Update invoice paid amount
        invoice.paidAmount -= totalRefund;
        invoice.dueAmount = invoice.totalAmount - invoice.paidAmount;
        
        if (invoice.paidAmount === 0) {
          invoice.status = InvoiceStatus.DRAFT; // Or CANCELLED depending on business logic
        } else {
          invoice.status = InvoiceStatus.PARTIALLY_PAID;
        }

        const savedReturn = await queryRunner.manager.save(returnRecord);
        await queryRunner.manager.save(invoice);
        
        await queryRunner.commitTransaction();
        return savedReturn;
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
      } finally {
        await queryRunner.release();
      }
    });
  }
}
