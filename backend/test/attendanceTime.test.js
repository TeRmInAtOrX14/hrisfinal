const test = require('node:test');
const assert = require('node:assert/strict');

const {
  officeShiftDate,
  computeDayMetrics,
  shiftWindow,
} = require('../src/utils/attendanceTime');

// Most of the workforce is on 19:00 -> 03:00. The office is UTC+5, so a punch
// at 19:05 local is 14:05Z the same day, and 03:10 local is 22:10Z the day
// before.
const NIGHT = { shiftStart: '19:00', shiftEnd: '03:00', graceMinutes: 15 };
const DAY = { shiftStart: '09:30', shiftEnd: '18:30', graceMinutes: 15 };

const at = (iso) => new Date(iso);
const dayOf = (d) => d.toISOString().slice(0, 10);

test('shiftWindow recognises a shift that crosses midnight', () => {
  const night = shiftWindow(NIGHT);
  assert.equal(night.crossesMidnight, true);
  assert.equal(night.duration, 480, '19:00 to 03:00 is eight hours');

  const day = shiftWindow(DAY);
  assert.equal(day.crossesMidnight, false);
  assert.equal(day.duration, 540);
});

test('both halves of a night shift land on the same attendance day', () => {
  const clockIn = at('2026-09-01T14:05:00Z');  // 19:05 local, Sep 1
  const clockOut = at('2026-09-01T22:10:00Z'); // 03:10 local, Sep 2

  assert.equal(dayOf(officeShiftDate(clockIn, NIGHT)), '2026-09-01');
  assert.equal(
    dayOf(officeShiftDate(clockOut, NIGHT)),
    '2026-09-01',
    'the 3am punch belongs to the shift that started the previous evening'
  );
});

test('a day shift is still attributed to its calendar date', () => {
  const clockIn = at('2026-09-01T04:35:00Z');  // 09:35 local
  const clockOut = at('2026-09-01T13:35:00Z'); // 18:35 local
  assert.equal(dayOf(officeShiftDate(clockIn, DAY)), '2026-09-01');
  assert.equal(dayOf(officeShiftDate(clockOut, DAY)), '2026-09-01');
});

test('night shift: on time, with overtime past 03:00', () => {
  const m = computeDayMetrics(NIGHT, at('2026-09-01T14:05:00Z'), at('2026-09-01T22:10:00Z'));
  assert.deepEqual(m, { late: 0, earlyDeparture: 0, overtime: 10 });
});

test('night shift: lateness is measured from 19:00, not from midnight', () => {
  const m = computeDayMetrics(NIGHT, at('2026-09-01T14:40:00Z'), null); // 19:40 local
  assert.equal(m.late, 40);
});

test('night shift: arriving inside the grace window is not late', () => {
  const m = computeDayMetrics(NIGHT, at('2026-09-01T14:12:00Z'), null); // 19:12 local
  assert.equal(m.late, 0);
});

test('night shift: leaving at 01:00 is an early departure, not overtime', () => {
  const m = computeDayMetrics(NIGHT, at('2026-09-01T14:05:00Z'), at('2026-09-01T20:00:00Z'));
  assert.equal(m.earlyDeparture, 120);
  assert.equal(m.overtime, 0);
});

test('night shift: leaving 30 minutes in is a large early departure', () => {
  // The old calendar-relative maths scored this as 16 hours of overtime.
  const m = computeDayMetrics(NIGHT, at('2026-09-01T14:05:00Z'), at('2026-09-01T14:30:00Z'));
  assert.equal(m.overtime, 0);
  assert.equal(m.earlyDeparture, 450);
});

test('day shift metrics are unchanged', () => {
  const onTime = computeDayMetrics(DAY, at('2026-09-01T04:35:00Z'), at('2026-09-01T13:30:00Z'));
  assert.deepEqual(onTime, { late: 0, earlyDeparture: 0, overtime: 0 });

  const late = computeDayMetrics(DAY, at('2026-09-01T04:50:00Z'), null); // 09:50 local
  assert.equal(late.late, 20);

  const over = computeDayMetrics(DAY, at('2026-09-01T04:35:00Z'), at('2026-09-01T14:00:00Z'));
  assert.equal(over.overtime, 30);

  const early = computeDayMetrics(DAY, at('2026-09-01T04:35:00Z'), at('2026-09-01T13:00:00Z'));
  assert.equal(early.earlyDeparture, 30);
});

test('a missing check-out leaves overtime and early departure at zero', () => {
  const m = computeDayMetrics(NIGHT, at('2026-09-01T14:05:00Z'), null);
  assert.equal(m.earlyDeparture, 0);
  assert.equal(m.overtime, 0);
});
