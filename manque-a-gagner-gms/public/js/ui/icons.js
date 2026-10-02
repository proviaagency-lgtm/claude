// Line icons (24 × 24, stroke = currentColor) and the brand mark.

import { raw } from './dom.js';

const PATHS = {
  plus: 'M12 5v14M5 12h14',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  download: 'M12 4v12M7 11l5 5 5-5M5 20h14',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  alert: 'M12 3.5 21.5 20h-19L12 3.5zM12 10v4.5M12 17.5v.5',
  check: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12.5l2.8 2.8L16.5 9',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5v.5',
  critical: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5v6M12 16.5v.5',
  x: 'M6 6l12 12M18 6 6 18',
  menu: 'M4 6h16M4 12h16M4 18h16',
  logout: 'M9 4H5v16h4M15 8l4 4-4 4M19 12H10',
  dashboard: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  pitch: 'M4 5h16v11H10l-6 4V5zM8 9h8M8 12h5',
  box: 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM4 7.5l8 4.5 8-4.5M12 12v9',
  store: 'M3 9l2-5h14l2 5M4 9v11h16V9M3 9h18M9 20v-6h6v6',
  sliders: 'M4 7h16M4 17h16M9 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM15 19.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  users: 'M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5a3 3 0 0 1 0 6M21 20c0-2.6-1.6-4.8-4-5.6',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4.4 3.6-8 8-8s8 3.6 8 8',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  printer: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  sort: 'M8 10l4-4 4 4M8 14l4 4 4-4',
  sortUp: 'M8 14l4-4 4 4',
  sortDown: 'M8 10l4 4 4-4',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
  chart: 'M4 20h16M7 16v-5M12 16V6M17 16v-8',
  file: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5',
};

export function icon(name, { label } = {}) {
  const d = PATHS[name];
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true" focusable="false"';
  return raw(`<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${a11y}><path d="${d}"/></svg>`);
}

/** A shelf with one empty slot: the missing product is the "manque à gagner". */
export function brandMark() {
  return raw(`<svg class="brand-mark" viewBox="0 0 30 30" aria-hidden="true" focusable="false">
    <rect width="30" height="30" rx="7" fill="var(--tag)"/>
    <rect x="6" y="11" width="5" height="10" rx="1" fill="var(--tag-ink)"/>
    <rect x="13.25" y="13.25" width="3.5" height="7" rx="0.6" fill="none" stroke="var(--tag-ink)" stroke-width="1.5" stroke-dasharray="1.6 1.4"/>
    <rect x="19" y="9" width="5" height="12" rx="1" fill="var(--tag-ink)"/>
    <path d="M4.5 22.75h21" stroke="var(--tag-ink)" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`);
}
