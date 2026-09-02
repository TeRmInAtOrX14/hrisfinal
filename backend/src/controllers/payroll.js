const fs = require('fs');
const os = require('os');
const path = require('path');

const prisma = require('../lib/prisma');
const config = require('../config/env');
const supabase = require('../config/supabase');
const { generatePayslipPdf } = require('../utils/payslipPdf');
const { logAudit } = require('../utils/audit');
const { notifyEmployee } = require('../utils/notify');
const { monthBounds } = require('../utils/attendanceTime');
const {
  matchSlab,
  calculateSlabCommission,
  calculateTeamLeadCommission,
} = require('../utils/commission');

/**
 * Payroll engine.
 *
 * Behaviour changes worth calling out:
 *
 *  - Re-running a month no longer destroys a finalized run. `runPayroll` used to
 *    upsert the PayrollRun back to 'draft' and `deleteMany` its payslips with no
 *    status check, so recomputing an already-finalized month silently deleted
 *    every issued payslip (and its stored PDF link) with no way back.
 *
 *  - The per-employee loop issued six-plus queries each. For 100 staff that was
 *    600+ round trips to Supabase. Everything is now batch-fetched up front and
 *    grouped in memory.
 *
 *  - Unpaid-leave days spanning a month boundary are counted. The old aggregate
 *    required startDate >= monthStart AND endDate <= monthEnd, so a leave from
 *    29 Jan to 2 Feb was ignored by both months entirely.
 *
 *  - Money is rounded to whole rupees at the boundary instead of storing values
 *    like 76666.66666666667 and rendering them raw in the UI.
 */

// Allowances are policy, not code. They were literal 2500s inside the loop.
const ATTENDANCE_ALLOWANCE = Number(process.env.ATTENDANCE_ALLOWANCE ?? 2500);
const PUNCTUALITY_ALLOWANCE = Number(process.env.PUNCTUALITY_ALLOWANCE ?? 2500);
const ATTENDANCE_ALLOWANCE_MAX_LEAVE_DAYS = Number(
  process.env.ATTENDANCE_ALLOWANCE_MAX_LEAVE_DAYS ?? 1
);
const LATES_PER_DAY_DEDUCTION = Number(process.env.LATES_PER_DAY_DEDUCTION ?? 3);

const COMPANY = { name: config.company.name, address: config.company.address };

/** Round to whole currency units; payroll should never carry float dust. */
const round = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------------------
// Run payroll
// ---------------------------------------------------------------------------

