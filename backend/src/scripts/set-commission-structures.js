require('dotenv').config();

const prisma = require('../lib/prisma');

/**
 * Apply the standard SDR commission structure to every campaign.
 *
 * The bands are company-wide policy rather than per-campaign, so this script
 * is the source of truth for them: run it again after adding a campaign and it
 * fills in the missing one without touching the others.
 *
 * Rates are paid on the SDR's TOTAL show-ups at the band their total lands in,
 * not marginally per band. Three show-ups pay 3 x 3,000; six pay 6 x 4,000,
 * not 3 x 3,000 plus 3 x 4,000. That is what "the applicable commission rate is
 * based on the total number of show-ups achieved within that slab" means, and
 * it is why the top band is open-ended: a tenth show-up pays 5,000 like the
 * ninth.
 *
 * Team Lead commission does NOT come from here. It uses the company ladder in
 * utils/commission.js, which now covers every campaign.
 *
 *   node src/scripts/set-commission-structures.js
 *   node src/scripts/set-commission-structures.js --commit
 */

const STRUCTURE_NAME = 'Standard SDR commission';

const SLABS = [
  { minShowups: 1, maxShowups: 3, rate: 3000, type: 'per_showup' },
  { minShowups: 4, maxShowups: 6, rate: 4000, type: 'per_showup' },
  { minShowups: 7, maxShowups: null, rate: 5000, type: 'per_showup' },
];

const COMMIT = process.argv.includes('--commit');

const pkr = (n) => 'PKR ' + Math.round(n).toLocaleString('en-PK');

async function main() {
  const campaigns = await prisma.campaign.findMany({
    orderBy: { name: 'asc' },
    include: { commissionStructures: { include: { slabs: true } } },
  });

  if (campaigns.length === 0) {
    console.log('No campaigns exist yet — nothing to do.');
    return;
  }

  console.log('\nBands to apply (identical on every campaign):\n');
  SLABS.forEach((s) => {
    const range = s.maxShowups === null ? s.minShowups + '+' : s.minShowups + '-' + s.maxShowups;
    const example = s.maxShowups === null ? s.minShowups + 2 : s.maxShowups;
    console.log(
      '  ' + range.padEnd(6) + ' show-ups   ' + pkr(s.rate).padEnd(12) +
      ' each   (' + example + ' show-ups = ' + pkr(example * s.rate) + ')'
    );
  });
  console.log('');

  const needing = [];
  for (const c of campaigns) {
    const active = c.commissionStructures.filter((s) => s.status === 'active');
    if (active.length > 0) {
      console.log('  ' + c.name.padEnd(24) + 'already has an active structure (' + active[0].slabs.length + ' slabs) — skipping');
    } else {
      needing.push(c);
    }
  }

  if (needing.length === 0) {
    console.log('\nEvery campaign already has an active structure. Nothing to do.');
    return;
  }

  console.log('\n' + needing.length + ' campaign(s) need a structure: ' + needing.map((c) => c.name).join(', '));

  if (!COMMIT) {
    console.log('\nDRY RUN — nothing written. Re-run with --commit to apply.');
    return;
  }

  for (const c of needing) {
    await prisma.commissionStructure.create({
      data: {
        campaignId: c.id,
        name: STRUCTURE_NAME,
        status: 'active',
        slabs: { create: SLABS },
      },
    });
    console.log('  created structure for ' + c.name);
  }

  console.log('\nDone. ' + needing.length + ' structure(s) created and active.');
}

main()
  .catch((err) => {
    console.error('\nFailed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
