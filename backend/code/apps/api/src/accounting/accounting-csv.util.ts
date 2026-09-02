/**
 * RFC 4180 CSV serialization. Fields containing a comma, quote, or newline are quoted, and
 * embedded quotes are doubled. Row order is preserved.
 *
 * Local copy of reporting/reporting-csv.util.ts — the module-boundary lint rule
 * (eslint.config.mjs, `domain:accounting` has no edge to `domain:reporting`) blocks a
 * cross-domain import for a two-function pure utility, so it's duplicated rather than promoted
 * to a shared lib for one caller on each side.
 */
export function escapeCsvField(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.map(escapeCsvField).join(',');
  const body = rows.map((row) => columns.map((c) => escapeCsvField(row[c])).join(','));
  return [header, ...body].join('\r\n') + '\r\n';
}
