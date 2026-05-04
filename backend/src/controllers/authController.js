const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Tenant = require('../models/Tenant');

const SALT_ROUNDS = 12;
const JWT_EXPIRES_IN = '30d';

const isValidPhone = (phone) => {
  if (!phone || phone.length < 10) return false;
  return /^[+0-9]+$/.test(phone);
};

/**
 * Generates a signed JWT for a given tenant.
 * @param {string} tenantId - The MongoDB ObjectId of the tenant.
 * @returns {string} Signed JWT string.
 */
const generateTokens = (tenantId) => {
  const accessToken = jwt.sign(
    { tenantId },
    process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m' }
  );

  const refreshToken = jwt.sign(
    { tenantId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );

  return { accessToken, refreshToken };
};

// ─────────────────────────────────────────────
// @route   POST /api/auth/register
// @access  Public
// ─────────────────────────────────────────────
const register = async (req, res) => {
  const { phone, password } = req.body || {};
  if (!phone || !/^\+?[0-9]{10,15}$/.test(phone)) {
    return res.status(400).json({ success: false, message: 'Geçerli bir telefon numarası girin.' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ success: false, message: 'Şifre en az 6 karakter olmalı.' });
  }
  try {
    const { phone, password, businessName } = req.body;

    // --- Validation ---
    if (!phone || !password || !businessName) {
      return res.status(400).json({
        success: false,
        message: 'Phone, password, and business name are required.',
      });
    }

    if (!isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone format.',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters.',
      });
    }

    // --- Duplicate check ---
    const existingTenant = await Tenant.findOne({ phone });
    if (existingTenant) {
      return res.status(409).json({
        success: false,
        message: 'A tenant with this phone number already exists.',
      });
    }

    // --- Hash password ---
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // --- Create tenant ---
    const tenant = await Tenant.create({
      phone,
      password: hashedPassword,
      businessName,
    });

    const { accessToken, refreshToken } = generateTokens(tenant._id);

    return res.status(201).json({
      success: true,
      message: 'Tenant registered successfully.',
      token: accessToken,
      refreshToken,
      tenant: {
        id: tenant._id,
        phone: tenant.phone,
        businessName: tenant.businessName,
        subscriptionStatus: tenant.subscriptionStatus,
      },
    });
  } catch (error) {
    console.error('[authController.register]', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during registration.',
    });
  }
};

// ─────────────────────────────────────────────
// @route   POST /api/auth/login
// @access  Public
// ─────────────────────────────────────────────
const login = async (req, res) => {
  const { phone, password } = req.body || {};
  if (!phone || !password) {
    return res.status(400).json({ success: false, message: 'Telefon ve şifre gerekli.' });
  }
  try {
    const { phone, password } = req.body;

    // --- Validation ---
    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'Phone and password are required.',
      });
    }

    if (!isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone format.',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters.',
      });
    }

    // --- Find tenant (explicitly select password since it has select:false) ---
    const tenant = await Tenant.findOne({ phone }).select('+password');
    if (!tenant) {
      console.warn(`[BRUTE FORCE KORUMASI] Başarısız giriş denemesi: Bulunamayan telefon numarası: ${phone}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials.',
      });
    }

    // --- Compare password ---
    const isMatch = await bcrypt.compare(password, tenant.password);
    if (!isMatch) {
      console.warn(`[BRUTE FORCE KORUMASI] Başarısız giriş denemesi: Yanlış şifre (Telefon: ${phone})`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials.',
      });
    }

    const { accessToken, refreshToken } = generateTokens(tenant._id);

    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      token: accessToken,
      refreshToken,
      tenant: {
        id: tenant._id,
        phone: tenant.phone,
        businessName: tenant.businessName,
        subscriptionStatus: tenant.subscriptionStatus,
      },
    });
  } catch (error) {
    console.error('[authController.login]', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during login.',
    });
  }
};

// ─────────────────────────────────────────────
// @route   POST /api/auth/refresh-token
// @access  Public
// ─────────────────────────────────────────────
const refresh = async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(401).json({
      success: false,
      message: 'Refresh token is required.',
    });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    
    // Create new access token
    const accessToken = jwt.sign(
      { tenantId: decoded.tenantId },
      process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m' }
    );

    return res.status(200).json({
      success: true,
      token: accessToken,
    });
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired refresh token.',
    });
  }
};

module.exports = { register, login, refresh };
