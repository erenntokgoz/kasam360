const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Tenant = require('../models/Tenant');
const Transaction = require('../models/Transaction');
const Debt = require('../models/Debt');
const AuditLog = require('../models/AuditLog');
const Directory = require('../models/Directory');

const { authSchemas } = require('../utils/validation');

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

const register = async (req, res, next) => {
  try {
    const { error } = authSchemas.register.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    let { phoneNumber, password, shopName } = req.body;
    const phone = normalizePhone(phoneNumber);

    if (!isValidPhone(phone)) return res.status(400).json({ success: false, message: 'Geçersiz telefon formatı.' });

    const existingTenant = await Tenant.findOne({ phone });
    if (existingTenant) return res.status(409).json({ success: false, message: 'Bu telefon numarası zaten kayıtlı.' });

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const tenant = await Tenant.create({ phone, password: hashedPassword, businessName: shopName });

    const { accessToken, refreshToken } = generateTokens(tenant._id);
    return res.status(201).json({
      success: true,
      message: 'Kayıt başarılı.',
      token: accessToken,
      refreshToken,
      tenant: { id: tenant._id, phone: tenant.phone, businessName: tenant.businessName, subscriptionStatus: tenant.subscriptionStatus, isSetupComplete: tenant.isSetupComplete },
    });
  } catch (err) { next(err); }
};

const login = async (req, res, next) => {
  try {
    const { error } = authSchemas.login.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    let { phoneNumber, password } = req.body;
    const phone = normalizePhone(phoneNumber);

    const tenant = await Tenant.findOne({ phone }).select('+password');
    if (!tenant) return res.status(401).json({ success: false, message: 'Hatalı telefon numarası veya şifre.' });

    const isMatch = await bcrypt.compare(password, tenant.password);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Hatalı telefon numarası veya şifre.' });

    if (!tenant.isSetupComplete) {
      const hasData = await Promise.any([
        Transaction.exists({ tenantId: tenant._id, isDeleted: false }),
        Debt.exists({ tenantId: tenant._id, isDeleted: false })
      ]).catch(() => null);

      if (hasData) {
        tenant.isSetupComplete = true;
        await tenant.save();
      }
    }

    const { accessToken, refreshToken } = generateTokens(tenant._id);
    return res.status(200).json({
      success: true,
      message: 'Giriş başarılı.',
      token: accessToken,
      refreshToken,
      tenant: { id: tenant._id, phone: tenant.phone, businessName: tenant.businessName, subscriptionStatus: tenant.subscriptionStatus, isSetupComplete: tenant.isSetupComplete },
    });
  } catch (err) { next(err); }
};

const refresh = async (req, res, next) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(401).json({ success: false, message: 'Refresh token gerekli.' });
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const { accessToken, refreshToken: newRefresh } = generateTokens(decoded.tenantId);
    return res.status(200).json({ success: true, token: accessToken, refreshToken: newRefresh });
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Oturum süresi dolmuş veya geçersiz token.' });
  }
};

const deleteAccount = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const tenantId = req.tenantId;
    await session.withTransaction(async () => {
      await Transaction.deleteMany({ tenantId }).session(session);
      await Debt.deleteMany({ tenantId }).session(session);
      await AuditLog.deleteMany({ tenantId }).session(session);
      await Directory.deleteMany({ tenantId }).session(session);
      await Tenant.findByIdAndDelete(tenantId).session(session);
    });
    session.endSession();
    return res.status(200).json({ success: true, message: 'Hesabınız ve tüm verileriniz silindi.' });
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    next(err);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const { tenantId } = req;
    const { businessName, password } = req.body;
    const updates = {};
    if (businessName) updates.businessName = String(businessName).trim();
    if (password) {
      if (password.length < 6) return res.status(400).json({ success: false, message: 'Şifre en az 6 karakter olmalıdır.' });
      updates.password = await bcrypt.hash(password, SALT_ROUNDS);
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ success: false, message: 'Güncellenecek veri bulunamadı.' });

    const tenant = await Tenant.findByIdAndUpdate(tenantId, updates, { new: true });
    if (!tenant) return res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı.' });
    return res.status(200).json({
      success: true,
      message: 'Profil güncellendi.',
      tenant: { id: tenant._id, phone: tenant.phone, businessName: tenant.businessName, subscriptionStatus: tenant.subscriptionStatus, isSetupComplete: tenant.isSetupComplete },
    });
  } catch (err) { next(err); }
};

module.exports = { register, login, refresh, deleteAccount, updateProfile };
