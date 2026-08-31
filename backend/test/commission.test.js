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

test('ladder campaigns are matched case-insensitively, including compound names', () => {
  assert.equal(usesLadder('LVGL'), true);
  assert.equal(usesLadder('lvgl'), true);
  assert.equal(usesLadder('Logics and Patient Wing'), true);
  assert.equal(usesLadder('Creaform 3D'), false);
  assert.equal(usesLadder(''), false);
  assert.equal(usesLadder(null), false);
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

test('non-ladder campaigns use the campaign slab table on the team average', () => {
  // Average of 12 lands in the 10-19 band at 1500, paid on the team total.
  const payout = calculateTeamLeadCommission({
    campaignName: 'Creaform 3D',
    teamShowups: 48,
    teamSize: 4,
    slabs: SLABS,
  });
  assert.equal(payout, 48 * 1500);
});
