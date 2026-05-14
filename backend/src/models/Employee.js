const mongoose = require('mongoose');
const employeeSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  name: { type: String, required: true },
  tcKimlikNo: { type: String, default: null },
  phone: { type: String, default: null },
  address: { type: String, default: null },
  hireDate: { type: Date, default: Date.now },
  position: { type: String, default: 'Personel' },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', default: null }
}, { timestamps: true });
module.exports = mongoose.model('Employee', employeeSchema);
