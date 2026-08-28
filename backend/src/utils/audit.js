const prisma = require('../lib/prisma');

/** Keys that must never be written into an audit record. */
const REDACTED_KEYS = new Set([
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'refreshToken',
  'token',
  'idToken',
]);

function redact(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = REDACTED_KEYS.has(key) ? '[redacted]' : redact(val);
  }
  return out;
}

/**
 * Write an audit trail entry.
 *
 * `details` is a Json column, so the object is stored as JSON. The previous
 * version called JSON.stringify first, which stored a JSON *string* — the audit
 * viewer then had to parse the value back out, and any caller that passed a
 * plain object crashed the page. Credentials are stripped before writing;
 * employee updates were previously logged with the plaintext password included.
 *
 * Audit failures never interrupt the action being audited.
 *
 * @param {string|null} userId  Actor performing the action
 * @param {string} action       e.g. 'CREATE_EMPLOYEE', 'REVIEW_LEAVE_REQUEST'
 * @param {string} entityType   Model name, e.g. 'Employee'
 * @param {string|null} entityId
 * @param {object|null} details Serializable metadata
 */
async function logAudit(userId, action, entityType, entityId = null, details = null) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: userId || null,
        action,
        entityType,
        entityId,
        details: details ? redact(details) : undefined,
      },
    });
  } catch (error) {
    console.error('[Audit Log Failure]:', error.message);
  }
}

module.exports = { logAudit, redact };
