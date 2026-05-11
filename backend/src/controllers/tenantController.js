const Tenant = require('../models/Tenant');

/**
 * Update tenant setup data (opening balance, etc.)
 */
const updateSetup = async (req, res, next) => {
  try {
    const { tenantId } = req;
    const { openingBalance, openingDebts, openingReceivables } = req.body;

    const Transaction = require('../models/Transaction');
    const existingTx = await Transaction.findOne({ tenantId, isDeleted: false });
    
    if (existingTx) {
      return res.status(400).json({ 
        success: false, 
        message: 'İşlem kaydı olan hesaplarda başlangıç ayarları değiştirilemez. Lütfen önce işlemleri silin.' 
      });
    }

    const tenant = await Tenant.findByIdAndUpdate(
      tenantId,
      {
        openingBalance: Math.round(Number(openingBalance) || 0),
        openingDebts: Math.round(Number(openingDebts) || 0),
        openingReceivables: Math.round(Number(openingReceivables) || 0),
        currentBalance: Math.round(Number(openingBalance) || 0),
      },
      { new: true }
    );

    if (!tenant) return res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı.' });

    return res.status(200).json({
      success: true,
      message: 'Kurulum verileri güncellendi.',
      data: {
        openingBalance: tenant.openingBalance,
        openingDebts: tenant.openingDebts,
        openingReceivables: tenant.openingReceivables,
      },
    });
  } catch (err) { next(err); }
};

module.exports = { updateSetup };
