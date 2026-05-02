const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Tenant = require('../models/Tenant');

const SALT_ROUNDS = 12;
const JWT_EXPIRES_IN = '30d';

/**
 * Generates a signed JWT for a given tenant.
 * @param {string} tenantId - The MongoDB ObjectId of the tenant.
 * @returns {string} Signed JWT string.
 */
const generateToken = (tenantId) => {
  return jwt.sign({ tenantId }, process.env.JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
};

// ─────────────────────────────────────────────
// @route   POST /api/auth/register
// @access  Public
// ─────────────────────────────────────────────
const register = async (req, res) => {
  try {
    const { phone, password, businessName } = req.body;

    // --- Validation ---
    if (!phone || !password || !businessName) {
      return res.status(400).json({
        success: false,
        message: 'Phone, password, and business name are required.',
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

    const token = generateToken(tenant._id);

    return res.status(201).json({
      success: true,
      message: 'Tenant registered successfully.',
      token,
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
  try {
    const { phone, password } = req.body;

    // --- Validation ---
    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'Phone and password are required.',
      });
    }

    // --- Find tenant (explicitly select password since it has select:false) ---
    const tenant = await Tenant.findOne({ phone }).select('+password');
    if (!tenant) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials.',
      });
    }

    // --- Compare password ---
    const isMatch = await bcrypt.compare(password, tenant.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials.',
      });
    }

    const token = generateToken(tenant._id);

    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      token,
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

const updateProfile = async (req, res) => {
  try {
    const { tenantId } = req;
    const { businessName, password } = req.body;

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found.',
      });
    }

    if (businessName) {
      tenant.businessName = businessName;
    }

    if (password) {
      tenant.password = await bcrypt.hash(password, SALT_ROUNDS);
    }

    await tenant.save();

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      tenant: {
        id: tenant._id,
        phone: tenant.phone,
        businessName: tenant.businessName,
        subscriptionStatus: tenant.subscriptionStatus,
      },
    });
  } catch (error) {
    console.error('[authController.updateProfile]', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error updating profile.',
    });
  }
};

module.exports = { register, login, updateProfile };
