const mongoose = require('mongoose');
const Directory = require('../models/Directory');
const Transaction = require('../models/Transaction');
const Debt = require('../models/Debt');
const AuditLog = require('../models/AuditLog');

// GET /api/directory?type=CONTACT|STAFF
const getDirectory = async (req, res, next) => {
  try {
    const { type } = req.query;
    const filter = { tenantId: req.tenantId, isDeleted: false };
    if (type) filter.roles = type;

    const list = await Directory.find(filter).sort({ name: 1 }).lean();

    // Map output to ensure frontend compatibility
    const formattedList = list.map(item => ({
      ...item,
      id: item._id.toString(),
      totalPaid: item.totalPaid || 0,
      totalBalance: item.balance || 0, // Computed as totalReceivable - totalDebt in hooks
      type: item.roles && item.roles.length > 0 ? item.roles[0] : 'CONTACT'
    }));

    return res.status(200).json({ success: true, data: formattedList });
  } catch (err) { next(err); }
};

const createEntry = async (req, res, next) => {
  try {
    const { name, type, role, lastTransactionDate } = req.body;
    if (!name || !type) return res.status(400).json({ success: false, message: 'İsim ve tip zorunludur.' });

    const trimmedName = name.trim();
    const escapedName = trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Eğer isimde zaten bir kayıt varsa, sadece yeni rolü ekle
    let entry = await Directory.findOne({ 
      tenantId: req.tenantId, 
      name: { $regex: new RegExp(`^${escapedName}$`, 'i') },
      isDeleted: false
    });

    if (entry) {
      if (!entry.roles.includes(type)) {
        entry.roles.push(type);
        if (role && type === 'STAFF') entry.role = role;
        await entry.save();
      }
      return res.status(200).json({ success: true, data: entry });
    }

    const newEntry = await Directory.create({
      tenantId: req.tenantId,
      name: trimmedName,
      roles: [type],
      role: type === 'STAFF' ? role : undefined,
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
    const ALLOWED_FIELDS = ['name', 'role', 'lastTransactionDate'];
    const safeUpdate = {};
    for (const field of ALLOWED_FIELDS) {
      if (updates[field] !== undefined) safeUpdate[field] = updates[field];
    }

    const entry = await Directory.findOneAndUpdate(
      { _id: id, tenantId: req.tenantId, isDeleted: false },
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
    const entry = await Directory.findOneAndUpdate(
      { _id: id, tenantId: req.tenantId, isDeleted: false },
      { $set: { isDeleted: true, name: `${id}_deleted_${Date.now()}` } }, // Prevent unique index collision
      { new: true }
    );
    if (!entry) return res.status(404).json({ success: false, message: 'Kayıt bulunamadı.' });

    // Add Audit Log
    await AuditLog.create({
      tenantId: req.tenantId,
      action: 'DELETE',
      entityType: 'DIRECTORY',
      entityId: entry._id,
      changes: { message: `Rehberden ${entry.name.split('_deleted_')[0] === id ? entry.name : 'bir kişi'} silindi.` }
    });

    return res.status(200).json({ success: true, message: 'Kayıt silindi.' });
  } catch (err) { next(err); }
};

module.exports = { getDirectory, createEntry, updateEntry, deleteEntry };
