import { BadRequestException, ConflictException, Injectable, NotFoundException, Inject } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { Invoice } from './entities/invoice.entity.js';
import { InvoiceItem } from './entities/invoice-item.entity.js';
import { Payment } from './entities/payment.entity.js';
import { Patient } from '../patients/entities/patient.entity.js';
import { Deposit } from './entities/deposit.entity.js';
import { Return } from './entities/return.entity.js';
import { roundMoney } from './money.util.js';
import { Order } from '../orders/entities/order.entity.js';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { paginate, PaginatedResponseDto, PaginationQueryDto } from '@hospital/pagination';
import { OrderBillingAdapter } from './adapters/order-billing.adapter';

export interface CreateInvoiceItemInput {
  description: string;
  hsnSacCode?: string;
  quantity?: number;
  unitPrice: number;
  discountAmount?: number;
  taxPercent?: number;
  sourceOrderItemId?: string;
}

export interface CreateInvoiceInput {
  patientId: string;
  createdBy: string;
  sourceAppointmentId?: string;
  sourceAdmissionId?: string;
  notes?: string;
  items: CreateInvoiceItemInput[];
}

export interface RecordPaymentInput {
  amount: number;
  paymentMode: string;
  sourceDepositId?: string;
  receivedBy: string;
}

export interface CreateReturnInput {
  amount: number;
  reason: string;
  returnedBy: string;
}

export function getFinancialYearStart(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === 'year')!.value);
  const month = Number(parts.find((p) => p.type === 'month')!.value); // 1-indexed here
  return month >= 4 ? year : year - 1;
}

