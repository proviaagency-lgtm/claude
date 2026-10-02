// CSV reading and writing tuned for French Excel: ";" separator, decimal
// comma, UTF-8 with BOM. Reading auto-detects ";", "," or tab separators.

const DELIMITERS = [';', ',', '\t'];

export function detectDelimiter(text) {
  const counts = new Map(DELIMITERS.map((d) => [d, 0]));
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === '\n') break;
    else if (!inQuotes && counts.has(ch)) counts.set(ch, counts.get(ch) + 1);
  }
  let best = ';';
  for (const d of DELIMITERS) if (counts.get(d) > counts.get(best)) best = d;
  return best;
}

/**
 * Parses CSV text. Returns { delimiter, headers, rows, lines } where
 * lines[i] is the 1-based source line of rows[i]. Blank lines are skipped.
 */
export function parseCSV(text, delimiter) {
  const source = String(text ?? '').replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
  const sep = delimiter || detectDelimiter(source);
  const records = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line += 1;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field.trim() === '') {
      field = '';
      inQuotes = true;
    } else if (ch === sep) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      records.push({ cells: row, line: rowLine });
      row = [];
      field = '';
      line += 1;
      rowLine = line;
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    records.push({ cells: row, line: rowLine });
  }

  const nonBlank = records.filter((r) => r.cells.some((c) => c.trim() !== ''));
  const [head, ...body] = nonBlank;
  return {
    delimiter: sep,
    headers: head ? head.cells.map((h) => h.trim()) : [],
    rows: body.map((r) => r.cells),
    lines: body.map((r) => r.line),
  };
}

/**
 * Neutralises spreadsheet formula injection: a text cell starting with
 * = + - @ (or a tab / carriage return) is prefixed with an apostrophe.
 */
export function protectCell(value) {
  const s = String(value ?? '');
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function toCSV(headers, rows, delimiter = ';') {
  const escape = (value) => {
    const s = value === null || value === undefined ? '' : String(value);
    return /["\n\r;,\t]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(escape).join(delimiter)).join('\r\n');
}

/** Number for a French spreadsheet: decimal comma, no grouping. */
export function csvNumber(value, maxDigits = 4) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const factor = 10 ** maxDigits;
  return String(Math.round(value * factor) / factor).replace('.', ',');
}
