import type { PdfDocumentDefinition } from '@hospital/pdf';

export interface ReportingEventPdfRow {
  id: string;
  occurredAt: string;
  eventType: string;
  entityId: string;
  correlationId: string;
  payload: string;
}

export interface ReportingEventsPdfData {
  rows: ReportingEventPdfRow[];
  /** Total matching rows before the row cap was applied — used to show a truncation notice when
   *  it exceeds rows.length, rather than letting a capped export read as the complete set. */
  totalMatching: number;
  from?: string;
  to?: string;
  eventType?: string;
}

// correlationId is attacker-controlled (an authenticated caller sets it via the X-Correlation-Id
// request header — see tenant-context.middleware.ts — with no length cap at the DB column
// either), and both it and payload feed straight into pdfmake's layout engine below. Lowering the
// row cap (500, reporting-query.service.ts) alone doesn't bound the actual DoS-shaped cost: an
// unbroken multi-KB string in an 'auto'-width table cell is what makes pdfmake's synchronous
// layout pass expensive, independent of row count. Truncated here (PDF-only) rather than in the
// shared mapEventToExportRow — CSV has no layout-engine cost, so it keeps full fidelity.
const CORRELATION_ID_MAX_CHARS = 64;
const PAYLOAD_MAX_CHARS = 2000;

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}… (truncated)` : value;
}

/**
 * Pure builder for the reporting-events PDF export — no pdfmake dependency here, so the
 * structure is unit testable without rendering. Mirrors the Lab/Radiology report document
 * builders (`lab-report-document.ts`, `radiology-report-document.ts`): same brand/title/table
 * style vocabulary, so every `@hospital/pdf` document in this codebase looks like one system.
 */
export function buildReportingEventsPdfDocument(data: ReportingEventsPdfData): PdfDocumentDefinition {
  const tableBody = [
    [
      { text: 'Occurred At', style: 'tableHeader' },
      { text: 'Event Type', style: 'tableHeader' },
      { text: 'Entity ID', style: 'tableHeader' },
      { text: 'Correlation ID', style: 'tableHeader' },
      { text: 'Payload', style: 'tableHeader' },
    ],
    ...data.rows.map((row) => [
      { text: row.occurredAt, fontSize: 8 },
      { text: row.eventType, fontSize: 8 },
      { text: row.entityId, fontSize: 8 },
      { text: truncate(row.correlationId || '', CORRELATION_ID_MAX_CHARS), fontSize: 8 },
      { text: truncate(row.payload, PAYLOAD_MAX_CHARS), fontSize: 7 },
    ]),
  ];

  const filterParts: string[] = [];
  if (data.eventType) filterParts.push(`Event type: ${data.eventType}`);
  if (data.from) filterParts.push(`From: ${data.from}`);
  if (data.to) filterParts.push(`To: ${data.to}`);

  return {
    pageOrientation: 'landscape',
    content: [
      { text: 'VAIDYA', style: 'brand' },
      { text: 'Reporting Events Export', style: 'title' },
      { text: '\n' },
      ...(filterParts.length > 0
        ? [{ text: filterParts.join('  •  '), style: 'field' }, { text: '\n' }]
        : []),
      {
        text:
          data.totalMatching > data.rows.length
            ? `Showing ${data.rows.length} of ${data.totalMatching} matching event(s) (most recent first) — use CSV export for the full set`
            : `${data.rows.length} event(s)`,
        style: 'field',
      },
      { text: '\n' },
      {
        table: {
          headerRows: 1,
          widths: ['auto', 'auto', 'auto', 'auto', '*'],
          body: tableBody,
        },
      },
    ],
    styles: {
      brand: { fontSize: 18, bold: true, color: '#006D77' },
      title: { fontSize: 14, bold: true, margin: [0, 4, 0, 12] },
      field: { fontSize: 10, margin: [0, 2, 0, 2] },
      tableHeader: { bold: true, fillColor: '#E8F5F5', fontSize: 8 },
    },
    defaultStyle: { fontSize: 8 },
  };
}