exports.runPayroll = async (req, res, next) => {
  try {
    const { month, year, performance } = req.body;
    const { start, end, daysInPeriod } = monthBounds(year, month);

    const existingRun = await prisma.payrollRun.findUnique({
      where: { periodMonth_periodYear: { periodMonth: month, periodYear: year } },
    });

    if (existingRun?.status === 'finalized') {
      return res.status(409).json({
        error:
          'This payroll period has already been finalized and cannot be recalculated. ' +
          'Issued payslips are a financial record.',
        code: 'PAYROLL_ALREADY_FINALIZED',
      });
    }

    const employees = await prisma.employee.findMany({
      where: { status: 'active' },
      include: {
        campaignMembers: {
          where: { status: 'active' },
          include: { campaign: true },
        },
      },
      orderBy: { employeeCode: 'asc' },
    });

    if (employees.length === 0) {
      return res.status(400).json({ error: 'There are no active employees to run payroll for.' });
    }

    const employeeIds = employees.map((e) => e.id);
    const campaignIds = [
      ...new Set(employees.flatMap((e) => e.campaignMembers.map((m) => m.campaignId))),
    ];

    // ---- Batch-fetch everything the loop needs -----------------------------
    const [
      attendanceRows,
      approvedLeaves,
      loanRows,
      spiffRows,
      dbPerformance,
      structures,
      allCampaignMembers,
      teamPerformance,
    ] = await Promise.all([
      prisma.attendance.findMany({
        where: { employeeId: { in: employeeIds }, date: { gte: start, lte: end } },
        select: { employeeId: true, status: true, late: true },
      }),
      // Overlap, not containment: any leave that touches the month.
      prisma.leaveRequest.findMany({
        where: {
          employeeId: { in: employeeIds },
          status: 'approved',
          startDate: { lte: end },
          endDate: { gte: start },
        },
        select: { employeeId: true, type: true, days: true, startDate: true, endDate: true },
      }),
      prisma.loanRequest.findMany({
        where: {
          employeeId: { in: employeeIds },
          status: 'approved',
          repaymentMonth: month,
          repaymentYear: year,
        },
        select: { employeeId: true, amount: true },
      }),
      prisma.spiff.findMany({
        where: { employeeId: { in: employeeIds }, date: { gte: start, lte: end } },
        select: { employeeId: true, amount: true },
      }),
      prisma.campaignPerformance.findMany({
        where: { employeeId: { in: employeeIds }, month, year },
      }),
      campaignIds.length
        ? prisma.commissionStructure.findMany({
            where: { campaignId: { in: campaignIds }, status: 'active' },
            include: { slabs: { orderBy: { minShowups: 'asc' } } },
          })
        : [],
      campaignIds.length
        ? prisma.campaignMember.findMany({
            where: { campaignId: { in: campaignIds }, role: 'sdr', status: 'active' },
            select: { campaignId: true, employeeId: true },
          })
        : [],
      campaignIds.length
        ? prisma.campaignPerformance.findMany({
            where: { campaignId: { in: campaignIds }, month, year },
            select: { campaignId: true, employeeId: true, showups: true },
          })
        : [],
    ]);

    // ---- Index into lookups ------------------------------------------------
    const groupBy = (rows, key) => {
      const map = new Map();
      for (const row of rows) {
        const k = row[key];
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(row);
      }
      return map;
    };

    const attendanceByEmployee = groupBy(attendanceRows, 'employeeId');
    const leavesByEmployee = groupBy(approvedLeaves, 'employeeId');
    const loansByEmployee = groupBy(loanRows, 'employeeId');
    const spiffsByEmployee = groupBy(spiffRows, 'employeeId');
    const perfByEmployee = new Map(dbPerformance.map((p) => [p.employeeId, p]));
    const structureByCampaign = new Map(structures.map((s) => [s.campaignId, s]));
    const payloadPerf = new Map(performance.map((p) => [p.employeeId, p]));

    const sdrCountByCampaign = new Map();
    for (const m of allCampaignMembers) {
      sdrCountByCampaign.set(m.campaignId, (sdrCountByCampaign.get(m.campaignId) || 0) + 1);
    }

    const teamShowupsByCampaign = new Map();
    const sdrIdsByCampaign = groupBy(allCampaignMembers, 'campaignId');
    for (const [cid, members] of sdrIdsByCampaign) {
      const ids = new Set(members.map((m) => m.employeeId));
      const total = teamPerformance
        .filter((p) => p.campaignId === cid && ids.has(p.employeeId))
        .reduce((sum, p) => sum + p.showups, 0);
      teamShowupsByCampaign.set(cid, total);
    }

    /** Approved leave days that actually fall inside this month. */
    const leaveDaysInMonth = (leave) => {
      const from = leave.startDate > start ? leave.startDate : start;
      const to = leave.endDate < end ? leave.endDate : end;
      const days = Math.floor((to - from) / 86_400_000) + 1;
      return Math.max(0, Math.min(days, leave.days));
    };

    // ---- Compute ------------------------------------------------------------
    const rows = employees.map((emp) => {
      const baseSalary = emp.baseSalary;
      const perDay = daysInPeriod > 0 ? baseSalary / daysInPeriod : 0;

      const override = payloadPerf.get(emp.id);
      const stored = perfByEmployee.get(emp.id);

      // Logged CampaignPerformance is the source of truth. A run-modal field is
      // an override only when the admin actually entered a value: the schema
      // normalises blank/null inputs to undefined (see runMetric), so `??`
      // correctly falls through to the stored figure instead of a default 0.
      const showups = override?.showups ?? stored?.showups ?? 0;
      const meetingsScheduled = override?.meetingsScheduled ?? stored?.meetingsBooked ?? 0;
      const noShows = override?.noShows ?? stored?.noShows ?? 0;
      const bonus = override?.bonus ?? 0;
      const otherDeductions = override?.otherDeductions ?? 0;

      // Attendance
      let daysPresent = 0;
      let lateCount = 0;
      for (const rec of attendanceByEmployee.get(emp.id) || []) {
        if (rec.status === 'present' || rec.status === 'wfh' || rec.status === 'leave') {
          daysPresent += 1;
        } else if (rec.status === 'half_day') {
          daysPresent += 0.5;
        }
        if (rec.late > 0) lateCount++;
      }

      // Leave
      const empLeaves = leavesByEmployee.get(emp.id) || [];
      let unpaidDays = 0;
      let totalLeaveDays = 0;
      for (const leave of empLeaves) {
        const days = leaveDaysInMonth(leave);
        totalLeaveDays += days;
        if (leave.type.toLowerCase().includes('unpaid')) unpaidDays += days;
      }

      const unpaidLeaveDeduction = perDay * unpaidDays;
      const lateDeduction =
        LATES_PER_DAY_DEDUCTION > 0
          ? Math.floor(lateCount / LATES_PER_DAY_DEDUCTION) * perDay
          : 0;

      const loansDeduction = (loansByEmployee.get(emp.id) || []).reduce((s, l) => s + l.amount, 0);
      const spiffs = (spiffsByEmployee.get(emp.id) || []).reduce((s, x) => s + x.amount, 0);

      // Commission
      let commission = 0;
      const membership = emp.campaignMembers[0];
      if (membership) {
        const structure = structureByCampaign.get(membership.campaignId);
        const slabs = structure?.slabs || [];

        if (slabs.length > 0) {
          if (membership.role === 'sdr') {
            commission = calculateSlabCommission(matchSlab(slabs, showups), showups);
          } else if (membership.role === 'team_lead') {
            commission = calculateTeamLeadCommission({
              campaignName: membership.campaign.name,
              teamShowups: teamShowupsByCampaign.get(membership.campaignId) || 0,
              teamSize: sdrCountByCampaign.get(membership.campaignId) || 0,
              slabs,
            });
          }
        }
      }

      const attendanceAllowance =
        totalLeaveDays > ATTENDANCE_ALLOWANCE_MAX_LEAVE_DAYS ? 0 : ATTENDANCE_ALLOWANCE;
      const punctualityAllowance = lateCount >= 1 ? 0 : PUNCTUALITY_ALLOWANCE;

      const earnings =
        baseSalary + attendanceAllowance + punctualityAllowance + bonus + commission + spiffs;
      const deductions = unpaidLeaveDeduction + lateDeduction + loansDeduction + otherDeductions;

      return {
        employeeId: emp.id,
        baseSalary: round(baseSalary),
        daysPresent,
        daysInPeriod,
        unpaidLeaveDeduction: round(unpaidLeaveDeduction),
        lateDeduction: round(lateDeduction),
        loansDeduction: round(loansDeduction),
        otherDeductions: round(otherDeductions),
        bonus: round(bonus),
        commission: round(commission),
        spiffs: round(spiffs),
        attendanceAllowance: round(attendanceAllowance),
        punctualityAllowance: round(punctualityAllowance),
        netPay: round(Math.max(0, earnings - deductions)),
        showups,
        meetingsScheduled,
        noShows,
      };
    });

    // ---- Persist as one atomic draft ---------------------------------------
    const payrollRun = await prisma.$transaction(async (tx) => {
      // Re-check finalization INSIDE the transaction. The guard at the top of
      // this handler runs before the whole compute phase; a second admin could
      // finalize the period in that window (issuing PDFs and notifying staff).
      // Without this re-read the upsert below would force the run back to
      // 'draft' and delete those issued payslips — reverting a finalized run.
      const current = await tx.payrollRun.findUnique({
        where: { periodMonth_periodYear: { periodMonth: month, periodYear: year } },
        select: { status: true },
      });
      if (current?.status === 'finalized') {
        const err = new Error('Payroll period was finalized during this run.');
        err.code = 'PAYROLL_ALREADY_FINALIZED';
        throw err;
      }

      const run = await tx.payrollRun.upsert({
        where: { periodMonth_periodYear: { periodMonth: month, periodYear: year } },
        create: {
          periodMonth: month,
          periodYear: year,
          status: 'draft',
          createdById: req.user.id,
        },
        update: { status: 'draft', createdById: req.user.id },
      });

      await tx.payslip.deleteMany({ where: { payrollRunId: run.id } });
      await tx.payslip.createMany({
        data: rows.map((row) => ({ ...row, payrollRunId: run.id })),
      });

      return run;
    });

    const payslips = await prisma.payslip.findMany({
      where: { payrollRunId: payrollRun.id },
      include: {
        employee: { select: { id: true, fullName: true, employeeCode: true, designation: true } },
      },
      orderBy: { employee: { employeeCode: 'asc' } },
    });

    await logAudit(req.user.id, 'RUN_PAYROLL', 'PayrollRun', payrollRun.id, {
      month,
      year,
      payslipsCount: payslips.length,
    });

    res.json({ payrollRun, payslipsCount: payslips.length, payslips });
  } catch (err) {
    if (err.code === 'PAYROLL_ALREADY_FINALIZED') {
      return res.status(409).json({
        error:
          'This payroll period was finalized while the run was being calculated. ' +
          'Issued payslips are a financial record and were left untouched.',
        code: 'PAYROLL_ALREADY_FINALIZED',
      });
    }
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Finalize
// ---------------------------------------------------------------------------

/** Render one payslip PDF to a temp file and return its path. */
function renderPayslipToFile(payslip) {
  const tempPath = path.join(os.tmpdir(), `payslip-${payslip.id}-${Date.now()}.pdf`);

  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(tempPath);
    stream.on('finish', () => resolve(tempPath));
    stream.on('error', reject);

    try {
      generatePayslipPdf(stream, payslip, COMPANY);
    } catch (err) {
      stream.destroy();
      reject(err);
    }
  });
}

