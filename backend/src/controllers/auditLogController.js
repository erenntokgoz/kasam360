const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');

const getAuditLogs = async (req, res, next) => {
  try {
    const tenantObjectId = new mongoose.Types.ObjectId(req.tenantId);
    
    const logs = await AuditLog.find({ tenantId: tenantObjectId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.status(200).json({ success: true, data: logs });
  } catch (err) { next(err); }
};

module.exports = { getAuditLogs };
