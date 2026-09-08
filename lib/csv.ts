// CSV writing, done properly rather than by joining on commas.
//
// The corpus is full of things that break naive CSV: commas inside titles
// ("Cuentos: Tales from the Hispanic Southwest"), quotation marks inside
// notes_internal, and newlines inside note bodies. RFC 4180 says a field
// containing any of those is wrapped in double quotes, and a literal double
// quote inside becomes two. That is the whole format.

function field(value: unknown): string {
  if (value === null || value === undefined) return '';

  // Postgres arrays arrive as JS arrays; a semicolon keeps them readable in one
  // cell without colliding with the delimiter.
  const raw = Array.isArray(value) ? value.join('; ') : String(value);

  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
}

export function toCsv(
  columns: string[],
  rows: Record<string, unknown>[],
): string {
  const lines = [columns.map(field).join(',')];

  for (const row of rows) {
    lines.push(columns.map((column) => field(row[column])).join(','));
  }

  // CRLF per the spec, and a UTF-8 byte order mark because Excel otherwise
  // reads Anzaldúa, Páramo, and Gómez-Barris as mojibake. Numbers and other
  // readers ignore it.
  return '\ufeff' + lines.join('\r\n') + '\r\n';
}

export function csvResponse(filename: string, body: string): Response {
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}-${stamp}.csv"`,
      // A backup that came from cache is not a backup.
      'cache-control': 'no-store',
    },
  });
}
