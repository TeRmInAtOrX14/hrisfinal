const bcrypt = require('bcryptjs');

const prisma = require('../lib/prisma');
const { logAudit } = require('../utils/audit');
const { sendMail } = require('../utils/mailer');
const { isAdmin, isTeamLead, isSelfOnly, ledCampaignIds, canAccessEmployee } = require('../utils/scope');

const USER_SELECT = { select: { email: true, role: true, isActive: true } };
const MEMBER_INCLUDE = { where: { status: 'active' }, include: { campaign: true } };
const MANAGER_SELECT = { select: { id: true, fullName: true, designation: true } };

/** Attach the flattened `team`/`teams` fields the UI reads. */
function withTeams(employee) {
  return {
    ...employee,
    team: employee.campaignMembers?.[0]?.campaign || null,
    teams: (employee.campaignMembers || []).map((m) => m.campaign),
  };
}

// ---------------------------------------------------------------------------
// Campaign metadata for filters and forms
// ---------------------------------------------------------------------------

exports.getTeams = async (req, res, next) => {
  try {
    const where = { status: 'active' };

    if (isTeamLead(req.user) && req.user.employee) {
      where.members = {
        some: { employeeId: req.user.employee.id, role: 'team_lead', status: 'active' },
      };
    } else if (isSelfOnly(req.user) && req.user.employee) {
      where.members = { some: { employeeId: req.user.employee.id, status: 'active' } };
    }

    const campaigns = await prisma.campaign.findMany({
      where,
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    res.json(campaigns);
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

exports.getEmployees = async (req, res, next) => {
  try {
    const { campaignId, status, search } = req.query;

    // AND-composed clauses. The old handler assigned `where.OR` for the search
    // and then *reassigned* `where.OR` for the Team Lead scope, so whichever ran
    // last silently discarded the other — a Team Lead searching by name got the
    // scope clause thrown away.
    const and = [];

    if (campaignId) {
      and.push({ campaignMembers: { some: { campaignId, status: 'active' } } });
    }
    if (status) {
      and.push({ status });
    }
    if (search) {
      and.push({
        OR: [
          { fullName: { contains: search, mode: 'insensitive' } },
          { employeeCode: { contains: search, mode: 'insensitive' } },
          { designation: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    if (isSelfOnly(req.user)) {
      if (!req.user.employee) return res.json([]);
      and.push({ id: req.user.employee.id });
    } else if (isTeamLead(req.user)) {
      if (!req.user.employee) return res.json([]);
      const campaignIds = await ledCampaignIds(req.user.employee.id);
      and.push({
        OR: [
          { id: req.user.employee.id },
          { campaignMembers: { some: { campaignId: { in: campaignIds }, status: 'active' } } },
        ],
      });
    }

    const employees = await prisma.employee.findMany({
      where: and.length ? { AND: and } : {},
      include: {
        user: USER_SELECT,
        campaignMembers: MEMBER_INCLUDE,
        manager: MANAGER_SELECT,
      },
      orderBy: { employeeCode: 'asc' },
    });

    res.json(employees.map(withTeams));
  } catch (err) {
    next(err);
  }
};

exports.getEmployeeById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!(await canAccessEmployee(req.user, id))) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const employee = await prisma.employee.findUnique({
      where: { id },
      include: {
        user: USER_SELECT,
        campaignMembers: MEMBER_INCLUDE,
        manager: MANAGER_SELECT,
        subordinates: MANAGER_SELECT,
        // Salary history is compensation data: only admins and the employee
        // themselves see it, never a Team Lead browsing their team.
        salaryHistory:
          isAdmin(req.user) || req.user.employee?.id === id
            ? { orderBy: { effectiveDate: 'desc' } }
            : false,
      },
    });

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    res.json(withTeams(employee));
  } catch (err) {
    next(err);
  }
};

exports.createEmployee = async (req, res, next) => {
  try {
    const { email, password, role, teamIds, teamId, ...profile } = req.body;

    const [existingUser, existingCode, existingZk] = await Promise.all([
      prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } }),
      prisma.employee.findUnique({ where: { employeeCode: profile.employeeCode } }),
      profile.zkUserId
        ? prisma.employee.findUnique({ where: { zkUserId: profile.zkUserId } })
        : null,
    ]);

    if (existingUser) {
      return res.status(409).json({ error: 'A user with this email already exists.' });
    }
    if (existingCode) {
      return res.status(409).json({ error: 'That employee code is already in use.' });
    }
    // zkUserId is unique in the schema; catching it here gives a usable message
    // instead of a raw Prisma P2002 surfacing as a 500.
    if (existingZk) {
      return res.status(409).json({
        error: `Biometric device ID ${profile.zkUserId} is already assigned to ${existingZk.fullName}.`,
      });
    }

    if (profile.managerId) {
      const manager = await prisma.employee.findUnique({ where: { id: profile.managerId } });
      if (!manager) return res.status(400).json({ error: 'The selected manager does not exist.' });
    }

    const passwordHash = await bcrypt.hash(password, await bcrypt.genSalt(12));
    const selectedTeams = teamIds?.length ? teamIds : teamId ? [teamId] : [];
    const memberRole = role === 'SDR' ? 'sdr' : 'team_lead';

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, passwordHash, role, mustChangePassword: true },
      });

      const emp = await tx.employee.create({
        data: { userId: user.id, ...profile },
      });

      for (const campaignId of selectedTeams) {
        await tx.campaignMember.create({
          data: { campaignId, employeeId: emp.id, role: memberRole, status: 'active' },
        });
      }

      await tx.salaryHistory.create({
        data: {
          employeeId: emp.id,
          newSalary: profile.baseSalary,
          reason: 'Initial salary setup',
          effectiveDate: new Date(),
          createdById: req.user.id,
        },
      });

      return tx.employee.findUnique({
        where: { id: emp.id },
        include: { user: USER_SELECT, campaignMembers: MEMBER_INCLUDE },
      });
    });

    // logAudit redacts credentials, so the password never reaches the audit log.
    await logAudit(req.user.id, 'CREATE_EMPLOYEE', 'Employee', created.id, {
      fullName: created.fullName,
      employeeCode: created.employeeCode,
      role,
    });

    res.status(201).json(withTeams(created));
  } catch (err) {
    next(err);
  }
};

