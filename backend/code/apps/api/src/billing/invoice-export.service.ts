import { Injectable } from '@nestjs/common';
import { PdfService } from '@hospital/pdf';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { Patient } from '../patients/entities/patient.entity.js';
import { InvoicesService } from './invoices.service.js';
import { buildInvoicePdfDocument } from './invoice-pdf-document.js';

/**
 * Kept off `InvoicesService`'s own constructor — that service is directly `new`'d in several
 * integration specs, so adding a dependency there means updating every one of them for a concern
 * only the invoice PDF cares about. Depends on `InvoicesService` as a normal injected
 * collaborator instead, calling its already-public `findOne()` (see Development-Standards.md
 * §131, the same pattern `AccountingExportService` established).
 */
@Injectable()
export class InvoiceExportService {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly tenantConnection: TenantConnectionService,
    private readonly pdfService: PdfService,
  ) {}

  async renderInvoicePdf(id: string): Promise<Buffer> {
    const invoice = await this.invoicesService.findOne(id);
    const patient = await this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Patient).findOne({ where: { id: invoice.patientId } }),
    );

    return this.pdfService.render(
      buildInvoicePdfDocument({
        invoiceNumber: String(invoice.invoiceNumber),
        financialYear: invoice.financialYear,
        createdAt: invoice.createdAt.toISOString().slice(0, 10),
        status: invoice.status,
        patientName: patient ? `${patient.firstName} ${patient.lastName}` : 'Unknown',
        patientNo: patient?.patientNo ?? '',
        patientPhone: patient?.phoneNumber ?? '',
        items: invoice.items.map((item) => ({
          description: item.description,
          hsnSacCode: item.hsnSacCode,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountAmount: item.discountAmount,
          cgstAmount: item.cgstAmount,
          sgstAmount: item.sgstAmount,
          igstAmount: item.igstAmount,
          totalAmount: item.totalAmount,
        })),
        subtotal: invoice.subtotal,
        discountAmount: invoice.discountAmount,
        taxAmount: invoice.taxAmount,
        totalAmount: invoice.totalAmount,
        paidAmount: invoice.paidAmount,
        balanceDue: invoice.totalAmount - invoice.paidAmount,
      }),
    );
  }
}
