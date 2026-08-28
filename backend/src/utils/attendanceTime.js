const config = require('../config/env');

const TIMEZONE = config.attendance.timezone;

/**
 * Attendance time helpers.
 *
 * Everything here works in the *office* timezone, never the server's. The old
 * code called `date.getHours()` and `date.getFullYear()` directly, which reads
 * the host clock: a punch at 09:20 Karachi time evaluated on a UTC host became
 * 04:20, so a late arrival was scored as five hours early and every punch after
 * 19:00 local was filed under the previous day.
 */

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** Calendar/clock fields of `date` as seen in the office timezone. */
function zonedParts(date) {
  const parts = partsFormatter.formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const hour = get('hour');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    // Intl renders midnight as 24 in some ICU versions under hour12:false.
    hour: hour === 24 ? 0 : hour,
    minute: get('minute'),
    second: get('second'),
  };
}

/**
 * The calendar date of `date` in the office timezone, as a UTC-midnight Date.
 *
 * Attendance.date is a `@db.Date` column, so storing UTC midnight keeps the
 * stored day equal to the local day the punch happened on.
 */
function officeDateMidnight(date) {
  const { year, month, day } = zonedParts(date);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Minutes since local midnight for `date`, in the office timezone. */
function officeMinutesOfDay(date) {
  const { hour, minute } = zonedParts(date);
  return hour * 60 + minute;
}

/** "09:30" -> 570. Returns null for anything unparseable. */
function timeToMinutes(value) {
  if (typeof value !== 'string') return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Parse a plain 'YYYY-MM-DD' (or ISO string) into a UTC-midnight Date. */
function toDateOnly(value) {
  if (value instanceof Date) return officeDateMidnight(value);

  const simple = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  if (simple) {
    return new Date(Date.UTC(Number(simple[1]), Number(simple[2]) - 1, Number(simple[3])));
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : officeDateMidnight(parsed);
}

const DEFAULT_SHIFT_START = timeToMinutes(config.attendance.officeStart) ?? 9 * 60 + 30;
const DEFAULT_SHIFT_END = timeToMinutes(config.attendance.officeEnd) ?? 18 * 60 + 30;
const DEFAULT_GRACE = 15;

/**
 * Late / early-departure / overtime minutes for one day, relative to the
 * employee's own shift. Grace applies to lateness only: arriving 10 minutes late
 * with a 15-minute grace scores 0, arriving 20 minutes late scores the full 20.
 */
function computeDayMetrics(employee, checkIn, checkOut) {
  const shiftStart = timeToMinutes(employee?.shiftStart) ?? DEFAULT_SHIFT_START;
  const shiftEnd = timeToMinutes(employee?.shiftEnd) ?? DEFAULT_SHIFT_END;
  const grace = Number.isInteger(employee?.graceMinutes) ? employee.graceMinutes : DEFAULT_GRACE;

  let late = 0;
  if (checkIn) {
    const diff = officeMinutesOfDay(checkIn) - shiftStart;
    if (diff > grace) late = diff;
  }

  let earlyDeparture = 0;
  let overtime = 0;
  if (checkOut) {
    const diff = officeMinutesOfDay(checkOut) - shiftEnd;
    if (diff < 0) earlyDeparture = Math.abs(diff);
    else overtime = diff;
  }

  return { late, earlyDeparture, overtime };
}

/** Inclusive list of UTC-midnight dates between two date-only values. */
function datesInRange(startDate, endDate) {
  const dates = [];
  const cursor = new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate())
  );
  const end = new Date(
    Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate())
  );

  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/** First and last instant of a payroll month, as UTC-midnight date-only bounds. */
function monthBounds(year, month) {
  return {
    start: new Date(Date.UTC(Number(year), Number(month) - 1, 1)),
    end: new Date(Date.UTC(Number(year), Number(month), 0)),
    daysInPeriod: new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate(),
  };
}

module.exports = {
  TIMEZONE,
  zonedParts,
  officeDateMidnight,
  officeMinutesOfDay,
  timeToMinutes,
  toDateOnly,
  computeDayMetrics,
  datesInRange,
  monthBounds,
  DEFAULT_SHIFT_START,
  DEFAULT_SHIFT_END,
  DEFAULT_GRACE,
};
