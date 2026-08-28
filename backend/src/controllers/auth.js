const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');

const prisma = require('../lib/prisma');
const config = require('../config/env');
const { generateTokens, verifyRefreshToken } = require('../utils/jwt');
const { logAudit } = require('../utils/audit');

const googleClient = config.googleClientId ? new OAuth2Client(config.googleClientId) : null;

/** Shape the user object sent to the client. Never leak passwordHash/refreshToken. */
function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    employee: user.employee
      ? {
          id: user.employee.id,
          employeeCode: user.employee.employeeCode,
          fullName: user.employee.fullName,
          designation: user.employee.designation,
          photoUrl: user.employee.photoUrl,
        }
      : null,
  };
}

async function issueSession(user) {
  const { accessToken, refreshToken } = generateTokens(user);
  await prisma.user.update({ where: { id: user.id }, data: { refreshToken } });
  return { accessToken, refreshToken, user: toPublicUser(user) };
}

/**
 * Email + password login.
 *
 * The same generic message is returned for "no such user", "wrong password" and
 * "deactivated" so the endpoint cannot be used to enumerate staff emails.
 */
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      include: { employee: true },
    });

    // Always run a comparison so the response time does not reveal whether the
    // account exists.
    const passwordHash = user ? user.passwordHash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const isMatch = await bcrypt.compare(password, passwordHash);

    if (!user || !isMatch || !user.isActive) {
      return res.status(401).json({ error: 'Invalid credentials or inactive account.' });
    }

    res.json(await issueSession(user));
  } catch (err) {
    next(err);
  }
};

/**
 * Rotate an access/refresh token pair.
 *
 * The presented token must still be the one stored on the user, so a refresh
 * token that has already been rotated (or revoked by logout) is rejected.
 */
exports.refresh = async (req, res, next) => {
  try {
    const { token } = req.body;

    const decoded = verifyRefreshToken(token);
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { employee: true },
    });

    if (!user || user.refreshToken !== token || !user.isActive) {
      return res.status(401).json({ error: 'Token revoked or user inactive' });
    }

    res.json(await issueSession(user));
  } catch (err) {
    next(err);
  }
};

/**
 * Google SSO.
 *
 * This endpoint previously trusted the `email` field in the request body and
 * issued tokens for whatever address was posted — an unauthenticated caller
 * could sign in as any user, including Admin. The identity now comes only from
 * a Google ID token verified against our own client ID; nothing else in the
 * body is used to decide who the caller is.
 */
exports.googleLogin = async (req, res, next) => {
  try {
    if (!googleClient) {
      return res.status(503).json({
        error: 'Google sign-in is not configured on this server (GOOGLE_CLIENT_ID missing).',
      });
    }

    const { idToken } = req.body;

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: config.googleClientId,
      });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired Google credential.' });
    }

    if (!payload?.email || !payload.email_verified) {
      return res.status(401).json({ error: 'Google account has no verified email address.' });
    }

    // Pre-registered accounts only — signing in never creates a user.
    const existing = await prisma.user.findFirst({
      where: { email: { equals: payload.email, mode: 'insensitive' } },
      include: { employee: true },
    });

    if (!existing) {
      return res.status(403).json({
        error: 'Your Google account is not registered in the system. Contact your administrator.',
      });
    }

    if (!existing.isActive) {
      return res.status(401).json({ error: 'User account is inactive' });
    }

    let user = existing;
    if (!user.googleId && payload.sub) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleId: payload.sub },
        include: { employee: true },
      });
    } else if (user.googleId && payload.sub && user.googleId !== payload.sub) {
      // The address matches a staff account but the Google identity behind it
      // changed — refuse rather than silently re-binding the account.
      return res.status(403).json({ error: 'This email is linked to a different Google account.' });
    }

    res.json(await issueSession(user));
  } catch (err) {
    next(err);
  }
};

/**
 * Change your own password.
 *
 * `mustChangePassword` has existed on the User model since the first migration
 * and is set for every account created through the admin UI, but there was no
 * endpoint to clear it — new staff had no way to change the password they were
 * assigned. Changing it also revokes the refresh token, signing out other
 * devices.
 */
exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      return res.status(400).json({ error: 'New password must be different from the current one.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, await bcrypt.genSalt(12));

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false, refreshToken: null },
    });

    await logAudit(user.id, 'CHANGE_PASSWORD', 'User', user.id);

    res.json({
      message: 'Password changed successfully. Please sign in again.',
    });
  } catch (err) {
    next(err);
  }
};

/** Return the caller's own profile — the source of truth for the client's cached user. */
exports.me = async (req, res, next) => {
  try {
    res.json(toPublicUser(req.user));
  } catch (err) {
    next(err);
  }
};

/**
 * Log out.
 *
 * The user id comes from the authenticated token, not the request body. The old
 * version revoked whatever `userId` was posted, so any caller could sign out any
 * employee.
 */
exports.logout = async (req, res, next) => {
  try {
    await prisma.user.update({
      where: { id: req.user.id },
      data: { refreshToken: null },
    });
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
};
