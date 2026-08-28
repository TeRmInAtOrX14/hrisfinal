/**
 * Shared formatters.
 *
 * Money was rendered with a bare `.toLocaleString()` on a raw float, so the
 * payroll screens showed values like "76,666.66666666667". Every currency figure
 * now goes through `money()`.
 */

const currencyFormatter = new Intl.NumberFormat('en-PK', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** "PKR 76,667" */
export function money(value, currency = 'PKR') {
  const n = Number(value);
  if (!Number.isFinite(n)) return `${currency} 0`;
  return `${currency} ${currencyFormatter.format(Math.round(n))}`;
}

/** "76,667" — when the currency label is already shown elsewhere. */
export function amount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? currencyFormatter.format(Math.round(n)) : '0';
}

export function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-PK') : '0';
}

export function percent(value, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : '0%';
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthName(month) {
  return MONTH_NAMES[Number(month) - 1] || '';
}

/** "Thu, Mar 12" */
export function shortDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** "12 Mar 2026" */
export function longDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "09:05" — clock time of a timestamp. */
export function clockTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function dateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-GB');
}

/** "1h 20m" from a minute count. */
export function minutesToDuration(mins) {
  const n = Math.round(Number(mins) || 0);
  if (n <= 0) return '—';
  const h = Math.floor(n / 60);
  const m = n % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Today's date as YYYY-MM-DD, for date inputs. */
export function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

/** First day of the current month as YYYY-MM-DD. */
export function monthStartInput() {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10);
}

/**
 * Selectable payroll years.
 *
 * The payroll modal hard-coded <option>2026</option><option>2027</option>, so
 * the screen would have become unusable in 2028.
 */
export function payrollYears(span = 2) {
  const current = new Date().getFullYear();
  const years = [];
  for (let y = current - span; y <= current + 1; y++) years.push(y);
  return years;
}
