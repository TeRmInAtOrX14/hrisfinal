const prisma = require('../lib/prisma');
const { logAudit } = require('../utils/audit');
const { isAdmin, visibleCampaignIds } = require('../utils/scope');
const {
  calculateSlabCommission,
  describeSlabCommission,
  matchSlab,
  calculateTeamLeadCommission,
  describeTeamLeadCommission,
} = require('../utils/commission');

/**
 * Campaigns, membership and commission structures.
 *
 * Two classes of problem are fixed here:
 *
 *  - Read access. Every campaign endpoint was `requireAuth` only, so any SDR
 *    could list all campaigns with their members and full commission slab
 *    tables, and open any other team's dashboard. Reads are now scoped to the
 *    campaigns the caller belongs to.
 *
 *  - Role clobbering. assignMember/unassignMember/toggleMemberStatus rewrote
 *    User.role from the campaign role, so adding an Admin to a campaign demoted
 *    them to 'Team Lead' and removing them demoted them to 'Employee' — an
 *    admin could lock themselves out of the admin UI by tidying up a campaign.
 *    Campaign membership no longer touches the account role at all; the role is
 *    managed on the employee record.
 */

const MEMBER_INCLUDE = {
  members: {
    where: { status: 'active' },
    include: {
      employee: { select: { id: true, fullName: true, employeeCode: true, designation: true } },
    },
  },
};

// ---------------------------------------------------------------------------
// Campaigns CRUD
// ---------------------------------------------------------------------------

exports.getCampaigns = async (req, res, next) => {
  try {
    const allowedIds = await visibleCampaignIds(req.user);

    const where = allowedIds === null ? {} : { id: { in: allowedIds } };

    // Commission structures are compensation data. Admins see the full slab
    // tables; everyone else sees only the campaigns they are on, and only the
    // active structure that actually governs their pay.
    const campaigns = await prisma.campaign.findMany({
      where,
      include: {
        ...MEMBER_INCLUDE,
        commissionStructures: {
          where: allowedIds === null ? {} : { status: 'active' },
          include: { slabs: { orderBy: { minShowups: 'asc' } } },
        },
      },
      orderBy: { name: 'asc' },
    });

    res.json(campaigns);
  } catch (err) {
    next(err);
  }
};

exports.createCampaign = async (req, res, next) => {
  try {
    const { name, description, startDate, endDate, notes, monthlyShowupTarget, teamLeadId, sdrIds } =
      req.body;

    const duplicate = await prisma.campaign.findUnique({ where: { name } });
    if (duplicate) {
      return res.status(409).json({ error: 'A campaign with this name already exists.' });
    }

    const campaign = await prisma.$transaction(async (tx) => {
      const camp = await tx.campaign.create({
        data: {
          name,
          description,
          status: 'active',
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
          monthlyShowupTarget: monthlyShowupTarget ?? 0,
          notes,
        },
      });

      const assignments = [
        ...(teamLeadId ? [{ employeeId: teamLeadId, role: 'team_lead' }] : []),
        ...sdrIds.filter(Boolean).map((employeeId) => ({ employeeId, role: 'sdr' })),
      ];

      for (const { employeeId, role } of assignments) {
        // One active campaign per employee.
        await tx.campaignMember.updateMany({
          where: { employeeId, status: 'active' },
          data: { status: 'inactive' },
        });
        await tx.campaignMember.upsert({
          where: { campaignId_employeeId: { campaignId: camp.id, employeeId } },
          create: { campaignId: camp.id, employeeId, role, status: 'active' },
          update: { role, status: 'active' },
        });
      }

      return camp;
    });

    await logAudit(req.user.id, 'CREATE_CAMPAIGN', 'Campaign', campaign.id, { name });
    res.status(201).json(campaign);
  } catch (err) {
    next(err);
  }
};

