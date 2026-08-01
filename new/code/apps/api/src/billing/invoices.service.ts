import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { Invoice } from './entities/invoice.entity.js';
import { InvoiceItem } from './entities/invoice-item.entity.js';
import { Payment } from './entities/payment.entity.js';
import { Patient } from '../patients/entities/patient.entity.js';
import { roundMoney } from './money.util.js';

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
  constructor(private readonly tenantConnection: TenantConnectionService) {}

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

  async create(input: CreateInvoiceInput): Promise<Invoice & { items: InvoiceItem[]; payments: Payment[] }> {
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

      const { invoiceNumber, financialYear } = await this.generateInvoiceNumber(manager);

      let subtotal = 0;
      let discountAmount = 0;
      let taxableAmount = 0;
      let taxAmount = 0;
      let totalAmount = 0;

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
          status: 'Unpaid',
          notes: input.notes ?? null,
          createdBy: input.createdBy,
        }),
      );

      const itemRepository = manager.getRepository(InvoiceItem);
      const items = await itemRepository.save(
        itemsToInsert.map((item) => itemRepository.create({ ...item, invoiceId: invoice.id })),
      );

      return { ...invoice, items, payments: [] };
    });
  }

  async findOne(id: string): Promise<Invoice & { items: InvoiceItem[]; payments: Payment[] }> {
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
      return { ...invoice, items, payments };
    });
  }

  async list(
    patientId?: string,
    page = 1,
    limit = 20,
  ): Promise<{ data: Invoice[]; total: number; page: number; limit: number }> {
    const cappedLimit = Math.min(limit, 100);
    const skip = (page - 1) * cappedLimit;
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const [data, total] = await manager.getRepository(Invoice).findAndCount({
        where: patientId ? { patientId } : {},
        order: { createdAt: 'DESC' },
        skip,
        take: cappedLimit,
      });
      return { data, total, page, limit: cappedLimit };
    });
  }

  async cancel(id: string): Promise<Invoice> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Invoice);
      const invoice = await repository.findOne({ where: { id } });
      if (!invoice) {
        throw new NotFoundException(`Invoice ${id} not found`);
      }
      if (invoice.status === 'Cancelled') {
        throw new ConflictException(`Invoice ${id} is already cancelled`);
      }
      if (invoice.paidAmount > 0) {
        throw new ConflictException(`Invoice ${id} cannot be cancelled because it has recorded payments`);
      }
      invoice.status = 'Cancelled';
      return repository.save(invoice);
    });
  }
}
