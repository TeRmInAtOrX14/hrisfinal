const prisma = require('../lib/prisma');

/**
 * Notification creation.
 *
 * The Notification model, the REST endpoints and the header bell in the UI all
 * existed, but nothing in the codebase ever wrote a row — the bell polled every
 * 45 seconds and was permanently empty. These helpers are called from the review
 * and payroll flows so staff actually hear about decisions on their requests.
 *
 * Delivery is best-effort: a notification failure must never roll back or fail
 * the action that triggered it.
 */
async function notify({ userId, title, message, type, link = null }) {
  if (!userId) return null;

  try {
    return await prisma.notification.create({
      data: { userId, title, message, type, link },
    });
  } catch (error) {
    console.error('[Notification Failure]:', error.message);
    return null;
  }
}

/** Notify by employee id — resolves the owning user account first. */
async function notifyEmployee(employeeId, payload) {
  if (!employeeId) return null;

  try {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { userId: true },
    });
    if (!employee) return null;
    return notify({ ...payload, userId: employee.userId });
  } catch (error) {
    console.error('[Notification Failure]:', error.message);
    return null;
  }
}

/** Fan out to every active admin — used for new requests awaiting review. */
async function notifyAdmins(payload) {
  try {
    const admins = await prisma.user.findMany({
      where: { role: { in: ['Admin', 'CEO', 'COO'] }, isActive: true },
      select: { id: true },
    });

    if (admins.length === 0) return 0;

    await prisma.notification.createMany({
      data: admins.map((admin) => ({
        userId: admin.id,
        title: payload.title,
        message: payload.message,
        type: payload.type,
        link: payload.link || null,
      })),
    });

    return admins.length;
  } catch (error) {
    console.error('[Notification Failure]:', error.message);
    return 0;
  }
}

const REQUEST_LABELS = {
  leave: 'Leave request',
  halfday: 'Half-day request',
  wfh: 'Work-from-home request',
  loan: 'Loan / advance request',
};

/** Standard "your request was approved/rejected" message. */
function reviewOutcome(kind, status, reviewNote) {
  const label = REQUEST_LABELS[kind] || 'Request';
  const verb = status === 'approved' ? 'approved' : 'rejected';
  return {
    title: `${label} ${verb}`,
    message: reviewNote
      ? `Your ${label.toLowerCase()} was ${verb}. Note: ${reviewNote}`
      : `Your ${label.toLowerCase()} was ${verb}.`,
    type: kind === 'loan' ? 'loan' : 'leave',
    link: '/dashboard/requests',
  };
}

module.exports = { notify, notifyEmployee, notifyAdmins, reviewOutcome, REQUEST_LABELS };
