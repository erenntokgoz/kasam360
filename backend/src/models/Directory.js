const mongoose = require('mongoose');

const directorySchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['CONTACT', 'STAFF'],
      required: true,
    },
    role: {
      type: String, // Yalnızca STAFF için eklenebilir
    },
    totalPaid: {
      type: Number,
      default: 0, // Yalnızca STAFF için, sent cinsinden
    },
    totalBalance: {
      type: Number,
      default: 0, // CONTACT için, sent cinsinden
    },
    lastTransactionDate: {
      type: Date,
    },
  },
  { timestamps: true }
);

// Aynı tenant altında aynı isimde ve aynı tipte ikinci kişi olmasın
directorySchema.index({ tenantId: 1, name: 1, type: 1 }, { unique: true });

module.exports = mongoose.model('Directory', directorySchema);
