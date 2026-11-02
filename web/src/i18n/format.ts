import { getLang } from './state';

/** Formats dépendants de la langue active (Intl). */
const locale = () => (getLang() === 'fr' ? 'fr-FR' : 'en-GB');

export function timeAgo(iso: string | number | null | undefined) {
  if (iso == null || iso === '') return '—';
  const rtf = new Intl.RelativeTimeFormat(getLang(), { numeric: 'auto' });
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(Math.round(s), 'second');
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
  if (abs < 86400 * 365) return rtf.format(Math.round(s / (86400 * 30)), 'month');
  return rtf.format(Math.round(s / (86400 * 365)), 'year');
}

/** Date et heure (`Date.toLocaleString` avec la langue active). */
export const fmtDateTime = (d: string | number | Date, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }) =>
  new Date(d).toLocaleString(locale(), opts);
export const fmtDate = (d: string | number | Date, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }) =>
  new Date(d).toLocaleDateString(locale(), opts);
export const fmtTime = (d: string | number | Date, opts: Intl.DateTimeFormatOptions = { hour12: false }) =>
  new Date(d).toLocaleTimeString(locale(), opts);
export const fmtNumber = (n: number, opts?: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale(), opts).format(n);

/** Taille en octets lisible (Ko / KB selon la langue). */
export function fmtBytes(n: number) {
  const u = getLang() === 'fr' ? ['o', 'Ko', 'Mo', 'Go'] : ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${fmtNumber(n, { maximumFractionDigits: i ? 1 : 0 })} ${u[i]}`;
}

/** Comparaison de noms selon la langue (tri alphabétique). */
export const compareText = (a: string, b: string) => a.localeCompare(b, getLang(), { sensitivity: 'base' });
