/**
 * Role vocabulary, shared by the router, the sidebar and every page.
 *
 * These arrays were previously written out inline at a dozen call sites and had
 * drifted: the sidebar showed "Employees" to Employee but not SDR even though
 * the API treats both identically, and Campaigns was admin-only in the sidebar
 * while the route itself was open to anyone who typed the URL.
 */
export const ADMIN_ROLES = ['Admin', 'CEO', 'COO'];
export const TEAM_LEAD = 'Team Lead';
export const SELF_ONLY_ROLES = ['Employee', 'SDR'];
export const ALL_ROLES = [...ADMIN_ROLES, TEAM_LEAD, ...SELF_ONLY_ROLES];

export const isAdmin = (user) => ADMIN_ROLES.includes(user?.role);
export const isTeamLead = (user) => user?.role === TEAM_LEAD;
export const isSelfOnly = (user) => SELF_ONLY_ROLES.includes(user?.role);

/** Can this user approve leave / WFH / half-day / loan requests? */
export const canReview = (user) => isAdmin(user);