exports.updateCampaign = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const existing = await prisma.campaign.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Only write what was actually sent. The old handler always assigned
    // startDate/endDate, so editing just the name wiped both dates to null.
    const data = {};
    for (const key of ['name', 'description', 'status', 'notes', 'monthlyShowupTarget']) {
      if (updates[key] !== undefined) data[key] = updates[key];
    }
    if (updates.startDate !== undefined) {
      data.startDate = updates.startDate ? new Date(updates.startDate) : null;
    }
    if (updates.endDate !== undefined) {
      data.endDate = updates.endDate ? new Date(updates.endDate) : null;
    }

    const campaign = await prisma.campaign.update({ where: { id }, data });

    await logAudit(req.user.id, 'UPDATE_CAMPAIGN', 'Campaign', id, data);
    res.json(campaign);
  } catch (err) {
    next(err);
  }
};

exports.deleteCampaign = async (req, res, next) => {
  try {
    const { id } = req.params;

    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: { _count: { select: { performances: true, members: true } } },
    });

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Deleting cascades to members, structures and logged performance. Once
    // performance exists it is payroll evidence, so archive instead of destroy.
    if (campaign._count.performances > 0) {
      return res.status(409).json({
        error:
          'This campaign has logged performance history and cannot be deleted. Set its status to archived instead.',
      });
    }

    await prisma.campaign.delete({ where: { id } });

    await logAudit(req.user.id, 'DELETE_CAMPAIGN', 'Campaign', id, { name: campaign.name });
    res.json({ message: 'Campaign deleted successfully' });
  } catch (err) {
    next(err);
  }
};

