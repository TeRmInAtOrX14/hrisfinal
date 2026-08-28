/**
 * End-to-end smoke test.
 *
 * Boots the API on a spare port, exercises auth, RBAC, attendance, requests,
 * payroll and the audit trail against the configured database, then removes
 * everything it created. Run with:  npm run smoke
 *
 * Safe against a populated database: every record is namespaced with a unique
 * run tag and deleted in the finally block.
 */
process.env.NODE_ENV = 'development';
process.env.PORT = process.env.SMOKE_PORT || '4517';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');

const BASE = `http://127.0.0.1:${process.env.PORT}/api`;
const TAG = `SMOKE${Date.now().toString().slice(-6)}`;

let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ' -> ' + detail : ''}`);
  }
}

async function api(method, endpoint, { token, body } = {}) {
  const res = await fetch(BASE + endpoint, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = text.slice(0, 200);
  }
  return { status: res.status, data };
}

const created = { users: [], employees: [], campaigns: [] };

async function seedAdmin() {
  const hash = await bcrypt.hash('AdminPass123', 10);
  const user = await prisma.user.create({
    data: {
      email: `${TAG.toLowerCase()}.admin@brandigade.test`,
      passwordHash: hash,
      role: 'Admin',
      mustChangePassword: false,
    },
  });
  const emp = await prisma.employee.create({
    data: {
      userId: user.id,
      employeeCode: `${TAG}-A1`,
      fullName: 'Smoke Admin',
      designation: 'Administrator',
      baseSalary: 100000,
    },
  });
  created.users.push(user.id);
  created.employees.push(emp.id);
  return { user, emp };
}

async function seedSdr() {
  const hash = await bcrypt.hash('SdrPass12345', 10);
  const user = await prisma.user.create({
    data: {
      email: `${TAG.toLowerCase()}.sdr@brandigade.test`,
      passwordHash: hash,
      role: 'SDR',
      mustChangePassword: false,
    },
  });
  const emp = await prisma.employee.create({
    data: {
      userId: user.id,
      employeeCode: `${TAG}-S1`,
      fullName: 'Smoke SDR',
      designation: 'SDR',
      baseSalary: 50000,
      zkUserId: `${TAG}-9`,
    },
  });
  created.users.push(user.id);
  created.employees.push(emp.id);
  return { user, emp };
}

async function cleanup() {
  const ids = created.employees;
  const userIds = created.users;
  await prisma.$transaction([
    prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.notification.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.spiff.deleteMany({ where: { OR: [{ employeeId: { in: ids } }, { givenById: { in: userIds } }] } }),
    prisma.payslip.deleteMany({ where: { employeeId: { in: ids } } }),
    prisma.attendance.deleteMany({ where: { employeeId: { in: ids } } }),
    prisma.leaveRequest.deleteMany({ where: { employeeId: { in: ids } } }),
    prisma.halfdayRequest.deleteMany({ where: { employeeId: { in: ids } } }),
    prisma.wfhRequest.deleteMany({ where: { employeeId: { in: ids } } }),
    prisma.loanRequest.deleteMany({ where: { employeeId: { in: ids } } }),
    prisma.document.deleteMany({ where: { employeeId: { in: ids } } }),
    prisma.campaignPerformance.deleteMany({ where: { employeeId: { in: ids } } }),
    prisma.campaignMember.deleteMany({ where: { employeeId: { in: ids } } }),
    prisma.salaryHistory.deleteMany({ where: { employeeId: { in: ids } } }),
  ]);
  await prisma.payslip.deleteMany({ where: { payrollRun: { periodYear: 2099 } } });
  await prisma.payrollRun.deleteMany({ where: { periodYear: 2099 } });
  await prisma.campaign.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.employee.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function main() {
  require('../server');
  await new Promise((r) => setTimeout(r, 2500));

  console.log('\n=== HEALTH ===');
  const health = await api('GET', '/health');
  check('health reports database up', health.status === 200 && health.data.database === 'up', JSON.stringify(health.data));

  const admin = await seedAdmin();
  const sdr = await seedSdr();

  console.log('\n=== AUTH ===');
  const badLogin = await api('POST', '/auth/login', {
    body: { email: admin.user.email, password: 'WrongPassword' },
  });
  check('wrong password rejected', badLogin.status === 401);

  const login = await api('POST', '/auth/login', {
    body: { email: admin.user.email.toUpperCase(), password: 'AdminPass123' },
  });
  check('login succeeds (case-insensitive email)', login.status === 200 && !!login.data.accessToken, JSON.stringify(login.data).slice(0, 150));
  check('login never returns passwordHash', !JSON.stringify(login.data).includes('passwordHash'));

  const adminToken = login.data.accessToken;

  const sdrLogin = await api('POST', '/auth/login', {
    body: { email: sdr.user.email, password: 'SdrPass12345' },
  });
  const sdrToken = sdrLogin.data.accessToken;
  check('SDR can log in', sdrLogin.status === 200 && !!sdrToken);

  console.log('\n=== AUTH BYPASS (the critical one) ===');
  const bypass = await api('POST', '/auth/google-login', {
    body: { email: admin.user.email, googleId: 'attacker', name: 'Mallory' },
  });
  check('google-login rejects a body with no verified ID token', bypass.status >= 400, `got ${bypass.status}`);
  check('google-login issues no token to a forged request', !bypass.data.accessToken);

  const forgedToken = await api('POST', '/auth/google-login', { body: { idToken: 'not-a-real-token' } });
  check('google-login rejects an unverifiable ID token', forgedToken.status === 401, `got ${forgedToken.status}`);

  console.log('\n=== VALIDATION ===');
  const badEmp = await api('POST', '/employees', {
    token: adminToken,
    body: { email: 'bad', password: 'short', employeeCode: '', fullName: '', designation: '', shiftStart: '9am' },
  });
  check('invalid employee payload is rejected with field details',
    badEmp.status === 400 && Array.isArray(badEmp.data.details) && badEmp.data.details.length > 0,
    JSON.stringify(badEmp.data).slice(0, 200));

  console.log('\n=== RBAC ===');
  const sdrPayroll = await api('GET', '/payroll/runs', { token: sdrToken });
  check('SDR cannot list payroll runs', sdrPayroll.status === 403);

  const sdrAudit = await api('GET', '/system/audit-logs', { token: sdrToken });
  check('SDR cannot read audit logs', sdrAudit.status === 403);

  const sdrEmployees = await api('GET', '/employees', { token: sdrToken });
  check('SDR employee list is scoped to self only',
    sdrEmployees.status === 200 && sdrEmployees.data.length === 1 && sdrEmployees.data[0].id === sdr.emp.id,
    `got ${sdrEmployees.data?.length} rows`);

  const sdrOther = await api('GET', `/employees/${admin.emp.id}`, { token: sdrToken });
  check('SDR cannot read another employee record', sdrOther.status === 403);

  const noToken = await api('GET', '/employees');
  check('unauthenticated request rejected', noToken.status === 401);

  console.log('\n=== CAMPAIGN RBAC + ROLE CLOBBERING ===');
  const campaign = await api('POST', '/campaigns', {
    token: adminToken,
    body: { name: `${TAG} Campaign`, description: 'smoke', monthlyShowupTarget: 40 },
  });
  check('admin can create a campaign', campaign.status === 201, JSON.stringify(campaign.data).slice(0, 200));
  const campaignId = campaign.data.id;
  created.campaigns.push(campaignId);

  const sdrCampaigns = await api('GET', '/campaigns', { token: sdrToken });
  check('SDR sees no campaigns they are not a member of',
    sdrCampaigns.status === 200 && sdrCampaigns.data.length === 0,
    `got ${sdrCampaigns.data?.length}`);

  const sdrDash = await api('GET', `/campaigns/${campaignId}/dashboard`, { token: sdrToken });
  check('SDR cannot open another campaign dashboard', sdrDash.status === 403);

  // The role-clobbering bug: assigning an Admin to a campaign used to rewrite
  // their User.role to 'Team Lead', and unassigning set it to 'Employee'.
  await api('POST', `/campaigns/${campaignId}/members`, {
    token: adminToken,
    body: { employeeId: admin.emp.id, role: 'team_lead' },
  });
  let roleAfter = await prisma.user.findUnique({ where: { id: admin.user.id }, select: { role: true } });
  check('assigning an Admin to a campaign keeps their Admin role', roleAfter.role === 'Admin', `role is now ${roleAfter.role}`);

  await api('DELETE', `/campaigns/${campaignId}/members/${admin.emp.id}`, { token: adminToken });
  roleAfter = await prisma.user.findUnique({ where: { id: admin.user.id }, select: { role: true } });
  check('unassigning an Admin does not demote them to Employee', roleAfter.role === 'Admin', `role is now ${roleAfter.role}`);

  await api('POST', `/campaigns/${campaignId}/members`, {
    token: adminToken,
    body: { employeeId: sdr.emp.id, role: 'sdr' },
  });

  console.log('\n=== ATTENDANCE: CHECK-OUT PERSISTED ===');
  const punch = await api('POST', '/attendance/manual', {
    token: adminToken,
    body: {
      employeeId: sdr.emp.id,
      date: '2099-03-10',
      status: 'present',
      checkIn: '2099-03-10T04:05:00.000Z', // 09:05 PKT — inside grace
      checkOut: '2099-03-10T14:30:00.000Z', // 19:30 PKT — 60 min overtime
      note: 'smoke test',
    },
  });
  check('manual punch accepted', punch.status === 200, JSON.stringify(punch.data).slice(0, 200));
  check('check-out is stored (was hard-coded to null)', punch.data.checkOut !== null, `checkOut=${punch.data.checkOut}`);
  check('overtime computed from check-out', punch.data.overtime === 60, `overtime=${punch.data.overtime}`);
  check('on-time arrival inside grace scores 0 late', punch.data.late === 0, `late=${punch.data.late}`);

  const latePunch = await api('POST', '/attendance/manual', {
    token: adminToken,
    body: {
      employeeId: sdr.emp.id,
      date: '2099-03-11',
      status: 'present',
      checkIn: '2099-03-11T05:05:00.000Z', // 10:05 PKT -> 35 min late
    },
  });
  check('late arrival scored in office timezone', latePunch.data.late === 35, `late=${latePunch.data.late}`);

  const badRange = await api('POST', '/attendance/manual', {
    token: adminToken,
    body: {
      employeeId: sdr.emp.id,
      date: '2099-03-12',
      status: 'present',
      checkIn: '2099-03-12T10:00:00.000Z',
      checkOut: '2099-03-12T04:00:00.000Z',
    },
  });
  check('check-out before check-in is rejected', badRange.status === 400);

  console.log('\n=== REQUESTS + NOTIFICATIONS ===');
  const leave = await api('POST', '/requests/leave', {
    token: sdrToken,
    body: { type: 'unpaid', startDate: '2099-03-20', endDate: '2099-03-22', reason: 'smoke' },
  });
  check('SDR can submit leave', leave.status === 201, JSON.stringify(leave.data).slice(0, 200));
  check('inclusive leave day count is correct', leave.data.days === 3, `days=${leave.data.days}`);

  const overlap = await api('POST', '/requests/leave', {
    token: sdrToken,
    body: { type: 'annual', startDate: '2099-03-21', endDate: '2099-03-23' },
  });
  check('overlapping leave request is rejected', overlap.status === 409, `got ${overlap.status}`);

  const adminNotifs = await api('GET', '/system/notifications', { token: adminToken });
  check('admins are notified of a new request (feature was entirely dead)',
    adminNotifs.status === 200 && adminNotifs.data.notifications.length > 0,
    `count=${adminNotifs.data?.notifications?.length}`);

  const sdrReview = await api('PUT', `/requests/leave/${leave.data.id}/review`, {
    token: sdrToken,
    body: { status: 'approved' },
  });
  check('SDR cannot approve their own leave', sdrReview.status === 403);

  const approve = await api('PUT', `/requests/leave/${leave.data.id}/review`, {
    token: adminToken,
    body: { status: 'approved', reviewNote: 'ok' },
  });
  check('admin can approve leave', approve.status === 200, JSON.stringify(approve.data).slice(0, 150));

  const doubleReview = await api('PUT', `/requests/leave/${leave.data.id}/review`, {
    token: adminToken,
    body: { status: 'rejected' },
  });
  check('a reviewed request cannot be reviewed twice', doubleReview.status === 409);

  const sdrNotifs = await api('GET', '/system/notifications', { token: sdrToken });
  check('employee is notified their leave was approved',
    sdrNotifs.data.notifications.some((n) => n.title.includes('approved')),
    JSON.stringify(sdrNotifs.data.notifications?.[0] || {}).slice(0, 150));

  const attendanceAfter = await prisma.attendance.findMany({
    where: { employeeId: sdr.emp.id, status: 'leave' },
  });
  check('approving leave writes attendance rows', attendanceAfter.length === 3, `rows=${attendanceAfter.length}`);

  console.log('\n=== SPIFFS ===');
  const spiff = await api('POST', '/system/spiffs', {
    token: adminToken,
    body: { employeeId: sdr.emp.id, amount: 5000, reason: 'smoke bonus', date: '2099-03-15' },
  });
  check('admin can award a spiff (no route existed before)', spiff.status === 201, JSON.stringify(spiff.data).slice(0, 150));

  const sdrSpiffs = await api('GET', '/system/spiffs', { token: sdrToken });
  check('employee can see their own spiffs', sdrSpiffs.status === 200 && sdrSpiffs.data.length === 1);

  console.log('\n=== PAYROLL ===');
  const run = await api('POST', '/payroll/run', {
    token: adminToken,
    body: { month: 3, year: 2099, performance: [{ employeeId: sdr.emp.id, showups: 12 }] },
  });
  check('payroll run computes', run.status === 200, JSON.stringify(run.data).slice(0, 250));

  const sdrSlip = run.data.payslips?.find((p) => p.employeeId === sdr.emp.id);
  check('spiff flows into the payslip', sdrSlip?.spiffs === 5000, `spiffs=${sdrSlip?.spiffs}`);
  check('unpaid leave is deducted', sdrSlip?.unpaidLeaveDeduction > 0, `deduction=${sdrSlip?.unpaidLeaveDeduction}`);
  check('punctuality allowance forfeited after a late', sdrSlip?.punctualityAllowance === 0, `allowance=${sdrSlip?.punctualityAllowance}`);
  check('net pay is rounded, not a raw float',
    sdrSlip && Number.isFinite(sdrSlip.netPay) && String(sdrSlip.netPay).split('.')[1]?.length !== 13,
    `netPay=${sdrSlip?.netPay}`);

  const runId = run.data.payrollRun.id;
  const finalize = await api('PUT', `/payroll/runs/${runId}/finalize`, { token: adminToken });
  check('payroll finalizes', finalize.status === 200, JSON.stringify(finalize.data).slice(0, 200));

  // The data-loss bug: re-running a finalized month used to wipe its payslips.
  const rerun = await api('POST', '/payroll/run', {
    token: adminToken,
    body: { month: 3, year: 2099, performance: [] },
  });
  check('re-running a FINALIZED payroll month is refused', rerun.status === 409, `got ${rerun.status}`);

  const survived = await prisma.payslip.count({ where: { payrollRunId: runId } });
  check('finalized payslips survived the re-run attempt', survived > 0, `remaining=${survived}`);

  const myPayslips = await api('GET', '/payroll/my-payslips', { token: sdrToken });
  check('employee sees their finalized payslip', myPayslips.status === 200 && myPayslips.data.length === 1);

  const pdfRes = await fetch(`${BASE}/payroll/payslips/${sdrSlip.id}/pdf`, {
    headers: { Authorization: `Bearer ${sdrToken}` },
  });
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  check('payslip PDF streams for its owner',
    pdfRes.status === 200 && pdfBuf.subarray(0, 4).toString() === '%PDF',
    `status=${pdfRes.status} bytes=${pdfBuf.length}`);

  const pdfNoAuth = await fetch(`${BASE}/payroll/payslips/${sdrSlip.id}/pdf`);
  check('payslip PDF requires auth (token-in-URL removed)', pdfNoAuth.status === 401, `got ${pdfNoAuth.status}`);

  const adminSlip = run.data.payslips.find((p) => p.employeeId === admin.emp.id);
  const crossPdf = await fetch(`${BASE}/payroll/payslips/${adminSlip.id}/pdf`, {
    headers: { Authorization: `Bearer ${sdrToken}` },
  });
  check('an employee cannot download someone else payslip', crossPdf.status === 403, `got ${crossPdf.status}`);

  console.log('\n=== AUDIT LOG SHAPE ===');
  const audits = await api('GET', '/system/audit-logs', { token: adminToken });
  check('audit log returns paginated envelope', audits.status === 200 && Array.isArray(audits.data.logs));
  const withDetails = audits.data.logs.find((l) => l.details);
  check('audit details stored as JSON object, not a JSON string',
    withDetails && typeof withDetails.details === 'object',
    `type=${typeof withDetails?.details}`);

  console.log('\n=== ORG CHART ===');
  const org = await api('GET', '/employees/org-chart', { token: adminToken });
  check('org chart endpoint exists and returns a tree', org.status === 200 && Array.isArray(org.data.roots), JSON.stringify(org.data).slice(0, 150));

  console.log('\n=== PASSWORD CHANGE ===');
  const weak = await api('POST', '/auth/change-password', {
    token: sdrToken,
    body: { currentPassword: 'SdrPass12345', newPassword: 'weak' },
  });
  check('weak new password rejected', weak.status === 400);

  const changed = await api('POST', '/auth/change-password', {
    token: sdrToken,
    body: { currentPassword: 'SdrPass12345', newPassword: 'BrandNewPass99' },
  });
  check('password change works (endpoint did not exist before)', changed.status === 200, JSON.stringify(changed.data).slice(0, 150));

  const reLogin = await api('POST', '/auth/login', {
    body: { email: sdr.user.email, password: 'BrandNewPass99' },
  });
  check('can log in with the new password', reLogin.status === 200);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`RESULTS: ${pass} passed, ${fail} failed`);
  if (failures.length) console.log('Failed:', failures.join(' | '));
  console.log('='.repeat(60));
}

main()
  .catch((e) => {
    console.error('\nSMOKE TEST CRASHED:', e);
    fail++;
  })
  .finally(async () => {
    console.log('\nCleaning up test data...');
    try {
      await cleanup();
      console.log('Cleanup complete.');
    } catch (e) {
      console.error('Cleanup failed:', e.message);
    }
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
