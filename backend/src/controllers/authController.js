const authService = require('../services/authService');
const { authSchemas } = require('../utils/validation');

const register = async (req, res, next) => {
  try {
    const { error } = authSchemas.register.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await authService.register(req.body);
    return res.status(201).json({
      success: true,
      message: 'Kayıt başarılı.',
      ...result
    });
  } catch (err) { next(err); }
};

const login = async (req, res, next) => {
  try {
    const { error } = authSchemas.login.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await authService.login(req.body);
    return res.status(200).json({
      success: true,
      message: 'Giriş başarılı.',
      ...result
    });
  } catch (err) { next(err); }
};

const refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    const result = await authService.refresh(refreshToken);
    return res.status(200).json({ success: true, ...result });
  } catch (err) { next(err); }
};

const deleteAccount = async (req, res, next) => {
  try {
    await authService.deleteAccount(req.tenantId);
    return res.status(200).json({ success: true, message: 'Hesabınız ve tüm verileriniz silindi.' });
  } catch (err) { next(err); }
};

const updateProfile = async (req, res, next) => {
  try {
    const result = await authService.updateProfile(req.tenantId, req.body);
    return res.status(200).json({
      success: true,
      message: 'Profil güncellendi.',
      ...result
    });
  } catch (err) { next(err); }
};

module.exports = { register, login, refresh, deleteAccount, updateProfile };
