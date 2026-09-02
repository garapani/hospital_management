import { escapeCsvField, toCsv } from './accounting-csv.util.js';

describe('escapeCsvField / toCsv (pure)', () => {
  it('leaves plain fields untouched and quotes fields with commas, quotes, or newlines', () => {
    expect(escapeCsvField('plain')).toBe('plain');
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(123)).toBe('123');
    expect(escapeCsvField('with,comma')).toBe('"with,comma"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('line\nbreak')).toBe('"line\nbreak"');
  });

  it('emits a header row plus CRLF-terminated data rows', () => {
    const csv = toCsv(
      [
        { a: 1, b: 'x,y' },
        { a: 2, b: 'z' },
      ],
      ['a', 'b'],
    );
    expect(csv).toBe('a,b\r\n1,"x,y"\r\n2,z\r\n');
  });
});
