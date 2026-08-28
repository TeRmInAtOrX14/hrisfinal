const prisma = require('../lib/prisma');
const { verifyAccessToken } = require('../utils/jwt');

/**
 * Authenticate the caller and attach the live user record to `req.user`.
 *
 * The user is re-read on every request rather than trusted from the token, so
 * deactivating an account or changing a role takes effect immediately instead of
 * at token expiry.
 */
const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid token' });
    }

    const token = authHeader.slice('Bearer '.length).trim();
    const decoded = verifyAccessToken(token);

    if (!decoded) {
      return res.status(401).json({ error: 'Token expired or invalid' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { employee: true },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Account disabled or deleted' });
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Block every request except the password change itself until a first-login
 * password has been replaced. Accounts created by an admin are issued a
 * password by that admin, so leaving them usable indefinitely means the admin
 * retains access to the employee's account.
 */
const requirePasswordChanged = (req, res, next) => {
  if (req.user?.mustChangePassword) {
    return res.status(403).json({
      error: 'You must change your password before using the system.',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
  }
  next();
};

const requireRole = (roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
  }

  next();
};

/** Routes that need an Employee record attached (attendance, requests, payslips). */
const requireEmployeeProfile = (req, res, next) => {
  if (!req.user?.employee) {
    return res.status(400).json({ error: 'No employee profile is linked to your account.' });
  }
  next();
};

module.exports = {
  requireAuth,
  requireRole,
  requirePasswordChanged,
  requireEmployeeProfile,
};