exports.updateEmployee = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const current = await prisma.employee.findUnique({ where: { id }, include: { user: true } });
    if (!current) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // ---- Non-admin: own profile, contact fields only ----------------------
    if (!isAdmin(req.user)) {
      if (req.user.employee?.id !== id) {
        return res.status(403).json({ error: 'Access denied.' });
      }

      const allowed = {};
      for (const field of ['phone', 'birthday', 'emergencyContact', 'bankAccount']) {
        if (updates[field] !== undefined) allowed[field] = updates[field];
      }

      if (Object.keys(allowed).length === 0) {
        return res.status(400).json({ error: 'No editable fields were provided.' });
      }

      const updated = await prisma.employee.update({
        where: { id },
        data: allowed,
        include: { user: USER_SELECT, campaignMembers: MEMBER_INCLUDE },
      });

      await logAudit(req.user.id, 'SELF_UPDATE_EMPLOYEE', 'Employee', id, allowed);
      return res.json(withTeams(updated));
    }

    // ---- Admin ------------------------------------------------------------
    if (updates.managerId) {
      if (updates.managerId === id) {
        return res.status(400).json({ error: 'An employee cannot be their own manager.' });
      }
      // Walk up the chain so an edit cannot create a reporting cycle, which
      // would make the org chart recurse forever.
      let cursor = updates.managerId;
      const seen = new Set([id]);
      while (cursor) {
        if (seen.has(cursor)) {
          return res.status(400).json({ error: 'That change would create a reporting loop.' });
        }
        seen.add(cursor);
        const parent = await prisma.employee.findUnique({
          where: { id: cursor },
          select: { managerId: true },
        });
        if (!parent) return res.status(400).json({ error: 'The selected manager does not exist.' });
        cursor = parent.managerId;
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      // 1. Account fields
      const userData = {};
      if (updates.email !== undefined) userData.email = updates.email;
      if (updates.role !== undefined) userData.role = updates.role;
      if (updates.isActive !== undefined) userData.isActive = updates.isActive;

      if (Object.keys(userData).length > 0) {
        await tx.user.update({ where: { id: current.userId }, data: userData });
      }

      // 2. Salary history
      if (updates.baseSalary !== undefined && updates.baseSalary !== current.baseSalary) {
        await tx.salaryHistory.create({
          data: {
            employeeId: id,
            oldSalary: current.baseSalary,
            newSalary: updates.baseSalary,
            reason: updates.salaryChangeReason || 'Salary updated by admin',
            effectiveDate: updates.salaryChangeEffectiveDate
              ? new Date(updates.salaryChangeEffectiveDate)
              : new Date(),
            createdById: req.user.id,
          },
        });
      }

      // 3. Campaign membership
      if (updates.teamIds !== undefined || updates.teamId !== undefined) {
        const selected = updates.teamIds ?? (updates.teamId ? [updates.teamId] : []);
        const finalRole = updates.role || current.user.role;
        const memberRole = finalRole === 'SDR' ? 'sdr' : 'team_lead';

        await tx.campaignMember.updateMany({
          where: { employeeId: id, status: 'active', campaignId: { notIn: selected } },
          data: { status: 'inactive' },
        });

        for (const campaignId of selected) {
          await tx.campaignMember.upsert({
            where: { campaignId_employeeId: { campaignId, employeeId: id } },
            create: { campaignId, employeeId: id, role: memberRole, status: 'active' },
            update: { status: 'active', role: memberRole },
          });
        }
      }

      // 4. Employee fields — only what was sent
      const employeeData = {};
      const employeeFields = [
        'fullName',
        'designation',
        'managerId',
        'baseSalary',
        'currency',
        'phone',
        'birthday',
        'bankAccount',
        'emergencyContact',
        'shiftStart',
        'shiftEnd',
        'graceMinutes',
        'zkUserId',
        'status',
        'employeeCode',
      ];
      for (const field of employeeFields) {
        if (updates[field] !== undefined) employeeData[field] = updates[field];
      }

      if (Object.keys(employeeData).length > 0) {
        await tx.employee.update({ where: { id }, data: employeeData });
      }

      return tx.employee.findUnique({
        where: { id },
        include: { user: USER_SELECT, campaignMembers: MEMBER_INCLUDE, manager: MANAGER_SELECT },
      });
    });

    await logAudit(req.user.id, 'UPDATE_EMPLOYEE', 'Employee', id, updates);
    res.json(withTeams(updated));
  } catch (err) {
    next(err);
  }
};

