const mongoose = require('mongoose');

const budgetPlanSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  category: {
    type: String,
    required: true,
    trim: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    enum: ['TRY', 'USD', 'EUR', 'GBP'],
    default: 'TRY'
  },
  period: {
    type: String, // Format: YYYY-MM
    required: true,
    index: true
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: {
    type: Date,
    default: null
  },
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    default: null
  }
}, { timestamps: true });

// Unique per tenant, category and period
budgetPlanSchema.index({ tenantId: 1, category: 1, period: 1 }, { unique: true });

const BudgetPlan = mongoose.model('BudgetPlan', budgetPlanSchema);

module.exports = BudgetPlan;
