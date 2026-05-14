const BudgetPlan = require('../models/BudgetPlan');
const HttpError = require('../utils/httpError');
const { softDelete } = require('../utils/softDelete');

const getBudgetPlans = async (tenantId, period) => {
  const filter = { tenantId, isDeleted: false };
  if (period) filter.period = period;
  return await BudgetPlan.find(filter);
};

const createBudgetPlan = async (tenantId, data) => {
  const { category, period } = data;
  
  // Check if already exists
  const existing = await BudgetPlan.findOne({ tenantId, category, period, isDeleted: false });
  if (existing) {
    throw new HttpError('Bu kategori ve dönem için zaten bir bütçe planı var.', 400);
  }

  return await BudgetPlan.create({ tenantId, ...data });
};

const updateBudgetPlan = async (tenantId, id, data) => {
  const record = await BudgetPlan.findOneAndUpdate(
    { _id: id, tenantId, isDeleted: false },
    { $set: data },
    { new: true }
  );
  if (!record) throw new HttpError('Kayıt bulunamadı.', 404);
  return record;
};

const deleteBudgetPlan = async (tenantId, id) => {
  const record = await softDelete(BudgetPlan, { _id: id, tenantId });
  if (!record) throw new HttpError('Kayıt bulunamadı.', 404);
  return record;
};

module.exports = {
  getBudgetPlans,
  createBudgetPlan,
  updateBudgetPlan,
  deleteBudgetPlan
};
