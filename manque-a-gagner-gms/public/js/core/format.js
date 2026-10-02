// French number, money and date formatting. Intl uses U+202F (narrow no-break
// space) as the fr-FR group separator; it is swapped for U+00A0 so every font
// renders it and copied figures paste cleanly into Excel.

const NBSP = '\u00a0';
const formatters = new Map();

function nf(min, max) {
  const key = `${min}-${max}`;
  if (!formatters.has(key)) {
    formatters.set(key, new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
    }));
  }
  return formatters.get(key);
}

const clean = (s) => s.replace(/\u202f/g, NBSP);

export function fmtNumber(value, digits = 0) {
  if (!Number.isFinite(value)) return '—';
  return clean(nf(digits, digits).format(value));
}

/** Number with up to `maxDigits` decimals, trailing zeros dropped ("6,5", "12"). */
export function fmtDecimal(value, maxDigits = 2) {
  if (!Number.isFinite(value)) return '—';
  return clean(nf(0, maxDigits).format(value));
}

export function fmtEuro(value, { compact = false } = {}) {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (compact && abs >= 1e6) {
    const digits = abs >= 1e8 ? 0 : abs >= 1e7 ? 1 : 2;
    return `${clean(nf(digits, digits).format(value / 1e6))}${NBSP}M€`;
  }
  if (compact && abs >= 1e4) {
    const digits = abs >= 1e5 ? 0 : 1;
    return `${clean(nf(0, digits).format(value / 1e3))}${NBSP}k€`;
  }
  return `${clean(nf(0, 0).format(Math.round(value)))}${NBSP}€`;
}

/** Unit price with cents ("2,15 €"). */
export function fmtPrice(value) {
  if (!Number.isFinite(value)) return '—';
  return `${clean(nf(2, 2).format(value))}${NBSP}€`;
}

export function fmtUnits(value, { compact = false } = {}) {
  if (!Number.isFinite(value)) return '—';
  if (compact && Math.abs(value) >= 1e6) return `${clean(nf(0, 1).format(value / 1e6))}${NBSP}M${NBSP}UVC`;
  if (compact && Math.abs(value) >= 1e4) return `${clean(nf(0, 1).format(value / 1e3))}${NBSP}k${NBSP}UVC`;
  return `${clean(nf(0, 0).format(Math.round(value)))}${NBSP}UVC`;
}

/** Ratio (0.125) as a French percentage ("12,5 %"). */
export function fmtPct(ratio, digits = 1) {
  if (!Number.isFinite(ratio)) return '—';
  return `${clean(nf(0, digits).format(ratio * 100))}${NBSP}%`;
}

/** A value already expressed in percent (12.5) as "12,5 %". */
export function fmtPercentValue(value, digits = 1) {
  if (!Number.isFinite(value)) return '—';
  return `${clean(nf(0, digits).format(value))}${NBSP}%`;
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function fmtDateLong(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS_LONG[Number(m) - 1]} ${y}`;
}

/** "2026-03" → "mars 26" (short) or "mars 2026". */
export function fmtMonth(key, { short = true } = {}) {
  const [y, m] = key.split('-');
  return short ? `${MONTHS[Number(m) - 1]} ${y.slice(2)}` : `${MONTHS_LONG[Number(m) - 1]} ${y}`;
}

export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${fmtNumber(count)}${NBSP}${Math.abs(count) >= 2 ? pluralForm : singular}`;
}
