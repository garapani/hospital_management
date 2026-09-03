import { PdfService } from '@hospital/pdf';
import { InvoicesService } from './invoices.service.js';
import { InvoiceExportService } from './invoice-export.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { AccountingService } from '../accounting/accounting.service.js';
import { JournalNumberGeneratorService } from '../accounting/journal-number-generator.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('InvoiceExportService (integration)', () => {
  let ctx: TenantTestContext;
  let patientsService: PatientsService;
  let invoicesService: InvoicesService;
  let exportService: InvoiceExportService;

  const STAFF_ID = '00000000-0000-4000-8000-0000000000f2';

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'invoice_export' });

    const patientSequence = new PatientNumberGeneratorService(ctx.tenantConnection);
    patientsService = new PatientsService(
      ctx.tenantConnection,
      patientSequence,
      new AccountsService(ctx.tenantConnection, ctx.dataSource, ctx.tenantContext),
      new PdfService(),
    );
    const accountingService = new AccountingService(
      ctx.tenantConnection,
      new JournalNumberGeneratorService(ctx.tenantConnection),
      ctx.tenantContext,
    );
    invoicesService = new InvoicesService(ctx.tenantConnection, ctx.tenantContext, accountingService);
    exportService = new InvoiceExportService(invoicesService, ctx.tenantConnection, new PdfService());
  });

  afterAll(() => teardownTenantTestContext(ctx));

  it('renders a PDF starting with the %PDF- magic bytes, for an invoice with line items', async () => {
    const buffer = await ctx.inTenant(async () => {
      const patient = await patientsService.create({
        firstName: 'Invoice',
        lastName: 'Pdf',
        dateOfBirth: '1990-01-01',
        gender: 'Male',
        phoneNumber: '5559990001',
      });
      const invoice = await invoicesService.create({
        patientId: patient.id,
        createdBy: STAFF_ID,
        items: [{ description: 'Consultation Fee', unitPrice: 500, taxPercent: 12 }],
      });
      return exportService.renderInvoicePdf(invoice.id);
    });

    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('throws NotFoundException for an unknown invoice id, same as InvoicesService.findOne', async () => {
    await expect(
      ctx.inTenant(() =>
        exportService.renderInvoicePdf('00000000-0000-0000-0000-000000000000'),
      ),
    ).rejects.toThrow('not found');
  });
});
