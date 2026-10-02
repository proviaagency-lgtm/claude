// Coercion of a single form/CSV/API value according to its field definition.

import { parseNumber, parseDate, parseBoolean, normalizeKey } from './parse.js';
import { fmtDecimal } from './format.js';

export function isEmpty(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

/**
 * Returns { value } (undefined when empty) or { error } with a French message.
 */
export function coerceField(field, raw) {
  if (isEmpty(raw)) return { value: undefined };
  switch (field.type) {
    case 'text':
    case 'textarea': {
      const s = String(raw).trim();
      const max = field.maxLength ?? (field.type === 'textarea' ? 2000 : 200);
      if (s.length > max) return { error: `${max} caractères maximum.` };
      if (field.pattern && !field.pattern.test(s)) return { error: field.patternMessage || 'Format invalide.' };
      return { value: s };
    }
    case 'number':
    case 'integer':
    case 'percent': {
      const n = parseNumber(raw);
      if (n === undefined) return { value: undefined };
      if (Number.isNaN(n)) return { error: 'Nombre invalide.' };
      if (field.type === 'integer' && !Number.isInteger(n)) return { error: 'Nombre entier attendu.' };
      const min = field.min ?? (field.type === 'percent' ? 0 : undefined);
      const max = field.max ?? (field.type === 'percent' ? 100 : undefined);
      if (min !== undefined && n < min) return { error: `Minimum : ${fmtDecimal(min, 3)}.` };
      if (max !== undefined && n > max) return { error: `Maximum : ${fmtDecimal(max, 3)}.` };
      return { value: n };
    }
    case 'date': {
      const d = parseDate(raw);
      if (d === undefined) return { value: undefined };
      if (d === null) return { error: 'Date invalide (format JJ/MM/AAAA).' };
      return { value: d };
    }
    case 'boolean': {
      const b = parseBoolean(raw);
      if (b === undefined) return { value: undefined };
      if (b === null) return { error: 'Valeur oui / non attendue.' };
      return { value: b };
    }
    case 'select': {
      const s = String(raw).trim();
      const key = normalizeKey(s);
      const option = field.options.find((o) => o.value === s)
        || field.options.find((o) => normalizeKey(o.label) === key || normalizeKey(o.value) === key);
      if (!option) return { error: 'Valeur non reconnue.' };
      return { value: option.value };
    }
    case 'ref': {
      const s = String(raw).trim();
      if (s.length > 64) return { error: 'Référence invalide.' };
      return { value: s };
    }
    default:
      return { error: 'Type de champ inconnu.' };
  }
}
