import { buildLabReportDocument, LabReportData } from './lab-report-document.js';

describe('buildLabReportDocument', () => {
  const data: LabReportData = {
    patientName: 'John Doe',
    patientPhone: '9876543210',
    requisitionNumber: 'LAB-2025-00001',
    testName: 'Complete Blood Count',
    specimenType: 'Blood',
    verifiedBy: 'Dr. Smith',
    verifiedAt: '2025-06-01T10:30:00.000Z',
    results: [
      { componentName: 'Hemoglobin', unit: 'g/dL', value: '13.2', referenceRange: '12.0-16.0', isAbnormal: false },
      { componentName: 'WBC', unit: '10^3/uL', value: '14.5', referenceRange: '4.0-11.0', isAbnormal: true },
    ],
  };

  it('lays out brand, title, patient block, results table and verified footer', () => {
    const doc = buildLabReportDocument(data);
    const content = doc.content as unknown[];

    expect(content[0]).toEqual({ text: 'VAIDYA', style: 'brand' });
    expect(content[1]).toEqual({ text: 'Laboratory Report', style: 'title' });

    const columns = content[3] as { columns: Array<Array<{ text: string }>> };
    const columnText = columns.columns.flat().map((c) => c.text);
    expect(columnText).toContain('Patient: John Doe');
    expect(columnText).toContain('Requisition: LAB-2025-00001');
    expect(columnText).toContain('Test: Complete Blood Count');
    expect(columnText).toContain('Specimen: Blood');
  });

  it('renders one header row plus a row per result, flagging abnormal values', () => {
    const doc = buildLabReportDocument(data);
    const content = doc.content as unknown[];
    const table = (content[5] as { table: { body: unknown[][] } }).table;

    expect(table.body).toHaveLength(3); // header + 2 results
    expect(table.body[0]).toEqual([
      { text: 'Component', style: 'tableHeader' },
      { text: 'Result', style: 'tableHeader' },
      { text: 'Unit', style: 'tableHeader' },
      { text: 'Reference Range', style: 'tableHeader' },
      { text: 'Flag', style: 'tableHeader' },
    ]);
    // Normal row: plain values.
    expect(table.body[1]).toEqual(['Hemoglobin', '13.2', 'g/dL', '12.0-16.0', '']);
    // Abnormal row: bold red flag cell.
    expect(table.body[2]).toEqual([
      'WBC',
      '14.5',
      '10^3/uL',
      '4.0-11.0',
      { text: 'ABNORMAL', bold: true, color: '#b91c1c' },
    ]);
  });

  it('includes the verified-by footer with a recognizable style', () => {
    const doc = buildLabReportDocument(data);
    const content = doc.content as unknown[];
    const lastTwo = content.slice(-2) as Array<{ text: string; style: string }>;

    expect(lastTwo[0]).toEqual({ text: 'Verified by: Dr. Smith', style: 'footer' });
    expect(lastTwo[1]).toEqual({ text: 'Verified at: 2025-06-01T10:30:00.000Z', style: 'footer' });
    expect((doc.styles as Record<string, { color?: string }>).brand?.color).toBe('#006D77');
  });
});
