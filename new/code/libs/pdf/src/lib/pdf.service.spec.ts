import { PdfService } from './pdf.service.js';

describe('PdfService', () => {
  const service = new PdfService();

  it('renders a document definition to a PDF buffer', async () => {
    const buffer = await service.render({
      content: [{ text: 'Hello PDF' }],
    });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('renders a report-style definition (table + styles + vfs fonts)', async () => {
    const buffer = await service.render({
      content: [
        { text: 'Report', style: 'title' },
        {
          table: {
            headerRows: 1,
            widths: ['*', '*'],
            body: [
              [{ text: 'Component', style: 'tableHeader' }, { text: 'Result', style: 'tableHeader' }],
              ['Hemoglobin', '13.2'],
            ],
          },
        },
      ],
      styles: {
        title: { fontSize: 14, bold: true },
        tableHeader: { bold: true, fillColor: '#E8F5F5' },
      },
      defaultStyle: { fontSize: 10 },
    });

    // The vfs-wired Roboto family gets embedded, so the buffer is larger than a bare definition.
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