/**
 * Permanently delete an employee and everything attached to them.
 *
 * The old transaction deleted the Employee and User rows but left AuditLog,
 * Notification and given-Spiff rows pointing at that user, so the User delete hit
 * a foreign-key violation and the whole request 500'd — the "hard delete" button
 * simply never worked once the account had done anything. Those references are
 * now handled: audit history is preserved but detached (the log is the record of
 * what happened, so it must outlive the account).
 */
exports.deleteEmployee = async (req, res, next) => {
  try {
    const { id } = req.params;

    const employee = await prisma.employee.findUnique({ where: { id }, include: { user: true } });
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    if (employee.userId === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }

    await prisma.$transaction([
      // Detach rather than delete: keep the audit trail, drop the FK.
      prisma.auditLog.updateMany({ where: { userId: employee.userId }, data: { userId: null } }),
      prisma.notification.deleteMany({ where: { userId: employee.userId } }),
      // Spiffs this user awarded to others would otherwise block the delete.
      prisma.spiff.deleteMany({ where: { givenById: employee.userId } }),
      prisma.employee.updateMany({ where: { managerId: id }, data: { managerId: null } }),
      prisma.salaryHistory.deleteMany({ where: { employeeId: id } }),
      prisma.campaignMember.deleteMany({ where: { employeeId: id } }),
      prisma.campaignPerformance.deleteMany({ where: { employeeId: id } }),
      prisma.spiff.deleteMany({ where: { employeeId: id } }),
      prisma.attendance.deleteMany({ where: { employeeId: id } }),
      prisma.leaveRequest.deleteMany({ where: { employeeId: id } }),
      prisma.halfdayRequest.deleteMany({ where: { employeeId: id } }),
      prisma.wfhRequest.deleteMany({ where: { employeeId: id } }),
      prisma.loanRequest.deleteMany({ where: { employeeId: id } }),
      prisma.payslip.deleteMany({ where: { employeeId: id } }),
      prisma.document.deleteMany({ where: { employeeId: id } }),
      prisma.employee.delete({ where: { id } }),
      prisma.user.delete({ where: { id: employee.userId } }),
    ]);

    await logAudit(req.user.id, 'DELETE_EMPLOYEE', 'Employee', id, {
      fullName: employee.fullName,
      employeeCode: employee.employeeCode,
    });

    res.json({ message: 'Employee and all associated records deleted permanently.' });
  } catch (err) {
    next(err);
  }
};

