const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Tenant = require('../models/Tenant');
const Transaction = require('../models/Transaction');
const Debt = require('../models/Debt');
const AuditLog = require('../models/AuditLog');
const Directory = require('../models/Directory');
const HttpError = require('../utils/httpError');
const { softDelete, softDeleteMany } = require('../utils/softDelete');

const SALT_ROUNDS = 10;

const normalizePhone = (phone) => {
  if (!phone) return '';
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('00')) cleaned = cleaned.substring(2);
  if (cleaned.startsWith('0')) cleaned = cleaned.substring(1);
  if (!cleaned.startsWith('90') && cleaned.length === 10) cleaned = '90' + cleaned;
  return cleaned;
};

const isValidPhone = (phone) => {
  const n = normalizePhone(phone);
  return n.length >= 10 && n.length <= 15;
};

const generateTokens = (tenantId) => {
  const accessToken = jwt.sign({ tenantId }, process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET, { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m' });
  const refreshToken = jwt.sign({ tenantId }, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' });
  return { accessToken, refreshToken };
};

const register = async (data) => {
  let { phone, password, businessName } = data;
  const phoneNormalized = normalizePhone(phone);

  if (!isValidPhone(phoneNormalized)) {
    throw new HttpError('Geçersiz telefon formatı.', 400);
  }

  const existingTenant = await Tenant.findOne({ phone: phoneNormalized });
  if (existingTenant) {
    throw new HttpError('Bu telefon numarası zaten kayıtlı.', 409);
  }

  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
  const tenant = await Tenant.create({ phone: phoneNormalized, password: hashedPassword, businessName: businessName });

  const { accessToken, refreshToken } = generateTokens(tenant._id);
  return {
    token: accessToken,
    refreshToken,
    tenant: { id: tenant._id, phone: tenant.phone, businessName: tenant.businessName, subscriptionStatus: tenant.subscriptionStatus, isSetupComplete: tenant.isSetupComplete },
  };
};

const login = async (data) => {
  let { phone, password } = data;
  const phoneNormalized = normalizePhone(phone);

  const tenant = await Tenant.findOne({ phone: phoneNormalized }).select('+password');
  if (!tenant) {
    throw new HttpError('Hatalı telefon numarası veya şifre.', 401);
  }

  const isMatch = await bcrypt.compare(password, tenant.password);
  if (!isMatch) {
    throw new HttpError('Hatalı telefon numarası veya şifre.', 401);
  }

  if (!tenant.isSetupComplete) {
    const transactionExists = await Transaction.exists({ tenantId: tenant._id, isDeleted: false });
    const debtExists = await Debt.exists({ tenantId: tenant._id, isDeleted: false });
    
    if (transactionExists || debtExists) {
      tenant.isSetupComplete = true;
      await tenant.save();
    }
  }

  const { accessToken, refreshToken } = generateTokens(tenant._id);
  return {
    token: accessToken,
    refreshToken,
    tenant: { id: tenant._id, phone: tenant.phone, businessName: tenant.businessName, subscriptionStatus: tenant.subscriptionStatus, isSetupComplete: tenant.isSetupComplete },
  };
};

const refresh = async (refreshToken) => {
  if (!refreshToken) {
    throw new HttpError('Refresh token gerekli.', 401);
  }
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const { accessToken, refreshToken: newRefresh } = generateTokens(decoded.tenantId);
    return { token: accessToken, refreshToken: newRefresh };
  } catch (err) {
    throw new HttpError('Oturum süresi dolmuş veya geçersiz token.', 401);
  }
};

const deleteAccount = async (tenantId) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await softDeleteMany(Transaction, { tenantId }, {}, { session });
      await softDeleteMany(Debt, { tenantId }, {}, { session });
      await softDeleteMany(AuditLog, { tenantId }, {}, { session });
      await softDeleteMany(Directory, { tenantId }, {}, { session });
      await softDelete(Tenant, { _id: tenantId }, {}, { session });
    });
    session.endSession();
  } catch (err) {
    session.endSession();
    throw err;
  }
};

const updateProfile = async (tenantId, data) => {
  const { businessName, password } = data;
  const updates = {};
  if (businessName) updates.businessName = String(businessName).trim();
  if (password) {
    if (password.length < 6) {
      throw new HttpError('Şifre en az 6 karakter olmalıdır.', 400);
    }
    updates.password = await bcrypt.hash(password, SALT_ROUNDS);
  }
  if (Object.keys(updates).length === 0) {
    throw new HttpError('Güncellenecek veri bulunamadı.', 400);
  }

  const tenant = await Tenant.findByIdAndUpdate(tenantId, updates, { new: true });
  if (!tenant) {
    throw new HttpError('Kullanıcı bulunamadı.', 404);
  }
  return {
    tenant: { id: tenant._id, phone: tenant.phone, businessName: tenant.businessName, subscriptionStatus: tenant.subscriptionStatus, isSetupComplete: tenant.isSetupComplete },
  };
};

module.exports = {
  register,
  login,
  refresh,
  deleteAccount,
  updateProfile
};
