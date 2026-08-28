const prisma = require('../lib/prisma');
const { logAudit } = require('../utils/audit');
const { notifyEmployee } = require('../utils/notify');
const { canAccessEmployee, isAdmin } = require('../utils/scope');

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

exports.getNotifications = async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100);

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      prisma.notification.count({ where: { userId: req.user.id, isRead: false } }),
    ]);

    // The bell needs the unread total, not just the unread rows in this page.
    res.json({ notifications, unreadCount });
  } catch (err) {
    next(err);
  }
};

exports.markAsRead = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Scope the write itself so another user's notification cannot be touched.
    const result = await prisma.notification.updateMany({
      where: { id, userId: req.user.id },
      data: { isRead: true },
    });

    if (result.count === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ message: 'Notification marked as read' });
  } catch (err) {
    next(err);
  }
};

exports.markAllAsRead = async (req, res, next) => {
  try {
    const result = await prisma.notification.updateMany({
      where: { userId: req.user.id, isRead: false },
      data: { isRead: true },
    });
    res.json({ message: 'All notifications marked as read', updated: result.count });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

exports.getAuditLogs = async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const cursor = req.query.cursor;
    const { action, entityType, userId } = req.query;

    const where = {};
    if (action) where.action = action;
    if (entityType) where.entityType = entityType;
    if (userId) where.userId = userId;

    const logs = await prisma.auditLog.findMany({
      where,
      include: { user: { select: { email: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    // Keyset pagination: the old endpoint hard-capped at 200 rows with no way to
    // reach anything older, which makes an audit trail close to useless.
    const hasMore = logs.length > limit;
    const page = hasMore ? logs.slice(0, limit) : logs;

    res.json({
      logs: page,
      nextCursor: hasMore ? page[page.length - 1].id : null,
      hasMore,
    });
  } catch (err) {
    next(err);
  }
};

/** Distinct action names, so the audit UI can offer a real filter dropdown. */
exports.getAuditActions = async (req, res, next) => {
  try {
    const rows = await prisma.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    });
    res.json(rows.map((r) => r.action));
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Spiffs
// ---------------------------------------------------------------------------

/**
 * Award a one-off spiff.
 *
 * The Spiff model feeds payroll and the schema has always supported it, but no
 * route ever created one, so the "Earned Spiffs" figure on the SDR dashboard
 * could only ever read zero.
 */
exports.createSpiff = async (req, res, next) => {
  try {
    const { employeeId, amount, reason, date } = req.body;

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, fullName: true },
    });

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const spiff = await prisma.spiff.create({
      data: {
        employeeId,
        givenById: req.user.id,
        amount,
        reason,
        date: date ? new Date(date) : new Date(),
      },
    });

    await logAudit(req.user.id, 'AWARD_SPIFF', 'Spiff', spiff.id, { employeeId, amount, reason });
    await notifyEmployee(employeeId, {
      title: 'Spiff awarded',
      message: reason
        ? `You were awarded a spiff of ${amount.toLocaleString('en-PK')}: ${reason}`
        : `You were awarded a spiff of ${amount.toLocaleString('en-PK')}.`,
      type: 'payroll',
      link: '/dashboard',
    });

    res.status(201).json(spiff);
  } catch (err) {
    next(err);
  }
};

exports.getSpiffs = async (req, res, next) => {
  try {
    const { employeeId, month, year } = req.query;

    const where = {};

    if (employeeId) {
      if (!(await canAccessEmployee(req.user, employeeId))) {
        return res.status(403).json({ error: 'Access denied.' });
      }
      where.employeeId = employeeId;
    } else if (!isAdmin(req.user)) {
      if (!req.user.employee) {
        return res.status(400).json({ error: 'No employee profile is linked to your account.' });
      }
      where.employeeId = req.user.employee.id;
    }

    if (month && year) {
      where.date = {
        gte: new Date(Date.UTC(Number(year), Number(month) - 1, 1)),
        lte: new Date(Date.UTC(Number(year), Number(month), 0, 23, 59, 59)),
      };
    }

    const spiffs = await prisma.spiff.findMany({
      where,
      include: {
        employee: { select: { id: true, fullName: true, employeeCode: true } },
        givenBy: { select: { email: true } },
      },
      orderBy: { date: 'desc' },
      take: 200,
    });

    res.json(spiffs);
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Scheduled jobs
// ---------------------------------------------------------------------------

// One pull at a time. Cron has no idea whether the previous run finished, and
// a slow device must not stack overlapping syncs on top of each other.
let syncRunning = false;

/**
 * Direct TCP pull from the ZKTeco device, triggered externally.
 *
 * This replaces the setInterval that used to run inside the listen callback:
 * Passenger idles the Node process between requests on cPanel, so in-app
 * timers do not fire reliably. Authenticated by the sync-agent token.
 *
 * Only meaningful where the API can actually reach the device — i.e. running
 * on the office LAN. On shared hosting it cannot, which is why
 * ENABLE_DIRECT_ZK_SYNC gates it and the office sync-agent pushing to
 * /api/attendance/punches stays the real ingestion path.
 */
exports.runBiometricSync = async (req, res, next) => {
  if (process.env.ENABLE_DIRECT_ZK_SYNC !== 'true') {
    return res.status(503).json({
      error: 'Direct ZKTeco sync is disabled. Set ENABLE_DIRECT_ZK_SYNC=true on a host that can reach the device.',
    });
  }

  if (syncRunning) {
    return res.status(409).json({ error: 'A sync is already running.' });
  }

  syncRunning = true;
  try {
    const { syncZKTeco } = require('../utils/zkteco');
    const result = await syncZKTeco();

    console.log(
      `[Scheduler] Synced ${result.synced}, skipped ${result.skipped}, errors ${result.errors.length}`
    );

    res.json({
      synced: result.synced,
      skipped: result.skipped,
      errors: result.errors,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  } finally {
    syncRunning = false;
  }
};
