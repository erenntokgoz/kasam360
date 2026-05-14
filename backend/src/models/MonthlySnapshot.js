const mongoose = require('mongoose');

const monthlySnapshotSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  month: {
    type: String, // Format: YYYY-MM
    required: true,
    index: true
  },
  data: {
    type: mongoose.Schema.Types.Mixed, // Can store transactions, debts summary etc.
    required: true
  },
  isDeleted: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

// Unique per tenant and month
monthlySnapshotSchema.index({ tenantId: 1, month: 1 }, { unique: true });

const MonthlySnapshot = mongoose.model('MonthlySnapshot', monthlySnapshotSchema);

module.exports = MonthlySnapshot;
