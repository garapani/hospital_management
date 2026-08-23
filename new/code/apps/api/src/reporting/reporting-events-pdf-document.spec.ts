import {
  buildReportingEventsPdfDocument,
  ReportingEventPdfRow,
} from './reporting-events-pdf-document.js';

describe('buildReportingEventsPdfDocument', () => {
  const rows: ReportingEventPdfRow[] = [
    {
      id: 'evt-1',
      occurredAt: '2026-08-01T10:00:00.000Z',
      eventType: 'OrderPlaced',
      entityId: 'entity-1',
      correlationId: 'corr-1',
      payload: '{"amount":100}',
    },
    {
      id: 'evt-2',
      occurredAt: '2026-08-02T10:00:00.000Z',
      eventType: 'PaymentRecorded',
      entityId: 'entity-2',
      correlationId: '',
      payload: '{"amount":250}',
    },
  ];

  it('lays out brand, title, and a landscape orientation for wide rows', () => {
    const doc = buildReportingEventsPdfDocument({ rows, totalMatching: rows.length });
    const content = doc.content as unknown[];

    expect(doc.pageOrientation).toBe('landscape');
    expect(content[0]).toEqual({ text: 'VAIDYA', style: 'brand' });
    expect(content[1]).toEqual({ text: 'Reporting Events Export', style: 'title' });
  });

  it('renders a header row plus a row per event, and reports the row count', () => {
    const doc = buildReportingEventsPdfDocument({ rows, totalMatching: rows.length });
    const content = doc.content as unknown[];
    const table = content.find(
      (block): block is { table: { body: unknown[][] } } =>
        typeof block === 'object' && block !== null && 'table' in block,
    );

    expect(table).toBeDefined();
    expect(table!.table.body).toHaveLength(3); // header + 2 events
    expect(table!.table.body[0]).toEqual([
      { text: 'Occurred At', style: 'tableHeader' },
      { text: 'Event Type', style: 'tableHeader' },
      { text: 'Entity ID', style: 'tableHeader' },
      { text: 'Correlation ID', style: 'tableHeader' },
      { text: 'Payload', style: 'tableHeader' },
    ]);
    expect(table!.table.body[1]).toEqual([
      { text: '2026-08-01T10:00:00.000Z', fontSize: 8 },
      { text: 'OrderPlaced', fontSize: 8 },
      { text: 'entity-1', fontSize: 8 },
      { text: 'corr-1', fontSize: 8 },
      { text: '{"amount":100}', fontSize: 7 },
    ]);

    expect(content.some((block) => typeof block === 'object' && block !== null && 'text' in block && (block as { text: string }).text === '2 event(s)')).toBe(true);
  });

  it('surfaces active filters in a summary line when present, omits it when absent', () => {
    const withFilters = buildReportingEventsPdfDocument({
      rows,
      totalMatching: rows.length,
      eventType: 'OrderPlaced',
      from: '2026-08-01',
      to: '2026-08-31',
    });
    const filterText = (withFilters.content as Array<{ text?: string }>).find((block) =>
      block.text?.includes('Event type:'),
    );
    expect(filterText?.text).toBe('Event type: OrderPlaced  •  From: 2026-08-01  •  To: 2026-08-31');

    const withoutFilters = buildReportingEventsPdfDocument({ rows: [], totalMatching: 0 });
    const noFilterLine = (withoutFilters.content as Array<{ text?: string }>).find((block) =>
      block.text?.includes('Event type:'),
    );
    expect(noFilterLine).toBeUndefined();
  });

  it('shows a truncation notice when the row cap dropped matching events, not just the row count', () => {
    const capped = buildReportingEventsPdfDocument({ rows, totalMatching: 5000 });
    const notice = (capped.content as Array<{ text?: string }>).find((block) =>
      block.text?.startsWith('Showing'),
    );
    expect(notice?.text).toBe(
      'Showing 2 of 5000 matching event(s) (most recent first) — use CSV export for the full set',
    );

    const uncapped = buildReportingEventsPdfDocument({ rows, totalMatching: rows.length });
    const noNotice = (uncapped.content as Array<{ text?: string }>).find((block) =>
      block.text?.startsWith('Showing'),
    );
    expect(noNotice).toBeUndefined();
  });

  it('2.26: truncates an unbounded correlationId/payload before they reach the layout engine', () => {
    const longCorrelationId = 'x'.repeat(10000);
    const longPayload = JSON.stringify({ note: 'y'.repeat(10000) });
    const doc = buildReportingEventsPdfDocument({
      rows: [
        {
          id: 'evt-huge',
          occurredAt: '2026-08-01T10:00:00.000Z',
          eventType: 'OrderPlaced',
          entityId: 'entity-1',
          correlationId: longCorrelationId,
          payload: longPayload,
        },
      ],
      totalMatching: 1,
    });
    const table = (doc.content as Array<{ table?: { body: Array<Array<{ text: string }>> } }>).find(
      (block) => block.table,
    )!;
    const [, , , correlationCell, payloadCell] = table.table!.body[1];
    expect(correlationCell.text.length).toBeLessThan(100);
    expect(correlationCell.text).toContain('(truncated)');
    expect(payloadCell.text.length).toBeLessThan(2100);
    expect(payloadCell.text).toContain('(truncated)');
  });
});
