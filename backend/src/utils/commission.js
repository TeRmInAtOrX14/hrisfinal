/**
 * Commission maths — the single source of truth for both payroll and the
 * campaign dashboard.
 *
 * These rules previously existed twice, in two different forms. Payroll paid
 * Team Leads a flat PKR amount from a hard-coded ladder keyed on a hard-coded
 * list of campaign names, while the dashboard displayed
 * `totalShowups * slab.rate * 0.1`. The two never agreed, so the "Team
 * Commission" figure a lead saw on their dashboard did not match their payslip.
 * Both call sites now use the functions below.
 *
 * The SDR slab types are also implemented once. 'hybrid' had a magic PKR 2000
 * per-show-up bonus inlined at three separate call sites; it is a named constant
 * here.
 */

const HYBRID_PER_SHOWUP_BONUS = Number(process.env.HYBRID_PER_SHOWUP_BONUS || 2000);

/**
 * Team Lead payout ladder.
 *
 * Thresholds are expressed per team member: a lead clears a rung when the team's
 * total show-ups reach `showupsPerMember * teamSize + 1`. This mirrors the
 * ladder that was hard-coded in payroll.js, kept identical so existing payouts
 * do not change, but now overridable with TEAM_LEAD_COMMISSION_LADDER (JSON).
 */
const DEFAULT_TL_LADDER = [
  { showupsPerMember: 10, payout: 22000 },
  { showupsPerMember: 8, payout: 18000 },
  { showupsPerMember: 6, payout: 14000 },
  { showupsPerMember: 4, payout: 10000 },
];

/**
 * Campaigns the ladder applies to.
 *
 * The ladder is company-wide policy: Team Lead commission is the same on every
 * campaign. '*' means exactly that, so onboarding a campaign needs no change
 * here — which was the point of moving this out of the payroll loop, where it
 * was a literal array and a new campaign meant a code change and a redeploy.
 *
 * It stayed an explicit list for a while, and that quietly cost money: a lead
 * on a campaign missing from the list fell through to the campaign's own slab
 * table and, with no structure configured, earned nothing.
 *
 * Override with TEAM_LEAD_LADDER_CAMPAIGNS (JSON array) to restrict it again.
 * Anything not covered falls back to the campaign's slab table, matched on the
 * team average.
 */
const DEFAULT_TL_CAMPAIGNS = ['*'];

function parseJsonEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : fallback;
  } catch {
    console.warn(`[Commission] ${name} is not valid JSON — using the built-in default.`);
    return fallback;
  }
}

const TL_LADDER = parseJsonEnv('TEAM_LEAD_COMMISSION_LADDER', DEFAULT_TL_LADDER)
  .slice()
  .sort((a, b) => b.showupsPerMember - a.showupsPerMember);

const TL_CAMPAIGNS = parseJsonEnv('TEAM_LEAD_LADDER_CAMPAIGNS', DEFAULT_TL_CAMPAIGNS).map((n) =>
  String(n).toUpperCase()
);

/** The slab covering `showups`, or null when no slab matches. */
function matchSlab(slabs, showups) {
  if (!Array.isArray(slabs) || slabs.length === 0) return null;
  return (
    slabs.find(
      (slab) =>
        showups >= slab.minShowups && (slab.maxShowups === null || showups <= slab.maxShowups)
    ) || null
  );
}

/** Payout for one person against a matched slab. */
function calculateSlabCommission(slab, showups) {
  if (!slab) return 0;

  switch (slab.type) {
    case 'fixed_monthly':
      return slab.rate;
    case 'percentage':
      // Historically a plain multiplier rather than a true percentage; kept as
      // it was so existing structures keep paying the same amount.
      return slab.rate * showups;
    case 'hybrid':
      return slab.rate + showups * HYBRID_PER_SHOWUP_BONUS;
    case 'per_showup':
    default:
      return showups * slab.rate;
  }
}

const pkr = (n) => `PKR ${Math.round(n).toLocaleString('en-PK')}`;

/** Human-readable explanation of a slab payout, for the preview simulator. */
function describeSlabCommission(slab, showups) {
  if (!slab) {
    return `No slab covers ${showups} show-ups, so no commission is payable.`;
  }

  const range = `${slab.minShowups}–${slab.maxShowups ?? '∞'}`;
  const amount = calculateSlabCommission(slab, showups);

  switch (slab.type) {
    case 'fixed_monthly':
      return `Fixed monthly payout for the ${range} band: ${pkr(amount)}.`;
    case 'percentage':
      return `${showups} show-ups × ${slab.rate} (${range} band) = ${pkr(amount)}.`;
    case 'hybrid':
      return `${pkr(slab.rate)} base + ${showups} × ${pkr(HYBRID_PER_SHOWUP_BONUS)} per show-up = ${pkr(amount)}.`;
    case 'per_showup':
    default:
      return `${showups} show-ups × ${pkr(slab.rate)} each = ${pkr(amount)}.`;
  }
}

const LADDER_COVERS_EVERY_CAMPAIGN = TL_CAMPAIGNS.includes('*');

function usesLadder(campaignName) {
  if (LADDER_COVERS_EVERY_CAMPAIGN) return true;
  const name = String(campaignName || '').toUpperCase();
  return name !== '' && TL_CAMPAIGNS.some((target) => name.includes(target));
}

/**
 * Team Lead commission for a month.
 *
 * @param {object}  args
 * @param {string}  args.campaignName
 * @param {number}  args.teamShowups Total show-ups across the lead's SDRs
 * @param {number}  args.teamSize    Number of active SDRs on the campaign
 * @param {Array}   args.slabs       Active structure slabs, for non-ladder campaigns
 */
function calculateTeamLeadCommission({ campaignName, teamShowups, teamSize, slabs = [] }) {
  if (!teamSize || teamSize <= 0) return 0;

  if (usesLadder(campaignName)) {
    const rung = TL_LADDER.find(
      (step) => teamShowups >= step.showupsPerMember * teamSize + 1
    );
    return rung ? rung.payout : 0;
  }

  // Non-ladder campaigns fall back to the campaign's own slab table, matched on
  // the team average and paid on the team total.
  const averageShowups = teamShowups / teamSize;
  const slab = matchSlab(slabs, averageShowups);
  return calculateSlabCommission(slab, teamShowups);
}

/** One-line explanation of how a Team Lead payout was reached. */
function describeTeamLeadCommission({ campaignName, teamShowups, teamSize }) {
  if (!teamSize || teamSize <= 0) return 'No active SDRs on this campaign.';

  if (usesLadder(campaignName)) {
    const rung = TL_LADDER.find((step) => teamShowups >= step.showupsPerMember * teamSize + 1);
    return rung
      ? `Team ladder: ${teamShowups} show-ups clears ${rung.showupsPerMember}×${teamSize}+1 = ${rung.showupsPerMember * teamSize + 1}.`
      : `Team ladder: ${teamShowups} show-ups is below the first rung (${TL_LADDER[TL_LADDER.length - 1].showupsPerMember * teamSize + 1}).`;
  }

  return `Campaign slab table, matched on a team average of ${(teamShowups / teamSize).toFixed(1)} show-ups.`;
}

module.exports = {
  HYBRID_PER_SHOWUP_BONUS,
  TL_LADDER,
  TL_CAMPAIGNS,
  matchSlab,
  calculateSlabCommission,
  describeSlabCommission,
  calculateTeamLeadCommission,
  describeTeamLeadCommission,
  usesLadder,
};
