const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { generateTokens, verifyRefreshToken } = require('../utils/jwt');
const { OAuth2Client } = require('google-auth-library');

const prisma = new PrismaClient();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * Handle Traditional Email & Password Login
 */
exports.login = async (req, res, next) => {
  try {
    console.log('Login request body:', req.body);
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Case-insensitive email lookup (emails stored with mixed case)
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      include: { employee: true }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid credentials or inactive account' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const { accessToken, refreshToken } = generateTokens(user);

    // Save refresh token
    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken }
    });

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
        employee: user.employee
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Handle Token Refreshing
 */
exports.refresh = async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }

    const decoded = verifyRefreshToken(token);
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { employee: true }
    });

    if (!user || user.refreshToken !== token || !user.isActive) {
      return res.status(401).json({ error: 'Token revoked or user inactive' });
    }

    const tokens = generateTokens(user);

    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: tokens.refreshToken }
    });

    res.json({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Handle Google SSO (OAuth2 Access Token flow)
 */
exports.googleLogin = async (req, res, next) => {
  try {
    const { email, googleId, name, picture } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Google account email is required' });
    }

    // Only allow pre-registered users — no auto-creation (case-insensitive match)
    let user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      include: { employee: true }
    });

    if (!user) {
      return res.status(403).json({
        error: 'Your Google account is not registered in the system. Contact your administrator.'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({ error: 'User account is inactive' });
    }

    // Link googleId if not already linked
    if (!user.googleId && googleId) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleId },
        include: { employee: true }
      });
    }

    const { accessToken, refreshToken } = generateTokens(user);

    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken }
    });

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        employee: user.employee
      }
    });
  } catch (err) {
    next(err);
  }
};


/**
 * Log out user (revoke refresh token)
 */
exports.logout = async (req, res, next) => {
  try {
    const { userId } = req.body;
    if (userId) {
      await prisma.user.update({
        where: { id: userId },
        data: { refreshToken: null }
      });
    }
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
};