exports.duplicateCampaign = async (req, res, next) => {
  try {
    const { id } = req.params;

    const source = await prisma.campaign.findUnique({
      where: { id },
      include: { commissionStructures: { include: { slabs: true } } },
    });

    if (!source) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Names are unique. The old version appended Date.now(), producing
    // "Cleo HR (Copy) - 1756412355128"; find the next free "(Copy N)" instead.
    let name = `${source.name} (Copy)`;
    for (let n = 2; await prisma.campaign.findUnique({ where: { name } }); n++) {
      name = `${source.name} (Copy ${n})`;
    }

    const newCampaign = await prisma.$transaction(async (tx) => {
      const camp = await tx.campaign.create({
        data: {
          name,
          description: source.description,
          status: 'active',
          startDate: source.startDate,
          endDate: source.endDate,
          monthlyShowupTarget: source.monthlyShowupTarget,
          notes: source.notes,
        },
      });

      for (const structure of source.commissionStructures) {
        await tx.commissionStructure.create({
          data: {
            campaignId: camp.id,
            name: structure.name,
            status: 'draft',
            startDate: structure.startDate,
            endDate: structure.endDate,
            slabs: {
              create: structure.slabs.map((s) => ({
                minShowups: s.minShowups,
                maxShowups: s.maxShowups,
                rate: s.rate,
                type: s.type,
              })),
            },
          },
        });
      }

      return camp;
    });

    await logAudit(req.user.id, 'DUPLICATE_CAMPAIGN', 'Campaign', newCampaign.id, { sourceId: id });
    res.status(201).json(newCampaign);
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

exports.assignMember = async (req, res, next) => {
  try {
    const { id: campaignId } = req.params;
    const { employeeId, role } = req.body;

    const [campaign, employee] = await Promise.all([
      prisma.campaign.findUnique({ where: { id: campaignId } }),
      prisma.employee.findUnique({ where: { id: employeeId } }),
    ]);

    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const member = await prisma.$transaction(async (tx) => {
      // Business rule: one active campaign per employee.
      await tx.campaignMember.updateMany({
        where: { employeeId, status: 'active', campaignId: { not: campaignId } },
        data: { status: 'inactive' },
      });

      return tx.campaignMember.upsert({
        where: { campaignId_employeeId: { campaignId, employeeId } },
        create: { campaignId, employeeId, role, status: 'active' },
        update: { role, status: 'active' },
      });
    });

    await logAudit(req.user.id, 'ASSIGN_CAMPAIGN_MEMBER', 'CampaignMember', member.id, {
      campaignId,
      employeeId,
      role,
    });
    res.json(member);
  } catch (err) {
    next(err);
  }
};

exports.unassignMember = async (req, res, next) => {
  try {
    const { id: campaignId, employeeId } = req.params;

    const member = await prisma.campaignMember.findUnique({
      where: { campaignId_employeeId: { campaignId, employeeId } },
    });

    if (!member) {
      return res.status(404).json({ error: 'This employee is not assigned to that campaign.' });
    }

    await prisma.campaignMember.delete({
      where: { campaignId_employeeId: { campaignId, employeeId } },
    });

    await logAudit(req.user.id, 'UNASSIGN_CAMPAIGN_MEMBER', 'CampaignMember', member.id, {
      campaignId,
      employeeId,
    });
    res.json({ message: 'Employee unassigned from campaign successfully' });
  } catch (err) {
    next(err);
  }
};

exports.toggleMemberStatus = async (req, res, next) => {
  try {
    const { id: campaignId, employeeId } = req.params;
    const { status } = req.body;

    const existing = await prisma.campaignMember.findUnique({
      where: { campaignId_employeeId: { campaignId, employeeId } },
    });

    if (!existing) {
      return res.status(404).json({ error: 'This employee is not assigned to that campaign.' });
    }

    const member = await prisma.campaignMember.update({
      where: { campaignId_employeeId: { campaignId, employeeId } },
      data: { status },
    });

    await logAudit(req.user.id, 'TOGGLE_MEMBER_STATUS', 'CampaignMember', member.id, { status });
    res.json(member);
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Commission structures
// ---------------------------------------------------------------------------

/**
 * Reject overlapping or contradictory slab ranges before they can silently
 * change someone's pay. Two slabs overlap when each starts at or before the
 * other ends, treating a null max as infinity.
 */
function validateSlabs(slabs) {
  for (let i = 0; i < slabs.length; i++) {
    const a = slabs[i];
    const aMax = a.maxShowups ?? Infinity;

    if (a.minShowups > aMax) {
      return `Slab minimum (${a.minShowups}) cannot exceed its maximum (${a.maxShowups}).`;
    }

    for (let j = i + 1; j < slabs.length; j++) {
      const b = slabs[j];
      const bMax = b.maxShowups ?? Infinity;

      if (a.minShowups <= bMax && b.minShowups <= aMax) {
        return `Overlapping slab ranges: [${a.minShowups}-${a.maxShowups ?? '∞'}] and [${b.minShowups}-${b.maxShowups ?? '∞'}].`;
      }
    }
  }
  return null;
}

/** A caller may read a campaign's structures only if they can see the campaign. */
async function assertCampaignVisible(user, campaignId, res) {
  const allowed = await visibleCampaignIds(user);
  if (allowed === null || allowed.includes(campaignId)) return true;
  res.status(403).json({ error: 'Access denied.' });
  return false;
}

exports.getStructures = async (req, res, next) => {
  try {
    const { campaignId } = req.params;

    if (!(await assertCampaignVisible(req.user, campaignId, res))) return;

    const structures = await prisma.commissionStructure.findMany({
      // Non-admins only ever see the structure their pay is actually computed
      // from, never drafts being negotiated.
      where: isAdmin(req.user) ? { campaignId } : { campaignId, status: 'active' },
      include: { slabs: { orderBy: { minShowups: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });

    res.json(structures);
  } catch (err) {
    next(err);
  }
};

exports.createStructure = async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    const { name, startDate, endDate, slabs } = req.body;

    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const validationError = validateSlabs(slabs);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const structure = await prisma.commissionStructure.create({
      data: {
        campaignId,
        name,
        status: 'draft',
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        slabs: { create: slabs },
      },
      include: { slabs: { orderBy: { minShowups: 'asc' } } },
    });

    await logAudit(req.user.id, 'CREATE_COMMISSION_STRUCTURE', 'CommissionStructure', structure.id, {
      campaignId,
      name,
      slabCount: slabs.length,
    });
    res.status(201).json(structure);
  } catch (err) {
    next(err);
  }
};

exports.updateStructure = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, status, startDate, endDate, slabs } = req.body;

    const existing = await prisma.commissionStructure.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Commission structure not found' });
    }

    const validationError = validateSlabs(slabs);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.commissionSlab.deleteMany({ where: { structureId: id } });

      const data = { slabs: { create: slabs } };
      if (name !== undefined) data.name = name;
      if (status !== undefined) data.status = status;
      if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
      if (endDate !== undefined) data.endDate = endDate ? new Date(endDate) : null;

      return tx.commissionStructure.update({
        where: { id },
        data,
        include: { slabs: { orderBy: { minShowups: 'asc' } } },
      });
    });

    await logAudit(req.user.id, 'UPDATE_COMMISSION_STRUCTURE', 'CommissionStructure', id, {
      slabCount: slabs.length,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
};

exports.deleteStructure = async (req, res, next) => {
  try {
    const { id } = req.params;

    const structure = await prisma.commissionStructure.findUnique({ where: { id } });
    if (!structure) {
      return res.status(404).json({ error: 'Commission structure not found' });
    }

    if (structure.status === 'active') {
      return res.status(409).json({
        error: 'The active commission structure cannot be deleted. Activate another one first.',
      });
    }

    await prisma.commissionStructure.delete({ where: { id } });

    await logAudit(req.user.id, 'DELETE_COMMISSION_STRUCTURE', 'CommissionStructure', id);
    res.json({ message: 'Commission structure deleted successfully' });
  } catch (err) {
    next(err);
  }
};

exports.activateStructure = async (req, res, next) => {
  try {
    const { id } = req.params;

    const structure = await prisma.commissionStructure.findUnique({
      where: { id },
      include: { slabs: true },
    });

    if (!structure) {
      return res.status(404).json({ error: 'Commission structure not found' });
    }

    if (structure.slabs.length === 0) {
      return res.status(400).json({
        error: 'This structure has no slabs, so activating it would pay zero commission.',
      });
    }

    await prisma.$transaction([
      prisma.commissionStructure.updateMany({
        where: { campaignId: structure.campaignId, id: { not: id } },
        data: { status: 'archived' },
      }),
      prisma.commissionStructure.update({ where: { id }, data: { status: 'active' } }),
    ]);

    await logAudit(req.user.id, 'ACTIVATE_COMMISSION_STRUCTURE', 'CommissionStructure', id, {
      campaignId: structure.campaignId,
    });
    res.json({ message: 'Commission structure activated' });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Preview simulator
// ---------------------------------------------------------------------------

exports.previewCommission = async (req, res, next) => {
  try {
    const { campaignId, showups } = req.body;

    if (!(await assertCampaignVisible(req.user, campaignId, res))) return;

    const structure = await prisma.commissionStructure.findFirst({
      where: { campaignId, status: 'active' },
      include: { slabs: { orderBy: { minShowups: 'asc' } } },
    });

    if (!structure) {
      return res
        .status(404)
        .json({ error: 'No active commission structure is configured for this campaign.' });
    }

    const slab = matchSlab(structure.slabs, showups);

    res.json({
      campaignId,
      showups,
      structureName: structure.name,
      slabMatched: slab
        ? { min: slab.minShowups, max: slab.maxShowups, rate: slab.rate, type: slab.type }
        : null,
      calculatedCommission: calculateSlabCommission(slab, showups),
      formulaExplanation: describeSlabCommission(slab, showups),
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Dashboard & performance
// ---------------------------------------------------------------------------

exports.getCampaignDashboard = async (req, res, next) => {
  try {
    const { id } = req.params;
    const now = new Date();
    const month = Number(req.query.month) || now.getMonth() + 1;
    const year = Number(req.query.year) || now.getFullYear();

    if (!(await assertCampaignVisible(req.user, id, res))) return;

    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        ...MEMBER_INCLUDE,
        commissionStructures: {
          where: { status: 'active' },
          include: { slabs: { orderBy: { minShowups: 'asc' } } },
        },
      },
    });

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const performances = await prisma.campaignPerformance.findMany({
      where: { campaignId: id, month, year },
      include: { employee: { select: { fullName: true, employeeCode: true } } },
    });

    const perfByEmployee = new Map(performances.map((p) => [p.employeeId, p]));
    const activeStructure = campaign.commissionStructures[0] || null;
    const slabs = activeStructure?.slabs || [];

    const teamLeadMember = campaign.members.find((m) => m.role === 'team_lead');
    const sdrs = campaign.members.filter((m) => m.role === 'sdr');

    const stats = {
      meetingsBooked: 0,
      showups: 0,
      noShows: 0,
      cancelledMeetings: 0,
    };

    const leaderboard = sdrs.map((member) => {
      const perf = perfByEmployee.get(member.employee.id);
      const row = {
        meetingsBooked: perf?.meetingsBooked || 0,
        showups: perf?.showups || 0,
        noShows: perf?.noShows || 0,
        cancelledMeetings: perf?.cancelledMeetings || 0,
      };

      stats.meetingsBooked += row.meetingsBooked;
      stats.showups += row.showups;
      stats.noShows += row.noShows;
      stats.cancelledMeetings += row.cancelledMeetings;

      return {
        employeeId: member.employee.id,
        fullName: member.employee.fullName,
        code: member.employee.employeeCode,
        ...row,
        commissionEarned: calculateSlabCommission(matchSlab(slabs, row.showups), row.showups),
      };
    });

    leaderboard.sort((a, b) => b.showups - a.showups);

    const sdrCommission = leaderboard.reduce((sum, row) => sum + row.commissionEarned, 0);

    // The dashboard previously invented its own Team Lead formula
    // (totalShowups * slab.rate * 0.1) while payroll used a completely different
    // one, so the figure shown here never matched the payslip. Both now call the
    // same helper.
    const teamLeadCommission = teamLeadMember
      ? calculateTeamLeadCommission({
          campaignName: campaign.name,
          teamShowups: stats.showups,
          teamSize: sdrs.length,
          slabs,
        })
      : 0;

    res.json({
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        teamLead: teamLeadMember?.employee.fullName || 'No Lead Assigned',
        teamLeadId: teamLeadMember?.employee.id || null,
        totalSdrs: sdrs.length,
        monthlyShowupTarget: campaign.monthlyShowupTarget,
        // The SDR dashboard reads its slab table from here; it used to look for
        // `campaign.commissionStructures`, which this endpoint never returned,
        // so the "matched commission slab" panel was permanently empty.
        activeStructure: activeStructure
          ? { id: activeStructure.id, name: activeStructure.name, slabs }
          : null,
      },
      period: { month, year },
      stats: {
        ...stats,
        conversionRate:
          stats.meetingsBooked > 0
            ? Number(((stats.showups / stats.meetingsBooked) * 100).toFixed(1))
            : 0,
        sdrCommission,
        teamLeadCommission,
        commissionPaid: sdrCommission + teamLeadCommission,
        teamLeadCommissionBasis: describeTeamLeadCommission({
          campaignName: campaign.name,
          teamShowups: stats.showups,
          teamSize: sdrs.length,
        }),
      },
      leaderboard,
      recentActivity: performances
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 10)
        .map((p) => ({
          timestamp: p.updatedAt,
          message: `${p.employee.fullName} — ${p.showups} show-ups, ${p.noShows} no-shows`,
        })),
    });
  } catch (err) {
    next(err);
  }
};

exports.logPerformance = async (req, res, next) => {
  try {
    const { employeeId, campaignId, month, year, ...metrics } = req.body;

    const member = await prisma.campaignMember.findUnique({
      where: { campaignId_employeeId: { campaignId, employeeId } },
    });

    if (!member) {
      return res
        .status(400)
        .json({ error: 'That employee is not a member of this campaign.' });
    }

    const performance = await prisma.campaignPerformance.upsert({
      where: {
        employeeId_campaignId_month_year: { employeeId, campaignId, month, year },
      },
      create: {
        employeeId,
        campaignId,
        month,
        year,
        meetingsBooked: metrics.meetingsBooked ?? 0,
        showups: metrics.showups ?? 0,
        noShows: metrics.noShows ?? 0,
        cancelledMeetings: metrics.cancelledMeetings ?? 0,
      },
      update: {
        meetingsBooked: metrics.meetingsBooked,
        showups: metrics.showups,
        noShows: metrics.noShows,
        cancelledMeetings: metrics.cancelledMeetings,
      },
    });

    await logAudit(req.user.id, 'LOG_CAMPAIGN_PERFORMANCE', 'CampaignPerformance', performance.id, {
      employeeId,
      campaignId,
      month,
      year,
    });
    res.json(performance);
  } catch (err) {
    next(err);
  }
};

module.exports.validateSlabs = validateSlabs;
