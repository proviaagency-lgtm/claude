// Calendar helpers working on ISO dates ("YYYY-MM-DD") in UTC day numbers,
// so day counts never drift with time zones or daylight saving.

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86400000;

export function isISODate(value) {
  if (typeof value !== 'string') return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function toDayNumber(iso) {
  const m = ISO_RE.exec(iso);
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

export function fromDayNumber(n) {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** Number of calendar days from start to end, both included. */
export function daysInclusive(startIso, endIso) {
  return toDayNumber(endIso) - toDayNumber(startIso) + 1;
}

export function addDays(iso, n) {
  return fromDayNumber(toDayNumber(iso) + n);
}

/** Today's date in the viewer's local calendar. */
export function todayISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function monthKey(iso) {
  return iso.slice(0, 7);
}

/** Days shared by [aStart, aEnd] and [bStart, bEnd] (inclusive bounds, null = open). */
export function overlapDays(aStart, aEnd, bStart, bEnd) {
  const start = Math.max(toDayNumber(aStart), bStart ? toDayNumber(bStart) : -Infinity);
  const end = Math.min(toDayNumber(aEnd), bEnd ? toDayNumber(bEnd) : Infinity);
  return Math.max(0, end - start + 1);
}

/** Inclusive date window for a named period preset, relative to `today`. */
export function periodWindow(preset, today, custom = {}) {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  switch (preset) {
    case 'last-12-months':
      return { from: addDays(today, -364), to: today };
    case 'last-90-days':
      return { from: addDays(today, -89), to: today };
    case 'year-to-date':
      return { from: `${y}-01-01`, to: today };
    case 'last-year':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case 'quarter-to-date': {
      const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: `${y}-${String(qStartMonth).padStart(2, '0')}-01`, to: today };
    }
    case 'custom':
      return {
        from: isISODate(custom.from) ? custom.from : null,
        to: isISODate(custom.to) ? custom.to : null,
      };
    default:
      return { from: null, to: null };
  }
}
