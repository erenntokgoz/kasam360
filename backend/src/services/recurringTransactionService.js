const RecurringTransaction = require('../models/RecurringTransaction');
const HttpError = require('../utils/httpError');
const { softDelete } = require('../utils/softDelete');

const getRecurringTransactions = async (tenantId) => {
  return await RecurringTransaction.find({ tenantId, isDeleted: false });
};

const createRecurringTransaction = async (tenantId, data) => {
  return await RecurringTransaction.create({ tenantId, ...data });
};

const updateRecurringTransaction = async (tenantId, id, data) => {
  const record = await RecurringTransaction.findOneAndUpdate(
    { _id: id, tenantId, isDeleted: false },
    { $set: data },
    { new: true }
  );
  if (!record) throw new HttpError('Kayıt bulunamadı.', 404);
  return record;
};

const deleteRecurringTransaction = async (tenantId, id) => {
  const record = await softDelete(RecurringTransaction, { _id: id, tenantId });
  if (!record) throw new HttpError('Kayıt bulunamadı.', 404);
  return record;
};

module.exports = {
  getRecurringTransactions,
  createRecurringTransaction,
  updateRecurringTransaction,
  deleteRecurringTransaction
};
