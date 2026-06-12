const Tenant = require('../models/Tenant');

/**
 * Subscription Guard Middleware
 * ──────────────────────────────────────────────────────────────────────────────
 * requireAuth middleware'inden sonra çalışır (req.tenantId hazır olmalı).
 *
 * Geçerli durumlar: TRIAL, ACTIVE
 * Bloke edilen durumlar: EXPIRED, SUSPENDED
 *
 * TRIAL kullanıcıları erişebilir; premium limit kontrolü ilerleyen versiyonda eklenebilir.
 */
const requireSubscription = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.tenantId)
      .select('subscriptionStatus isDeleted')
      .lean();

    if (!tenant || tenant.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Hesap bulunamadı.',
      });
    }

    if (tenant.subscriptionStatus === 'SUSPENDED') {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_SUSPENDED',
        message: 'Hesabınız askıya alınmıştır. Destek ekibiyle iletişime geçin.',
      });
    }

    if (tenant.subscriptionStatus === 'EXPIRED') {
      return res.status(403).json({
        success: false,
        code: 'SUBSCRIPTION_EXPIRED',
        message: 'Aboneliğiniz sona ermiştir. Lütfen planınızı yenileyin.',
      });
    }

    // TRIAL veya ACTIVE → devam et
    next();
  } catch (error) {
    console.error('[subscriptionMiddleware]', error);
    return res.status(500).json({
      success: false,
      message: 'Abonelik doğrulaması sırasında bir hata oluştu.',
    });
  }
};

module.exports = { requireSubscription };
