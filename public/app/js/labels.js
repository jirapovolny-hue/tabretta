import { h } from './dom.js';

export const STATUSES = [
  ['napad', 'Nápad'],
  ['k_udelani', 'K udělání'],
  ['rozdelane', 'Rozdělané'],
  ['hotovo', 'Hotovo'],
];
export const STATUS_LABEL = Object.fromEntries(STATUSES);

export const KINDS = [
  ['prace', 'Práce'],
  ['soukrome', 'Soukromé'],
];
export const KIND_LABEL = Object.fromEntries(KINDS);

export function statusBadge(status) {
  return h('span', { class: `badge status status-${status}` }, STATUS_LABEL[status] ?? status);
}

export function kindBadge(kind) {
  return h('span', { class: 'badge' }, KIND_LABEL[kind] ?? kind);
}

/** '2026-12-24' → '24. 12. 2026' */
export function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${Number(m[3])}. ${Number(m[2])}. ${m[1]}` : '';
}

export function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dueBadge(dueDate, status) {
  if (!dueDate) return null;
  const overdue = status !== 'hotovo' && dueDate < todayIso();
  return h('span', { class: overdue ? 'badge due overdue' : 'badge due', title: overdue ? 'Po termínu' : 'Termín' }, formatDate(dueDate));
}

/** Štítky „čeká na: <název> (<stav>)“ pro nedokončené předchůdce. */
export function waitingBadges(waitingOn) {
  return (waitingOn ?? []).map((d) =>
    h('span', { class: 'badge waiting' }, `čeká na: ${d.title} (${STATUS_LABEL[d.status] ?? d.status})`),
  );
}

const numberFormat = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const formatPrice = (n) => numberFormat.format(n);

/** Číslo do vstupního pole česky (desetinná čárka), null → ''. */
export function formatNumberInput(n) {
  return n === null || n === undefined ? '' : String(n).replace('.', ',');
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}
