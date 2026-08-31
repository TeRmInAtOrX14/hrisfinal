const test = require('node:test');
const assert = require('node:assert/strict');

const {
  matchSlab,
  calculateSlabCommission,
  calculateTeamLeadCommission,
  usesLadder,
  HYBRID_PER_SHOWUP_BONUS,
} = require('../src/utils/commission');

const SLABS = [
  { minShowups: 0, maxShowups: 9, type: 'per_showup', rate: 1000 },
  { minShowups: 10, maxShowups: 19, type: 'per_showup', rate: 1500 },
  { minShowups: 20, maxShowups: null, type: 'fixed_monthly', rate: 40000 },
];

test('matchSlab picks the band containing the show-up count', () => {
  assert.equal(matchSlab(SLABS, 5).rate, 1000);
  assert.equal(matchSlab(SLABS, 10).rate, 1500);
  assert.equal(matchSlab(SLABS, 19).rate, 1500);
  assert.equal(matchSlab(SLABS, 20).rate, 40000, 'an open-ended band has maxShowups null');
  assert.equal(matchSlab(SLABS, 999).rate, 40000);
});

test('matchSlab returns null when nothing covers the count', () => {
  assert.equal(matchSlab([], 5), null);
  assert.equal(matchSlab(null, 5), null);
  assert.equal(matchSlab([{ minShowups: 50, maxShowups: 60 }], 5), null);
});

test('slab payouts follow the slab type', () => {
  assert.equal(calculateSlabCommission({ type: 'per_showup', rate: 1000 }, 7), 7000);
  assert.equal(calculateSlabCommission({ type: 'fixed_monthly', rate: 40000 }, 99), 40000);
  assert.equal(calculateSlabCommission({ type: 'percentage', rate: 250 }, 8), 2000);
  assert.equal(
    calculateSlabCommission({ type: 'hybrid', rate: 15000 }, 6),
    15000 + 6 * HYBRID_PER_SHOWUP_BONUS
  );
});

test('an unmatched slab pays nothing', () => {
  assert.equal(calculateSlabCommission(null, 25), 0);
});

test('the Team Lead ladder is company-wide, so it covers every campaign', () => {
  // It used to be an explicit list, and a lead on a campaign missing from it
  // silently earned nothing.
  for (const name of ['LVGL', 'Logics', 'Patient Wing', 'Kloudlyn', 'Creaform 3D', 'Kline AI']) {
    assert.equal(usesLadder(name), true, name + ' should use the ladder');
  }
});

// The SDR bands as configured by set-commission-structures.js. Rates are paid
// on the total show-ups at whichever band the total lands in, not marginally.
const SDR_BANDS = [
  { minShowups: 1, maxShowups: 3, rate: 3000, type: 'per_showup' },
  { minShowups: 4, maxShowups: 6, rate: 4000, type: 'per_showup' },
  { minShowups: 7, maxShowups: null, rate: 5000, type: 'per_showup' },
];

const sdrPayout = (showups) =>
  calculateSlabCommission(matchSlab(SDR_BANDS, showups), showups);

test('SDR commission pays the band rate on the whole total', () => {
  assert.equal(sdrPayout(3), 9000, '3 x 3,000');
  assert.equal(sdrPayout(6), 24000, '6 x 4,000');
  assert.equal(sdrPayout(9), 45000, '9 x 5,000');
});

test('SDR band boundaries land on the right rate', () => {
  assert.equal(sdrPayout(1), 3000);
  assert.equal(sdrPayout(4), 16000, 'first show-up of the middle band pays 4,000 on all four');
  assert.equal(sdrPayout(7), 35000, 'first show-up of the top band pays 5,000 on all seven');
});

test('crossing into a band raises the rate on every show-up, not just the new one', () => {
  // The jump from 3 to 4 is worth more than one show-up at the old rate.
  assert.equal(sdrPayout(4) - sdrPayout(3), 7000);
});

test('beyond the top band each additional show-up still pays 5,000', () => {
  assert.equal(sdrPayout(10), 50000);
  assert.equal(sdrPayout(20), 100000);
  assert.equal(sdrPayout(15) - sdrPayout(14), 5000);
});

test('no show-ups means no SDR commission', () => {
  assert.equal(sdrPayout(0), 0);
});

test('the Team Lead ladder pays on show-ups per member, plus one', () => {
  const lvgl = (teamShowups, teamSize) =>
    calculateTeamLeadCommission({ campaignName: 'LVGL', teamShowups, teamSize });

  // A team of 5 clears the top rung at 10*5+1 = 51.
  assert.equal(lvgl(51, 5), 22000);
  assert.equal(lvgl(50, 5), 18000, 'falls to the 8-per-member rung at 8*5+1 = 41');
  assert.equal(lvgl(41, 5), 18000);
  assert.equal(lvgl(40, 5), 14000, '6*5+1 = 31');
  assert.equal(lvgl(21, 5), 10000, '4*5+1 = 21');
  assert.equal(lvgl(20, 5), 0, 'below the first rung');
});

test('no team means no Team Lead commission', () => {
  assert.equal(calculateTeamLeadCommission({ campaignName: 'LVGL', teamShowups: 100, teamSize: 0 }), 0);
});

// The fallback to a campaign's own slab table only applies when the ladder has
// been restricted, so it is covered in commission-restricted-ladder.test.js,
// which sets the override before loading the module.