exports.finalizePayroll = async (req, res, next) => {
  try {
    const { id } = req.params;

    const payrollRun = await prisma.payrollRun.findUnique({
      where: { id },
      include: {
        payslips: {
          include: {
            employee: {
              include: {
                user: { select: { id: true, role: true } },
                campaignMembers: { where: { status: 'active' }, include: { campaign: true } },
              },
            },
            payrollRun: true,
          },
        },
      },
    });

    if (!payrollRun) {
      return res.status(404).json({ error: 'Payroll run not found' });
    }

    if (payrollRun.status === 'finalized') {
      return res.status(409).json({ error: 'Payroll run is already finalized' });
    }

    if (payrollRun.payslips.length === 0) {
      return res.status(400).json({ error: 'This run has no payslips to finalize.' });
    }

    const failures = [];

    for (const payslip of payrollRun.payslips) {
      let tempPath = null;
      try {
        tempPath = await renderPayslipToFile(payslip);

        if (supabase) {
          const storagePath = `${payrollRun.periodYear}/${payrollRun.periodMonth}/${payslip.id}.pdf`;
          const { error } = await supabase.storage
            .from('payslips')
            .upload(storagePath, fs.readFileSync(tempPath), {
              contentType: 'application/pdf',
              upsert: true,
            });

          if (error) {
            failures.push(`${payslip.employee.fullName}: ${error.message}`);
          } else {
            // The bucket is private, so we store the object path rather than a
            // public URL. Downloads go through the authenticated endpoint below.
            await prisma.payslip.update({
              where: { id: payslip.id },
              data: { pdfUrl: storagePath },
            });
          }
        }
      } catch (err) {
        failures.push(`${payslip.employee.fullName}: ${err.message}`);
      } finally {
        if (tempPath) {
          fs.promises.unlink(tempPath).catch(() => {});
        }
      }
    }

    const updatedRun = await prisma.payrollRun.update({
      where: { id },
      data: { status: 'finalized', finalizedAt: new Date() },
    });

    // Tell each employee their payslip is available.
    await Promise.all(
      payrollRun.payslips.map((payslip) =>
        notifyEmployee(payslip.employeeId, {
          title: 'Payslip available',
          message: `Your payslip for ${payrollRun.periodMonth}/${payrollRun.periodYear} is ready to download.`,
          type: 'payroll',
          link: '/dashboard/payroll',
        })
      )
    );

    await logAudit(req.user.id, 'FINALIZE_PAYROLL_RUN', 'PayrollRun', id, {
      payslips: payrollRun.payslips.length,
      failures: failures.length,
    });

    res.json({
      message: 'Payroll run finalized.',
      payrollRun: updatedRun,
      payslipsProcessed: payrollRun.payslips.length,
      // Surface archival failures instead of only console.error-ing them.
      storageFailures: failures,
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

exports.getPayrollRuns = async (req, res, next) => {
  try {
    const runs = await prisma.payrollRun.findMany({
      include: { _count: { select: { payslips: true } } },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
    });

    // Total cost per run, so the dashboard can show real payroll expense rather
    // than the hard-coded 450000 placeholder it used to display.
    const totals = await prisma.payslip.groupBy({
      by: ['payrollRunId'],
      _sum: { netPay: true },
    });
    const totalByRun = new Map(totals.map((t) => [t.payrollRunId, t._sum.netPay || 0]));

    res.json(
      runs.map((run) => ({
        ...run,
        payslipCount: run._count.payslips,
        totalNetPay: round(totalByRun.get(run.id) || 0),
      }))
    );
  } catch (err) {
    next(err);
  }
};

exports.getPayslipsByRun = async (req, res, next) => {
  try {
    const { runId } = req.params;

    const payslips = await prisma.payslip.findMany({
      where: { payrollRunId: runId },
      include: {
        employee: { select: { id: true, fullName: true, employeeCode: true, designation: true } },
      },
      orderBy: { employee: { employeeCode: 'asc' } },
    });

    res.json(payslips);
  } catch (err) {
    next(err);
  }
};

exports.getMyPayslips = async (req, res, next) => {
  try {
    const payslips = await prisma.payslip.findMany({
      where: {
        employeeId: req.user.employee.id,
        payrollRun: { status: 'finalized' },
      },
      include: { payrollRun: true },
      orderBy: [{ payrollRun: { periodYear: 'desc' } }, { payrollRun: { periodMonth: 'desc' } }],
    });

    res.json(payslips);
  } catch (err) {
    next(err);
  }
};

/**
 * Stream a payslip PDF.
 *
 * Rendered on demand rather than served from a public storage URL, so the RBAC
 * check below is the only way to reach it.
 */
exports.getPayslipPdfFile = async (req, res, next) => {
  try {
    const { id } = req.params;

    const payslip = await prisma.payslip.findUnique({
      where: { id },
      include: {
        employee: {
          include: {
            user: { select: { role: true } },
            campaignMembers: { where: { status: 'active' }, include: { campaign: true } },
          },
        },
        payrollRun: true,
      },
    });

    if (!payslip) {
      return res.status(404).json({ error: 'Payslip not found' });
    }

    const isAdminRole = ['Admin', 'CEO', 'COO'].includes(req.user.role);
    const isOwn = req.user.employee?.id === payslip.employeeId;

    if (!isAdminRole && !isOwn) {
      return res.status(403).json({ error: 'Forbidden: Access denied' });
    }

    // Staff only see a payslip once the run is finalized; a draft can still change.
    if (!isAdminRole && payslip.payrollRun.status !== 'finalized') {
      return res.status(403).json({ error: 'This payslip has not been issued yet.' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="payslip-${payslip.employee.employeeCode}-${payslip.payrollRun.periodMonth}-${payslip.payrollRun.periodYear}.pdf"`
    );

    generatePayslipPdf(res, payslip, COMPANY);
  } catch (err) {
    next(err);
  }
};

/** Ad-hoc payslip for someone not in the system (contractor, correction, etc.). */
exports.generateManualPdf = async (req, res, next) => {
  try {
    const body = req.body;

    const payslip = {
      id: 'manual',
      generatedAt: new Date(),
      payrollRun: { periodMonth: body.periodMonth, periodYear: body.periodYear },
      periodMonth: body.periodMonth,
      periodYear: body.periodYear,
      baseSalary: body.baseSalary,
      spiffs: body.spiff,
      commission: body.commission,
      bonus: body.bonus,
      bonusNotes: body.bonusNotes,
      unpaidLeaveDeduction: body.absentsLatesDeduction,
      lateDeduction: 0,
      loansDeduction: body.loansDeduction,
      otherDeductions: body.otherDeductions,
      deductionNotes: body.deductionNotes,
      attendanceAllowance: body.attendanceAllowance,
      punctualityAllowance: body.punctualityAllowance,
      daysPresent: 0,
      daysInPeriod: 0,
      showups: 0,
      meetingsScheduled: 0,
      noShows: 0,
      netPay: round(
        body.baseSalary +
          body.attendanceAllowance +
          body.punctualityAllowance +
          body.spiff +
          body.commission +
          body.bonus -
          body.absentsLatesDeduction -
          body.loansDeduction -
          body.otherDeductions
      ),
      employee: {
        fullName: body.fullName,
        employeeCode: body.employeeCode,
        designation: body.designation || 'Staff',
        bankAccount: body.bankAccount || '',
        campaignMembers: [
          {
            role: body.isTeamLead ? 'team_lead' : 'sdr',
            campaign: { name: body.campaignName || 'Operations' },
          },
        ],
      },
    };

    await logAudit(req.user.id, 'GENERATE_MANUAL_PAYSLIP', 'Payslip', null, {
      fullName: body.fullName,
      employeeCode: body.employeeCode,
      periodMonth: body.periodMonth,
      periodYear: body.periodYear,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="payslip-${body.employeeCode}-manual.pdf"`
    );

    generatePayslipPdf(res, payslip, COMPANY);
  } catch (err) {
    next(err);
  }
};
