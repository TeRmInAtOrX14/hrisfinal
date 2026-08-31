const test = require('node:test');
const assert = require('node:assert/strict');

// TEAM_LEAD_LADDER_CAMPAIGNS is read once when the module loads, so this must
// be set before the require below. `node --test` gives each file its own
// process, which is what makes that safe.
process.env.TEAM_LEAD_LADDER_CAMPAIGNS = JSON.stringify(['LVGL']);

const {
  calculateTeamLeadCommission,
  usesLadder,
} = require('../src/utils/commission');

const SLABS = [
  { minShowups: 0, maxShowups: 9, type: 'per_showup', rate: 1000 },
  { minShowups: 10, maxShowups: 19, type: 'per_showup', rate: 1500 },
  { minShowups: 20, maxShowups: null, type: 'fixed_monthly', rate: 40000 },
];

test('the ladder can still be restricted to named campaigns', () => {
  assert.equal(usesLadder('LVGL'), true);
  assert.equal(usesLadder('Creaform 3D'), false);
  assert.equal(usesLadder(''), false);
  assert.equal(usesLadder(null), false);
});

test('a restricted campaign falls back to its own slab table, on the team average', () => {
  // Average of 12 lands in the 10-19 band at 1,500, paid on the team total.
  const payout = calculateTeamLeadCommission({
    campaignName: 'Creaform 3D',
    teamShowups: 48,
    teamSize: 4,
    slabs: SLABS,
  });
  assert.equal(payout, 48 * 1500);
});

test('a restricted campaign with no slab table pays nothing', () => {
  // This is the trap that made covering every campaign the default: a lead on
  // a campaign outside the list, with no structure configured, earned zero.
  const payout = calculateTeamLeadCommission({
    campaignName: 'Kline AI',
    teamShowups: 100,
    teamSize: 3,
    slabs: [],
  });
  assert.equal(payout, 0);
});

test('a listed campaign still uses the ladder', () => {
  assert.equal(
    calculateTeamLeadCommission({ campaignName: 'LVGL', teamShowups: 51, teamSize: 5 }),
    22000
  );
});