export function formatFinancialYear(startYear: number): string {
  const endYearShort = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endYearShort}`;
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    @Inject('LAB_BILLING_ADAPTER') private readonly labAdapter: OrderBillingAdapter,
    @Inject('RADIOLOGY_BILLING_ADAPTER') private readonly radiologyAdapter: OrderBillingAdapter,
    @Inject('PHARMACY_BILLING_ADAPTER') private readonly pharmacyAdapter: OrderBillingAdapter
  ) {}

  private static readonly PAYMENT_MODES = ['Cash', 'Card', 'UPI', 'Cheque', 'Deposit'] as const;

  private async generateInvoiceNumber(manager: EntityManager): Promise<{ invoiceNumber: number; financialYear: string }> {
    const startYear = getFinancialYearStart(new Date());
    const result = await manager.query(
      `
      INSERT INTO billing_sequences (prefix, year, "lastSequence")
      VALUES ($1, $2, 1)
      ON CONFLICT (prefix, year)
      DO UPDATE SET "lastSequence" = billing_sequences."lastSequence" + 1
      RETURNING "lastSequence"
      `,
      ['INV', startYear],
    );
    return { invoiceNumber: result[0].lastSequence as number, financialYear: formatFinancialYear(startYear) };
  }

  async create(
    input: CreateInvoiceInput,
  ): Promise<Invoice & { items: InvoiceItem[]; payments: Payment[]; returns: Return[] }> {
    if (input.sourceAppointmentId && input.sourceAdmissionId) {
      throw new BadRequestException(
        'An invoice can have at most one source: sourceAppointmentId or sourceAdmissionId, not both',
      );
    }
    if (!input.items || input.items.length === 0) {
      throw new BadRequestException('An invoice must include at least one item');
    }

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const patient = await manager.getRepository(Patient).findOne({ where: { id: input.patientId } });
      if (!patient) {
        throw new NotFoundException(`Patient ${input.patientId} not found`);
      }

      for (const item of input.items) {
        if (item.unitPrice < 0) {
          throw new BadRequestException(`Item "${item.description}" has a negative unitPrice`);
        }
        if (item.quantity !== undefined && item.quantity <= 0) {
          throw new BadRequestException(`Item "${item.description}" must have a positive quantity`);
        }
        const lineGross = item.unitPrice * (item.quantity ?? 1);
        if ((item.discountAmount ?? 0) > lineGross) {
          throw new BadRequestException(`Item "${item.description}" has a discountAmount exceeding its line subtotal`);
        }
      }

      const { invoiceNumber, financialYear } = await this.generateInvoiceNumber(manager);

      let subtotal = 0;
      let discountAmount = 0;
      let taxableAmount = 0;
      let taxAmount = 0;
      let totalAmount = 0;

      const itemsToInsert = input.items.map((item) => {
        const quantity = item.quantity ?? 1;
        const lineSubtotal = roundMoney(item.unitPrice * quantity);
        const lineDiscount = roundMoney(item.discountAmount ?? 0);
        const lineTaxable = roundMoney(lineSubtotal - lineDiscount);
        const taxPercent = item.taxPercent ?? 0;
        const lineTax = roundMoney(lineTaxable * (taxPercent / 100));
        const cgstAmount = roundMoney(lineTax / 2);
        const sgstAmount = roundMoney(lineTax - cgstAmount);
        const lineTotal = roundMoney(lineTaxable + lineTax);

        subtotal = roundMoney(subtotal + lineSubtotal);
        discountAmount = roundMoney(discountAmount + lineDiscount);
        taxableAmount = roundMoney(taxableAmount + lineTaxable);
        taxAmount = roundMoney(taxAmount + lineTax);
        totalAmount = roundMoney(totalAmount + lineTotal);

        return {
          sourceOrderItemId: item.sourceOrderItemId ?? null,
          description: item.description,
          hsnSacCode: item.hsnSacCode ?? null,
          quantity,
          unitPrice: item.unitPrice,
          discountAmount: lineDiscount,
          taxPercent,
          cgstAmount,
          sgstAmount,
          totalAmount: lineTotal,
        };
      });

      const invoiceRepository = manager.getRepository(Invoice);
      const invoice = await invoiceRepository.save(
        invoiceRepository.create({
          patientId: input.patientId,
          sourceAppointmentId: input.sourceAppointmentId ?? null,
          sourceAdmissionId: input.sourceAdmissionId ?? null,
          invoiceNumber,
          financialYear,
          subtotal,
          discountAmount,
          taxableAmount,
          taxAmount,
          totalAmount,
          paidAmount: 0,
          status: totalAmount === 0 ? 'Paid' : 'Unpaid',
          notes: input.notes ?? null,
          createdBy: input.createdBy,
        }),
      );

      const itemRepository = manager.getRepository(InvoiceItem);
      const items = await itemRepository.save(
        itemsToInsert.map((item) => itemRepository.create({ ...item, invoiceId: invoice.id })),
      );

      return { ...invoice, items, payments: [], returns: [] };
    });
  }

  async findOne(id: string): Promise<Invoice & { items: InvoiceItem[]; payments: Payment[]; returns: Return[] }> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const invoice = await manager.getRepository(Invoice).findOne({ where: { id } });
      if (!invoice) {
        throw new NotFoundException(`Invoice ${id} not found`);
      }
      const items = await manager.getRepository(InvoiceItem).find({
        where: { invoiceId: id },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
      const payments = await manager.getRepository(Payment).find({
        where: { invoiceId: id },
        order: { receivedAt: 'ASC', id: 'ASC' },
      });
      const returns = await manager.getRepository(Return).find({
        where: { invoiceId: id },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
      return { ...invoice, items, payments, returns };
    });
  }

  async list(query: PaginationQueryDto & { patientId?: string }): Promise<PaginatedResponseDto<Invoice>> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const qb = manager.getRepository(Invoice).createQueryBuilder('invoice');
      
      if (query.patientId) {
        qb.andWhere('invoice.patientId = :patientId', { patientId: query.patientId });
      }

      qb.orderBy('invoice.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }

  async cancel(id: string): Promise<Invoice> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Invoice);
      const invoice = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!invoice) {
        throw new NotFoundException(`Invoice ${id} not found`);
      }
      if (invoice.status === 'Cancelled') {
        throw new ConflictException(`Invoice ${id} is already cancelled`);
      }
      if (invoice.status === 'Paid') {
        throw new ConflictException(`Invoice ${id} is already paid and cannot be cancelled`);
      }
      if (invoice.paidAmount > 0) {
        throw new ConflictException(`Invoice ${id} cannot be cancelled because it has recorded payments`);
      }
      invoice.status = 'Cancelled';
      return repository.save(invoice);
    });
  }

  async recordPayment(invoiceId: string, input: RecordPaymentInput): Promise<Payment> {
    if (!InvoicesService.PAYMENT_MODES.includes(input.paymentMode as (typeof InvoicesService.PAYMENT_MODES)[number])) {
      throw new BadRequestException(`Unsupported paymentMode: ${input.paymentMode}`);
    }
    if (input.amount <= 0) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }
    if (input.paymentMode === 'Deposit' && !input.sourceDepositId) {
      throw new BadRequestException('sourceDepositId is required when paymentMode is Deposit');
    }

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const invoiceRepository = manager.getRepository(Invoice);
      const invoice = await invoiceRepository.findOne({ where: { id: invoiceId }, lock: { mode: 'pessimistic_write' } });
      if (!invoice) {
        throw new NotFoundException(`Invoice ${invoiceId} not found`);
      }
      if (invoice.status === 'Cancelled') {
        throw new ConflictException(`Invoice ${invoiceId} is cancelled and cannot accept payments`);
      }

      const outstanding = roundMoney(invoice.totalAmount - invoice.paidAmount);
      if (input.amount > outstanding) {
        throw new BadRequestException(`Payment amount ${input.amount} exceeds outstanding balance ${outstanding}`);
      }

      if (input.paymentMode === 'Deposit') {
        const depositRepository = manager.getRepository(Deposit);
        const deposit = await depositRepository.findOne({ where: { id: input.sourceDepositId }, lock: { mode: 'pessimistic_write' } });
        if (!deposit) {
          throw new NotFoundException(`Deposit ${input.sourceDepositId} not found`);
        }
        if (deposit.patientId !== invoice.patientId) {
          throw new BadRequestException(`Deposit ${input.sourceDepositId} does not belong to patient ${invoice.patientId}`);
        }
        if (input.amount > deposit.balance) {
          throw new ConflictException(`Deposit ${input.sourceDepositId} has insufficient balance for this payment`);
        }
        deposit.balance = roundMoney(deposit.balance - input.amount);
        await depositRepository.save(deposit);
      }

      const paymentRepository = manager.getRepository(Payment);
      const payment = await paymentRepository.save(
        paymentRepository.create({
          invoiceId,
          amount: input.amount,
          paymentMode: input.paymentMode,
          sourceDepositId: input.paymentMode === 'Deposit' ? (input.sourceDepositId as string) : null,
          receivedBy: input.receivedBy,
        }),
      );

      invoice.paidAmount = roundMoney(invoice.paidAmount + input.amount);
      invoice.status = invoice.paidAmount >= invoice.totalAmount ? 'Paid' : 'PartiallyPaid';
      await invoiceRepository.save(invoice);

      return payment;
    });
  }

  async createReturn(invoiceId: string, input: CreateReturnInput): Promise<Return> {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new BadRequestException('Return amount must be a positive number');
    }

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const invoiceRepository = manager.getRepository(Invoice);
      const invoice = await invoiceRepository.findOne({ where: { id: invoiceId }, lock: { mode: 'pessimistic_write' } });
      if (!invoice) {
        throw new NotFoundException(`Invoice ${invoiceId} not found`);
      }
      if (invoice.paidAmount <= 0) {
        throw new BadRequestException(
          `Invoice ${invoiceId} has no recorded payments to return against — use cancel instead`,
        );
      }
      if (input.amount > invoice.paidAmount) {
        throw new BadRequestException(`Return amount ${input.amount} exceeds invoice paidAmount ${invoice.paidAmount}`);
      }

      const returnRepository = manager.getRepository(Return);
      const returnRecord = await returnRepository.save(
        returnRepository.create({
          invoiceId,
          amount: input.amount,
          reason: input.reason,
          returnedBy: input.returnedBy,
        }),
      );

      invoice.totalAmount = roundMoney(invoice.totalAmount - input.amount);
      invoice.paidAmount = roundMoney(invoice.paidAmount - input.amount);
      invoice.status = invoice.paidAmount >= invoice.totalAmount ? 'Paid' : 'PartiallyPaid';
      await invoiceRepository.save(invoice);

      return returnRecord;
    });
  }

  /**
   * Auto-charge: Create an invoice item when a Lab/Radiology/Pharmacy order completes.
   * This is called by the respective workflow services when they mark an order as Completed.
   * Uses adapters to decouple billing from clinical modules.
   */
  async autoChargeForCompletedOrder(
    orderItemId: string,
    completedBy: string,
  ): Promise<{ invoice: Invoice; invoiceItem: InvoiceItem } | null> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const orderItemRepo = manager.getRepository(OrderItem);
      const orderItem = await orderItemRepo.findOne({ where: { id: orderItemId } });
      
      if (!orderItem) {
        throw new NotFoundException(`Order item ${orderItemId} not found`);
      }
      
      // Only auto-charge for completed items that haven't been charged yet
      if (orderItem.status !== 'Completed') {
        return null;
      }
      
      // Check if already invoiced via sourceOrderItemId
      const existingInvoiceItem = await manager.getRepository(InvoiceItem).findOne({
        where: { sourceOrderItemId: orderItemId },
      });
      
      if (existingInvoiceItem) {
        // Already charged, skip
        return null;
      }
      
      // Get patient from the parent order using TypeORM query builder
      const order = await manager.getRepository(Order)
        .createQueryBuilder('order')
        .select('order.patientId')
        .where('order.id = :id', { id: orderItem.orderId })
        .getOne();
      
      if (!order?.patientId) {
        throw new BadRequestException(`Order ${orderItem.orderId} has no patient associated`);
      }
      
      const patientId = order.patientId;
      
      // Use adapter to get pricing based on item type - decoupled from clinical modules
      const adapter = this.getAdapter(orderItem.itemType);
      const priceInfo = await adapter.getItemPrice(manager, orderItem);
      
      if (!priceInfo || priceInfo.unitPrice <= 0) {
        // No price configured, skip auto-billing but don't fail
        return null;
      }
      
      const unitPrice = priceInfo.unitPrice;
      const description = priceInfo.description || orderItem.itemDescription;
      
      // Create or get invoice for this patient's active visit
      // For simplicity, create a new invoice per charge-capture event
      // In production, you'd want to group charges into a single invoice per visit
      const { invoiceNumber, financialYear } = await this.generateInvoiceNumber(manager);
      
      const taxPercent = 0; // Could be configurable based on item type
      const lineTaxable = roundMoney(unitPrice);
      const lineTax = roundMoney(lineTaxable * (taxPercent / 100));
      const cgstAmount = roundMoney(lineTax / 2);
      const sgstAmount = roundMoney(lineTax - cgstAmount);
      const totalAmount = roundMoney(lineTaxable + lineTax);
      
      const invoiceRepository = manager.getRepository(Invoice);
      const invoice = await invoiceRepository.save(
        invoiceRepository.create({
          patientId,
          sourceAppointmentId: null,
          sourceAdmissionId: null,
          invoiceNumber,
          financialYear,
          subtotal: totalAmount,
          discountAmount: 0,
          taxableAmount: lineTaxable,
          taxAmount: lineTax,
          totalAmount,
          paidAmount: 0,
          status: 'Unpaid',
          notes: `Auto-charged for ${orderItem.itemType} order completion`,
          createdBy: completedBy,
        }),
      );
      
      const itemRepository = manager.getRepository(InvoiceItem);
      const invoiceItem = await itemRepository.save(
        itemRepository.create({
          invoiceId: invoice.id,
          sourceOrderItemId: orderItemId,
          description,
          hsnSacCode: null,
          quantity: 1,
          unitPrice,
          discountAmount: 0,
          taxPercent,
          cgstAmount,
          sgstAmount,
          totalAmount,
        }),
      );
      
      return { invoice, invoiceItem };
    });
  }

  /**
   * Gets the appropriate adapter based on order type.
   */
  private getAdapter(itemType: string): OrderBillingAdapter {
    switch (itemType) {
      case 'Lab':
        return this.labAdapter;
      case 'Radiology':
        return this.radiologyAdapter;
      case 'Pharmacy':
        return this.pharmacyAdapter;
      default:
        throw new Error(`Unknown order type: ${itemType}`);
    }
  }
}
