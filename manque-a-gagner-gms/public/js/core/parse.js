// Lenient parsing of values typed by hand or exported from French Excel
// ("1 234,56 €", "12,5 %", "03/02/2026").

import { isISODate } from './dates.js';

/**
 * Parses a number written the French or English way.
 * Returns undefined for empty input and NaN for anything unreadable.
 * A single comma is read as the decimal separator ("1,5" → 1.5).
 */
export function parseNumber(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : NaN;
  if (input === null || input === undefined) return undefined;
  let s = String(input).trim();
  if (s === '') return undefined;
  s = s.replace(/[\s\u00a0\u202f']/g, '').replace(/[€%]/g, '').replace(/^\+/, '');
  if (s === '') return undefined;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (hasComma) {
    const parts = s.split(',');
    s = parts.length > 2 ? parts.join('') : s.replace(',', '.');
  } else if (hasDot && s.split('.').length > 2) {
    s = s.replace(/\./g, '');
  }
  if (!/^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
  return Number(s);
}

/**
 * Parses a date as ISO (2026-03-02), French (02/03/2026, 2/3/26, 02-03-2026,
 * 02.03.2026) or year-first with slashes (2026/03/02).
 * Returns undefined for empty input and null for an invalid date.
 */
export function parseDate(input) {
  if (input === null || input === undefined) return undefined;
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return input.toISOString().slice(0, 10);
  }
  const s = String(input).trim();
  if (s === '') return undefined;
  let y;
  let m;
  let d;
  let match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/.exec(s);
  if (match) {
    [y, m, d] = [match[1], match[2], match[3]];
  } else {
    match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:\s.*)?$/.exec(s);
    if (!match) return null;
    [d, m, y] = [match[1], match[2], match[3]];
    if (y.length === 2) y = `20${y}`;
  }
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isISODate(iso) ? iso : null;
}

export function parseBoolean(input) {
  if (typeof input === 'boolean') return input;
  if (input === null || input === undefined) return undefined;
  const s = String(input).trim().toLowerCase();
  if (s === '') return undefined;
  if (['1', 'true', 'oui', 'yes', 'vrai', 'o', 'x'].includes(s)) return true;
  if (['0', 'false', 'non', 'no', 'faux', 'n'].includes(s)) return false;
  return null;
}

/** Lowercase, accent-free, alphanumeric-only key used to match headers and names. */
export function normalizeKey(input) {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}
