/** Minimal RFC-4180 CSV helpers shared by the streaming export endpoints. */

/** Escapes a single CSV field, quoting it only when it contains a comma, quote or newline. */
export function escapeCsv(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Joins a record's values into one CSV line. */
export function toCsvRow(values: Array<string | number>): string {
  return values.map(escapeCsv).join(',');
}
