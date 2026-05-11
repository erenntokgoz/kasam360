const Directory = require('../models/Directory');

// GET /api/directory?type=CONTACT|STAFF
const getDirectory = async (req, res, next) => {
  try {
    const { type } = req.query;
    const filter = { tenantId: req.tenantId };
    if (type) filter.type = type;
    const list = await Directory.find(filter).sort({ name: 1 });
    return res.status(200).json({ success: true, data: list });
  } catch (err) { next(err); }
};

const createEntry = async (req, res, next) => {
  try {
    const { name, type, role, totalPaid, totalBalance, lastTransactionDate } = req.body;
    if (!name || !type) return res.status(400).json({ success: false, message: 'İsim ve tip zorunludur.' });

    const trimmedName = name.trim();
    const escapedName = trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const existing = await Directory.findOne({ 
      tenantId: req.tenantId, 
      name: { $regex: new RegExp(`^${escapedName}$`, 'i') } 
    });

    if (existing) return res.status(400).json({ success: false, message: 'Bu isimde bir kayıt zaten mevcut.' });

    const newEntry = await Directory.create({
      tenantId: req.tenantId,
      name: trimmedName,
      type,
      role,
      totalPaid: totalPaid || 0,
      totalBalance: totalBalance || 0,
      lastTransactionDate
    });

    return res.status(201).json({ success: true, data: newEntry });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ success: false, message: 'Bu isimde bir kayıt zaten mevcut.' });
    next(err);
  }
};

const updateEntry = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    delete updates.tenantId;
    const ALLOWED_FIELDS = ['name', 'role', 'totalPaid', 'totalBalance', 'lastTransactionDate'];
    const safeUpdate = {};
    for (const field of ALLOWED_FIELDS) {
      if (updates[field] !== undefined) safeUpdate[field] = updates[field];
    }

    const entry = await Directory.findOneAndUpdate(
      { _id: id, tenantId: req.tenantId },
      { $set: safeUpdate },
      { new: true }
    );

    if (!entry) return res.status(404).json({ success: false, message: 'Kayıt bulunamadı.' });
    return res.status(200).json({ success: true, data: entry });
  } catch (err) { next(err); }
};

const deleteEntry = async (req, res, next) => {
  try {
    const { id } = req.params;
    const entry = await Directory.findOneAndDelete({ _id: id, tenantId: req.tenantId });
    if (!entry) return res.status(404).json({ success: false, message: 'Kayıt bulunamadı.' });
    return res.status(200).json({ success: true, message: 'Kayıt silindi.' });
  } catch (err) { next(err); }
};

module.exports = { getDirectory, createEntry, updateEntry, deleteEntry };
