import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, QueryRunner, LockModeType } from 'typeorm';
import { Invoice, InvoiceStatus } from './entities/invoice.entity';
import { TenantConnectionService } from '../../database/tenant-connection.service';
import { InvoiceNumberingService } from './invoice-numbering.service';

export interface CreateInvoiceInput {
  patientId: string;
  encounterId?: string;
  items: Array<{
    description: string;
    amount: number;
    itemId?: string;
    itemType?: string;
    orderId?: string;
  }>;
}

@Injectable()
export class InvoiceLifecycleService {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    private readonly tenantConnection: TenantConnectionService,
    private readonly numberingService: InvoiceNumberingService
  ) {}

  /**
   * Creates a new invoice with proper sequence numbering and validation.
   */
  async create(input: CreateInvoiceInput): Promise<Invoice> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const queryRunner = manager.connection.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        // Calculate financial year and generate sequence number
        const financialYearStart = this.numberingService.getFinancialYearStart();
        const invoiceNumber = await this.numberingService.generateInvoiceNumber(financialYearStart);

        // Calculate total amount
        const totalAmount = input.items.reduce((sum, item) => sum + item.amount, 0);

        const invoice = manager.create(Invoice, {
          invoiceNumber,
          patientId: input.patientId,
          encounterId: input.encounterId,
          status: InvoiceStatus.DRAFT,
          totalAmount,
          paidAmount: 0,
          dueAmount: totalAmount,
          items: input.items.map(item => ({
            description: item.description,
            amount: item.amount,
            itemId: item.itemId,
            itemType: item.itemType,
            orderId: item.orderId
          })),
          financialYearStart
        });

        const savedInvoice = await queryRunner.manager.save(invoice);
        await queryRunner.commitTransaction();
        return savedInvoice;
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
      } finally {
        await queryRunner.release();
      }
    });
  }

  /**
   * Cancels an invoice with pessimistic locking to prevent race conditions.
   * Only draft or partially paid invoices can be cancelled.
   */
  async cancel(id: string): Promise<Invoice> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const queryRunner = manager.connection.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        // Pessimistic lock to prevent concurrent modifications
        const invoice = await queryRunner.manager.findOne(Invoice, {
          where: { id },
          lock: { mode: 'pessimistic_write' }
        });

        if (!invoice) {
          throw new Error(`Invoice ${id} not found`);
        }

        if (invoice.status === InvoiceStatus.CANCELLED) {
          throw new Error(`Invoice ${id} is already cancelled`);
        }

        if (invoice.status === InvoiceStatus.FULLY_PAID) {
          throw new Error(`Cannot cancel fully paid invoice ${id}. Create a return instead.`);
        }

        invoice.status = InvoiceStatus.CANCELLED;
        invoice.cancelledAt = new Date();
        
        const cancelledInvoice = await queryRunner.manager.save(invoice);
        await queryRunner.commitTransaction();
        return cancelledInvoice;
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
      } finally {
        await queryRunner.release();
      }
    });
  }
}
