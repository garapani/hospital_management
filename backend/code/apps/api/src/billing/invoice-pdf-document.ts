import type { PdfDocumentDefinition } from '@hospital/pdf';

export interface InvoicePdfLineItem {
  description: string;
  hsnSacCode: string | null;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  totalAmount: number;
}

export interface InvoicePdfData {
  invoiceNumber: string;
  financialYear: string;
  createdAt: string;
  status: string;
  patientName: string;
  patientNo: string;
  patientPhone: string;
  items: InvoicePdfLineItem[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  balanceDue: number;
}

/**
 * Pure builder for the patient invoice/receipt PDF — no pdfmake dependency here, so the structure
 * is unit testable without rendering. Mirrors the Lab report PDF's shape (buildLabReportDocument):
 * brand header, a two-column patient/invoice summary, a line-item table, then totals.
 */
export function buildInvoicePdfDocument(data: InvoicePdfData): PdfDocumentDefinition {
  const money = (value: number) => `₹${value.toFixed(2)}`;

  const itemTableBody = [
    [
      { text: 'Description', style: 'tableHeader' },
      { text: 'HSN/SAC', style: 'tableHeader' },
      { text: 'Qty', style: 'tableHeader' },
      { text: 'Unit Price', style: 'tableHeader' },
      { text: 'Discount', style: 'tableHeader' },
      { text: 'CGST', style: 'tableHeader' },
      { text: 'SGST', style: 'tableHeader' },
      { text: 'Amount', style: 'tableHeader' },
    ],
    ...data.items.map((item) => [
      item.description,
      item.hsnSacCode ?? '',
      String(item.quantity),
      money(item.unitPrice),
      money(item.discountAmount),
      money(item.cgstAmount),
      money(item.sgstAmount),
      money(item.totalAmount),
    ]),
  ];

  return {
    content: [
      { text: 'VAIDYA', style: 'brand' },
      { text: 'Invoice / Receipt', style: 'title' },
      { text: '\n' },
      {
        columns: [
          [
            { text: `Patient: ${data.patientName}`, style: 'field' },
            { text: `UHID: ${data.patientNo}`, style: 'field' },
            { text: `Phone: ${data.patientPhone}`, style: 'field' },
          ],
          [
            { text: `Invoice No: ${data.invoiceNumber}/${data.financialYear}`, style: 'field' },
            { text: `Date: ${data.createdAt}`, style: 'field' },
            { text: `Status: ${data.status}`, style: 'field' },
          ],
        ],
      },
      { text: '\n' },
      {
        table: {
          headerRows: 1,
          widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
          body: itemTableBody,
        },
      },
      { text: '\n' },
      {
        columns: [
          { text: '', width: '*' },
          {
            width: 'auto',
            table: {
              body: [
                ['Subtotal', money(data.subtotal)],
                ['Discount', money(data.discountAmount)],
                ['Tax', money(data.taxAmount)],
                [{ text: 'Total', bold: true }, { text: money(data.totalAmount), bold: true }],
                ['Paid', money(data.paidAmount)],
                [{ text: 'Balance Due', bold: true }, { text: money(data.balanceDue), bold: true }],
              ],
            },
            layout: 'noBorders',
          },
        ],
      },
    ],
    styles: {
      brand: { fontSize: 18, bold: true, color: '#006D77' },
      title: { fontSize: 14, bold: true, margin: [0, 4, 0, 12] },
      field: { fontSize: 10, margin: [0, 2, 0, 2] },
      tableHeader: { bold: true, fillColor: '#E8F5F5' },
    },
    defaultStyle: { fontSize: 9 },
  };
}