exports.terminateEmployee = async (req, res, next) => {
  try {
    const { id } = req.params;

    const employee = await prisma.employee.findUnique({ where: { id }, include: { user: true } });
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    if (employee.userId === req.user.id) {
      return res.status(400).json({ error: 'You cannot terminate your own account.' });
    }

    if (employee.status === 'terminated') {
      return res.status(409).json({ error: 'This employee is already terminated.' });
    }

    await prisma.$transaction([
      prisma.user.update({ where: { id: employee.userId }, data: { isActive: false, refreshToken: null } }),
      prisma.employee.update({ where: { id }, data: { status: 'terminated' } }),
      // Free the biometric slot so the device ID can be reassigned.
      prisma.campaignMember.updateMany({ where: { employeeId: id }, data: { status: 'inactive' } }),
    ]);

    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px;">
        <h2 style="color: #dc2626; border-bottom: 2px solid #dc2626; padding-bottom: 10px;">Employment Termination Notice</h2>
        <p>Dear <strong>${employee.fullName}</strong>,</p>
        <p>We are writing to confirm that your employment with <strong>${'Brandigade'}</strong> has ended, effective immediately.</p>
        <p>Your access to the Brandigade HRIS portal has been deactivated.</p>
        <p>For questions about your final settlement, outstanding salary, or return of company property, please contact HR at <a href="mailto:hr@brandigade.com">hr@brandigade.com</a>.</p>
        <p>We thank you for your time with us and wish you well.</p>
        <br/>
        <p>Sincerely,</p>
        <p><strong>HR Department</strong><br/>Brandigade</p>
      </div>
    `;

    // Never let a mail failure roll back the termination itself.
    const mailSent = await sendMail({
      to: employee.user.email,
      subject: 'Employment Termination Notice - Brandigade',
      html,
    });

    await logAudit(req.user.id, 'TERMINATE_EMPLOYEE', 'Employee', id, {
      fullName: employee.fullName,
      mailSent,
    });

    res.json({
      message: mailSent
        ? 'Employee terminated. Notification email sent.'
        : 'Employee terminated. Email was not sent (SMTP is not configured).',
      mailSent,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Org chart — manager/subordinate relationships.
 *
 * The README advertises a hierarchical org chart and the schema has carried the
 * manager relation since the first migration, but no endpoint ever exposed it.
 */
exports.getOrgChart = async (req, res, next) => {
  try {
    const employees = await prisma.employee.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        fullName: true,
        employeeCode: true,
        designation: true,
        photoUrl: true,
        managerId: true,
        user: { select: { role: true } },
        campaignMembers: {
          where: { status: 'active' },
          select: { role: true, campaign: { select: { id: true, name: true } } },
        },
      },
      orderBy: { employeeCode: 'asc' },
    });

    const byId = new Map(
      employees.map((e) => [
        e.id,
        {
          id: e.id,
          fullName: e.fullName,
          employeeCode: e.employeeCode,
          designation: e.designation,
          photoUrl: e.photoUrl,
          role: e.user?.role || 'Employee',
          campaigns: e.campaignMembers.map((m) => m.campaign.name),
          reports: [],
        },
      ])
    );

    const roots = [];
    for (const emp of employees) {
      const node = byId.get(emp.id);
      const parent = emp.managerId ? byId.get(emp.managerId) : null;
      if (parent) parent.reports.push(node);
      else roots.push(node);
    }

    res.json({ roots, total: employees.length });
  } catch (err) {
    next(err);
  }
};
