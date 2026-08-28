const { PrismaClient } = require('@prisma/client');
const { syncZKTeco } = require('../utils/zkteco');
const { processBatchPunches } = require('../utils/punchIngest');
const { logAudit } = require('../utils/audit');

const prisma = new PrismaClient();

exports.getAttendance = async (req, res, next) => {
  try {
    const { startDate, endDate, employeeId } = req.query;

    const where = {};
    
    // Date Range Filter
    if (startDate || endDate) {
      where.date = {};
      if (startDate) {
        where.date.gte = new Date(startDate);
      }
      if (endDate) {
        where.date.lte = new Date(endDate);
      }
    }

    if (['Employee', 'SDR'].includes(req.user.role)) {
      // Regular employees and SDRs can only see their own attendance
      if (!req.user.employee) {
        return res.status(400).json({ error: 'No employee profile linked to user.' });
      }
      where.employeeId = req.user.employee.id;
    } else if (req.user.role === 'Team Lead') {
      // Find active campaigns this TL leads
      const ledCampaigns = await prisma.campaignMember.findMany({
        where: { employeeId: req.user.employee?.id, role: 'team_lead', status: 'active' },
        select: { campaignId: true }
      });
      const campaignIds = ledCampaigns.map(c => c.campaignId);

      // Find active SDRs in these campaigns
      const sdrs = await prisma.campaignMember.findMany({
        where: { campaignId: { in: campaignIds }, status: 'active' },
        select: { employeeId: true }
      });
      const sdrIds = sdrs.map(s => s.employeeId);
      if (req.user.employee?.id) {
        sdrIds.push(req.user.employee.id);
      }

      if (employeeId) {
        if (!sdrIds.includes(employeeId)) {
          return res.status(403).json({ error: 'Access denied.' });
        }
        where.employeeId = employeeId;
      } else {
        where.employeeId = { in: sdrIds };
      }
    } else {
      // Admins/Directors can filter by any employee
      if (employeeId) {
        where.employeeId = employeeId;
      }
    }

    const records = await prisma.attendance.findMany({
      where,
      include: {
        employee: {
          select: { id: true, fullName: true, employeeCode: true, designation: true }
        }
      },
      orderBy: [
        { date: 'desc' },
        { checkIn: 'desc' }
      ]
    });

    res.json(records);
  } catch (err) {
    next(err);
  }
};

exports.getAttendanceSummary = async (req, res, next) => {
  try {
    const { employeeId, year, month } = req.query;
    
    if (!employeeId || !year || !month) {
      return res.status(400).json({ error: 'employeeId, year, and month are required' });
    }

    // RBAC check: standard Employees and SDRs can only see their own attendance summary
    if (['Employee', 'SDR'].includes(req.user.role) && req.user.employee?.id !== employeeId) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    // RBAC check: Team Leads can only see their own summary or the summary of employees on their led campaigns
    if (req.user.role === 'Team Lead' && req.user.employee?.id !== employeeId) {
      const ledCampaigns = await prisma.campaignMember.findMany({
        where: { employeeId: req.user.employee?.id, role: 'team_lead', status: 'active' },
        select: { campaignId: true }
      });
      const campaignIds = ledCampaigns.map(c => c.campaignId);
      
      const isMemberOfLedCampaign = await prisma.campaignMember.findFirst({
        where: {
          employeeId,
          campaignId: { in: campaignIds },
          status: 'active'
        }
      });

      if (!isMemberOfLedCampaign) {
        return res.status(403).json({ error: 'Access denied.' });
      }
    }

    const startOfMonth = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, 1));
    const endOfMonth = new Date(Date.UTC(parseInt(year), parseInt(month), 0));

    const records = await prisma.attendance.findMany({
      where: {
        employeeId,
        date: {
          gte: startOfMonth,
          lte: endOfMonth
        }
      }
    });

    // Compute metrics
    let present = 0;
    let lateCount = 0;
    let totalLateMinutes = 0;
    let halfDays = 0;
    let leaves = 0;
    let overtimeMinutes = 0;

    records.forEach(rec => {
      if (rec.status === 'present') present++;
      if (rec.status === 'half_day') halfDays++;
      if (rec.status === 'leave') leaves++;
      if (rec.late > 0) {
        lateCount++;
        totalLateMinutes += rec.late;
      }
      overtimeMinutes += rec.overtime;
    });

    res.json({
      employeeId,
      year: parseInt(year),
      month: parseInt(month),
      present,
      halfDays,
      leaves,
      lateCount,
      totalLateMinutes,
      overtimeMinutes,
      totalRecords: records.length
    });
  } catch (err) {
    next(err);
  }
};

exports.syncAttendance = async (req, res, next) => {
  try {
    const result = await syncZKTeco();
    
    await logAudit(req.user.id, 'SYNC_ZKTECO_ATTENDANCE', 'Attendance', null, result);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

exports.manualPunch = async (req, res, next) => {
  try {
    const { employeeId, date, status, checkIn, checkOut, note } = req.body;

    if (!employeeId || !date || !status) {
      return res.status(400).json({ error: 'employeeId, date, and status are required' });
    }

    const dateObj = new Date(date);
    const dateMidnight = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()));

    const checkInDate = checkIn ? new Date(checkIn) : null;
    const checkOutDate = checkOut ? new Date(checkOut) : null;

    // Calculate late minutes if check-in is manual
    let lateMins = 0;
    if (checkInDate) {
      const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
      const shiftStart = emp?.shiftStart || '09:30';
      const [sh, sm] = shiftStart.split(':').map(Number);
      const shiftStartMins = sh * 60 + sm;
      const checkInMins = checkInDate.getHours() * 60 + checkInDate.getMinutes();
      const diff = checkInMins - shiftStartMins;
      const grace = emp?.graceMinutes !== undefined ? emp.graceMinutes : 15;
      if (diff > grace) {
        lateMins = diff;
      }
    }

    const record = await prisma.attendance.upsert({
      where: {
        employeeId_date: {
          employeeId,
          date: dateMidnight
        }
      },
      create: {
        employeeId,
        date: dateMidnight,
        status,
        checkIn: checkInDate,
        checkOut: null,
        earlyDeparture: 0,
        overtime: 0,
        late: lateMins,
        note
      },
      update: {
        status,
        checkIn: checkInDate,
        checkOut: null,
        earlyDeparture: 0,
        overtime: 0,
        late: lateMins,
        note
      }
    });

    await logAudit(req.user.id, 'MANUAL_ATTENDANCE_PUNCH', 'Attendance', record.id, { status, date });
    res.json(record);
  } catch (err) {
    next(err);
  }
};

exports.receivePunches = async (req, res, next) => {
  try {
    const { punches } = req.body;
    if (!Array.isArray(punches)) {
      return res.status(400).json({ error: 'Payload must contain a "punches" array.' });
    }

    const result = await processBatchPunches(punches);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

