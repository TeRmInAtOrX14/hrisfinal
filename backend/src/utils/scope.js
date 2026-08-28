const prisma = require('../lib/prisma');

const ADMIN_ROLES = ['Admin', 'CEO', 'COO'];
const SELF_ONLY_ROLES = ['Employee', 'SDR'];

const isAdmin = (user) => ADMIN_ROLES.includes(user.role);
const isTeamLead = (user) => user.role === 'Team Lead';
const isSelfOnly = (user) => SELF_ONLY_ROLES.includes(user.role);

/** Campaign ids where this employee is an active team lead. */
async function ledCampaignIds(leadEmployeeId) {
  if (!leadEmployeeId) return [];
  const rows = await prisma.campaignMember.findMany({
    where: { employeeId: leadEmployeeId, role: 'team_lead', status: 'active' },
    select: { campaignId: true },
  });
  return rows.map((r) => r.campaignId);
}

/**
 * Employee ids a Team Lead may see: every active member of the campaigns they
 * lead, plus themselves.
 *
 * The four controllers that needed this each carried their own copy, and two of
 * them forgot to include the lead's own id — a Team Lead could not see their own
 * leave requests.
 */
async function teamScopeEmployeeIds(leadEmployeeId) {
  const campaignIds = await ledCampaignIds(leadEmployeeId);

  const members = campaignIds.length
    ? await prisma.campaignMember.findMany({
        where: { campaignId: { in: campaignIds }, status: 'active' },
        select: { employeeId: true },
      })
    : [];

  const ids = new Set(members.map((m) => m.employeeId));
  if (leadEmployeeId) ids.add(leadEmployeeId);
  return [...ids];
}

/**
 * Build the `where.employeeId` clause for a list endpoint, honouring the
 * caller's role and an optional explicit `employeeId` filter.
 *
 * Returns `{ ok: false, error }` when the caller asked for someone they may not
 * see, so callers can respond with 403 instead of silently widening the result.
 */
async function resolveEmployeeFilter(user, requestedEmployeeId) {
  if (isSelfOnly(user)) {
    if (!user.employee) {
      return { ok: false, status: 400, error: 'No employee profile is linked to your account.' };
    }
    if (requestedEmployeeId && requestedEmployeeId !== user.employee.id) {
      return { ok: false, status: 403, error: 'Access denied.' };
    }
    return { ok: true, filter: user.employee.id };
  }

  if (isTeamLead(user)) {
    if (!user.employee) {
      return { ok: false, status: 400, error: 'No employee profile is linked to your account.' };
    }
    const allowed = await teamScopeEmployeeIds(user.employee.id);
    if (requestedEmployeeId) {
      if (!allowed.includes(requestedEmployeeId)) {
        return { ok: false, status: 403, error: 'Access denied.' };
      }
      return { ok: true, filter: requestedEmployeeId };
    }
    return { ok: true, filter: { in: allowed } };
  }

  // Admin / CEO / COO
  return { ok: true, filter: requestedEmployeeId || undefined };
}

/** True when `user` is allowed to read the given employee's record. */
async function canAccessEmployee(user, employeeId) {
  if (isAdmin(user)) return true;
  if (!user.employee) return false;
  if (user.employee.id === employeeId) return true;
  if (!isTeamLead(user)) return false;

  const allowed = await teamScopeEmployeeIds(user.employee.id);
  return allowed.includes(employeeId);
}

/** Campaign ids the caller may read. `null` means "no restriction" (admins). */
async function visibleCampaignIds(user) {
  if (isAdmin(user)) return null;
  if (!user.employee) return [];

  const rows = await prisma.campaignMember.findMany({
    where: { employeeId: user.employee.id, status: 'active' },
    select: { campaignId: true },
  });
  return rows.map((r) => r.campaignId);
}

module.exports = {
  ADMIN_ROLES,
  SELF_ONLY_ROLES,
  isAdmin,
  isTeamLead,
  isSelfOnly,
  ledCampaignIds,
  teamScopeEmployeeIds,
  resolveEmployeeFilter,
  canAccessEmployee,
  visibleCampaignIds,
};
