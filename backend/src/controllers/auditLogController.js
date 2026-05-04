const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');

const getAuditLogs = async (req, res) => {
  try {
    const tenantObjectId = new mongoose.Types.ObjectId(req.tenantId);
    
    const logs = await AuditLog.find({ tenantId: tenantObjectId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.status(200).json({
      success: true,
      data: logs,
    });
  } catch (error) {
    console.error('[auditLogController.getAuditLogs]', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error fetching audit logs.',
    });
  }
};

module.exports = { getAuditLogs };
