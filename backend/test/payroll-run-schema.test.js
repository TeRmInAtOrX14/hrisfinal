const test = require('node:test');
const assert = require('node:assert/strict');

const schemas = require('../src/schemas');

const ID = '11111111-1111-4111-8111-111111111111';
const period = { month: 8, year: 2026 };

// The run modal posts a row for EVERY employee. A blank field must mean "use
// the logged CampaignPerformance figure", never "override with 0" — the
// default-0 override is exactly what paid commission on zero show-ups.
test('payroll run: blank or null metrics are "not supplied", not 0', () => {
  const parsed = schemas.payroll.run.parse({
    ...period,
    performance: [
      { employeeId: ID, showups: null, meetingsScheduled: '', noShows: null, bonus: '', otherDeductions: null },
    ],
  });
  const row = parsed.performance[0];
  assert.equal(row.showups, undefined);
  assert.equal(row.meetingsScheduled, undefined);
  assert.equal(row.noShows, undefined);
  assert.equal(row.bonus, undefined);
  assert.equal(row.otherDeductions, undefined);
  // runPayroll merges with `override ?? stored`; undefined must fall through.
  assert.equal(row.showups ?? 9, 9);
});

test('payroll run: a deliberate 0 and a real number are overrides', () => {
  const parsed = schemas.payroll.run.parse({
    ...period,
    performance: [{ employeeId: ID, showups: 0, meetingsScheduled: '12', bonus: 2500.5 }],
  });
  const row = parsed.performance[0];
  assert.equal(row.showups, 0);
  assert.equal(row.showups ?? 9, 0, 'an explicit 0 must NOT fall through to the stored value');
  assert.equal(row.meetingsScheduled, 12);
  assert.equal(row.bonus, 2500.5);
});

test('payroll run: counts must be whole and non-negative', () => {
  const run = (row) => schemas.payroll.run.safeParse({ ...period, performance: [{ employeeId: ID, ...row }] });
  assert.equal(run({ showups: 5.5 }).success, false);
  assert.equal(run({ showups: -1 }).success, false);
  assert.equal(run({ showups: 5 }).success, true);
});

test('commission structure: omitting slabs leaves them undefined, not []', () => {
  const rename = schemas.campaign.structure.parse({ name: 'Renamed' });
  assert.equal(rename.slabs, undefined, 'a default of [] let a rename wipe a live structure');

  const explicit = schemas.campaign.structure.parse({ name: 'x', slabs: [] });
  assert.deepEqual(explicit.slabs, []);
});
