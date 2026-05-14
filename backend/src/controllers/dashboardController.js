'use strict';

const { getDashboardData } = require('../services/dashboardService');

/**
 * GET /api/dashboard
 *
 * Mevcut tenant için tüm analitik verilerini döner.
 * tenantId, requireAuth middleware'i tarafından req.tenantId'ye yazılır.
 */
const getDashboard = async (req, res) => {
  try {
    const tenantId = req.tenantId; // requireAuth middleware'inden gelir

    if (!tenantId) {
      return res.status(401).json({ success: false, message: 'Kimlik doğrulaması gerekli.' });
    }

    const data = await getDashboardData(tenantId);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    console.error('[DashboardController] getDashboard error:', err);

    // MongoDB ObjectId hataları
    if (err.name === 'BSONError' || err.name === 'CastError') {
      return res.status(400).json({ success: false, message: 'Geçersiz tenant kimliği.' });
    }

    return res.status(500).json({
      success: false,
      message: 'Dashboard verisi alınamadı. Lütfen tekrar deneyin.',
    });
  }
};

module.exports = { getDashboard };
