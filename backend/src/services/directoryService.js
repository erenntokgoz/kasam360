const mongoose = require('mongoose');
const Directory = require('../models/Directory');
const HttpError = require('../utils/httpError');
const { softDelete } = require('../utils/softDelete');
const AuditLog = require('../models/AuditLog');

const getDirectory = async (tenantId, type) => {
  if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
    throw new HttpError('Geçersiz Tenant ID', 400);
  }

  const tenantObjectId = new mongoose.Types.ObjectId(tenantId);
  const filter = { tenantId: tenantObjectId, isDeleted: false };
  if (type) filter.roles = type;

  try {
    const list = await Directory.aggregate([
      { $match: filter },
      {
        $lookup: {
          from: 'transactions',
          let: { dirId: '$_id' },
          pipeline: [
            {
              $match: {
                tenantId: tenantObjectId,
                isDeleted: false,
                type: 'EXPENSE',
                $expr: {
                  $or: [
                    { $eq: ['$directoryId', '$$dirId'] },
                    { $eq: ['$relatedId', '$$dirId'] }
                  ]
                }
              }
            },
            { $group: { _id: null, total: { $sum: '$amount' } } }
          ],
          as: 'payments'
        }
      },
      {
        $lookup: {
          from: 'debts',
          let: { dirId: '$_id' },
          pipeline: [
            {
              $match: {
                tenantId: tenantObjectId,
                isDeleted: false,
                $expr: { $eq: ['$relatedId', '$$dirId'] }
              }
            },
            {
              $group: {
                _id: '$type',
                totalRemaining: { $sum: '$remainingAmount' }
              }
            }
          ],
          as: 'debtBalances'
        }
      },
      {
        $addFields: {
          totalPaid: { $ifNull: [{ $arrayElemAt: ['$payments.total', 0] }, 0] },
          totalBalance: {
            $subtract: [
              { $reduce: { input: '$debtBalances', initialValue: 0, in: { $cond: [{ $eq: ['$$this._id', 'GIVEN'] }, { $add: ['$$value', '$$this.totalRemaining'] }, '$$value'] } } },
              { $reduce: { input: '$debtBalances', initialValue: 0, in: { $cond: [{ $eq: ['$$this._id', 'TAKEN'] }, { $add: ['$$value', '$$this.totalRemaining'] }, '$$value'] } } }
            ]
          }
        }
      },
      { $project: { payments: 0, debtBalances: 0 } },
      { $sort: { name: 1 } }
    ]);

    return list.map(item => ({
      ...item,
      id: item._id.toString(),
      type: item.roles && item.roles.length > 0 ? item.roles[0] : 'CONTACT'
    }));
  } catch (err) {
    console.error('[directoryService.getDirectory] Aggregate error:', err);
    throw new HttpError('Rehber verileri alınamadı', 500);
  }
};

const createEntry = async (tenantId, data) => {
  const { name, type, role, lastTransactionDate } = data;
  if (!name || !type) {
    throw new HttpError('İsim ve tip zorunludur.', 400);
  }

  const trimmedName = name.trim();
  const escapedName = trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  let entry = await Directory.findOne({ 
    tenantId, 
    name: { $regex: new RegExp(`^${escapedName}$`, 'i') },
    isDeleted: false
  });

  if (entry) {
    if (!entry.roles.includes(type)) {
      entry.roles.push(type);
      if (role && type === 'STAFF') entry.role = role;
      await entry.save();
    }
    return entry;
  }

  return await Directory.create({
    tenantId,
    name: trimmedName,
    roles: [type],
    role: type === 'STAFF' ? role : undefined,
    lastTransactionDate
  });
};

const updateEntry = async (tenantId, id, updates) => {
  delete updates.tenantId;
  const ALLOWED_FIELDS = ['name', 'role', 'lastTransactionDate'];
  const safeUpdate = {};
  for (const field of ALLOWED_FIELDS) {
    if (updates[field] !== undefined) safeUpdate[field] = updates[field];
  }

  const entry = await Directory.findOneAndUpdate(
    { _id: id, tenantId, isDeleted: false },
    { $set: safeUpdate },
    { new: true }
  );

  if (!entry) {
    throw new HttpError('Kayıt bulunamadı.', 404);
  }
  return entry;
};

const deleteEntry = async (tenantId, id) => {
  const entry = await softDelete(Directory, { _id: id, tenantId }, { name: `${id}_deleted_${Date.now()}` });
  
  if (!entry) {
    throw new HttpError('Kayıt bulunamadı.', 404);
  }

  await AuditLog.create({
    tenantId,
    action: 'DELETE',
    entityType: 'DIRECTORY',
    entityId: entry._id,
    changes: { message: `Rehberden ${entry.name.split('_deleted_')[0] === id ? entry.name : 'bir kişi'} silindi.` }
  });

  return entry;
};

module.exports = {
  getDirectory,
  createEntry,
  updateEntry,
  deleteEntry
};
