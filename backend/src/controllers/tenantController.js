const Tenant = require('../models/Tenant');

/**
 * Update tenant setup data (opening balance, etc.)
 */
const updateSetup = async (req, res) => {
  try {
    const { tenantId } = req;
    const { openingBalance, openingDebts, openingReceivables } = req.body;

    const tenant = await Tenant.findByIdAndUpdate(
      tenantId,
      {
        openingBalance: Math.round(Number(openingBalance) || 0),
        openingDebts: Math.round(Number(openingDebts) || 0),
        openingReceivables: Math.round(Number(openingReceivables) || 0),
      },
      { new: true }
    );

    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Setup data updated successfully',
      data: {
        openingBalance: tenant.openingBalance,
        openingDebts: tenant.openingDebts,
        openingReceivables: tenant.openingReceivables,
      },
    });
  } catch (error) {
    console.error('[tenantController.updateSetup]', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = { updateSetup };
