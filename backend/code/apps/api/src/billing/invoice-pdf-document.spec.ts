import { buildInvoicePdfDocument, InvoicePdfData } from './invoice-pdf-document.js';

function contentOf(doc: { content: unknown }): unknown[] {
  return doc.content as unknown[];
}

describe('buildInvoicePdfDocument', () => {
  const data: InvoicePdfData = {
    invoiceNumber: '42',
    financialYear: '2025-26',
    createdAt: '2026-09-03',
    status: 'PartiallyPaid',
    patientName: 'John Doe',
    patientNo: 'P-0001',
    patientPhone: '9999999999',
    items: [
      {
        description: 'Consultation',
        hsnSacCode: '9993',
        quantity: 1,
        unitPrice: 500,
        discountAmount: 0,
        cgstAmount: 45,
        sgstAmount: 45,
        igstAmount: 0,
        totalAmount: 590,
      },
    ],
    subtotal: 500,
    discountAmount: 0,
    taxAmount: 90,
    totalAmount: 590,
    paidAmount: 200,
    balanceDue: 390,
  };

  it('lays out brand and title, and shows the patient/invoice summary', () => {
    const doc = buildInvoicePdfDocument(data);
    const content = contentOf(doc);

    expect(content[0]).toEqual({ text: 'VAIDYA', style: 'brand' });
    expect(content[1]).toEqual({ text: 'Invoice / Receipt', style: 'title' });
    const summary = content[3] as { columns: unknown[][] };
    expect(summary.columns[0]).toContainEqual({ text: 'Patient: John Doe', style: 'field' });
    expect(summary.columns[0]).toContainEqual({ text: 'UHID: P-0001', style: 'field' });
    expect(summary.columns[1]).toContainEqual({ text: 'Invoice No: 42/2025-26', style: 'field' });
    expect(summary.columns[1]).toContainEqual({ text: 'Status: PartiallyPaid', style: 'field' });
  });

  it('renders a header row and one row per line item', () => {
    const doc = buildInvoicePdfDocument(data);
    const table = contentOf(doc).find(
      (block): block is { table: { body: unknown[][] } } =>
        typeof block === 'object' && block !== null && 'table' in block,
    );

    expect(table).toBeDefined();
    expect(table!.table.body).toHaveLength(2); // header + 1 line item
    expect(table!.table.body[0][0]).toEqual({ text: 'Description', style: 'tableHeader' });
    expect(table!.table.body[1]).toEqual([
      'Consultation',
      '9993',
      '1',
      '₹500.00',
      '₹0.00',
      '₹45.00',
      '₹45.00',
      '₹0.00',
      '₹590.00',
    ]);
  });

  it('renders the totals block with subtotal, tax, total, paid, and balance due', () => {
    const doc = buildInvoicePdfDocument(data);
    const totalsBlock = contentOf(doc).find(
      (block): block is { columns: [unknown, { table: { body: unknown[][] } }] } =>
        typeof block === 'object' &&
        block !== null &&
        'columns' in block &&
        typeof (block as { columns: unknown[] }).columns[1] === 'object' &&
        (block as { columns: unknown[] }).columns[1] !== null &&
        'table' in ((block as { columns: unknown[] }).columns[1] as object),
    );

    expect(totalsBlock).toBeDefined();
    const totalsTable = totalsBlock!.columns[1].table.body;
    expect(totalsTable).toContainEqual(['Subtotal', '₹500.00']);
    expect(totalsTable).toContainEqual(['Tax', '₹90.00']);
    expect(totalsTable).toContainEqual([{ text: 'Total', bold: true }, { text: '₹590.00', bold: true }]);
    expect(totalsTable).toContainEqual(['Paid', '₹200.00']);
    expect(totalsTable).toContainEqual([
      { text: 'Balance Due', bold: true },
      { text: '₹390.00', bold: true },
    ]);
  });

  it('renders an empty line-item table body (just the header) when there are no items', () => {
    const doc = buildInvoicePdfDocument({ ...data, items: [] });
    const table = contentOf(doc).find(
      (block): block is { table: { body: unknown[][] } } =>
        typeof block === 'object' && block !== null && 'table' in block,
    );

    expect(table!.table.body).toHaveLength(1);
  });
});
