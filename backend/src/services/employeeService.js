const Employee = require('../models/Employee');
const HttpError = require('../utils/httpError');
const { softDelete } = require('../utils/softDelete');

const getEmployees = async (tenantId) => {
  return await Employee.find({ tenantId, isDeleted: false });
};

const getEmployeeById = async (tenantId, id) => {
  const employee = await Employee.findOne({ _id: id, tenantId, isDeleted: false });
  if (!employee) {
    throw new HttpError('Personel bulunamadı.', 404);
  }
  return employee;
};

const createEmployee = async (tenantId, data) => {
  const { tcKimlikNo, phone, address, hireDate, position } = data;
  
  // Check if already exists
  const existing = await Employee.findOne({ tenantId, tcKimlikNo, isDeleted: false });
  if (existing) {
    throw new HttpError('Bu TC Kimlik No ile kayıtlı personel zaten var.', 400);
  }

  return await Employee.create({
    tenantId,
    tcKimlikNo,
    phone,
    address,
    hireDate,
    position
  });
};

const updateEmployee = async (tenantId, id, data) => {
  const employee = await Employee.findOneAndUpdate(
    { _id: id, tenantId, isDeleted: false },
    { $set: data },
    { new: true }
  );

  if (!employee) {
    throw new HttpError('Personel bulunamadı.', 404);
  }
  return employee;
};

const deleteEmployee = async (tenantId, id) => {
  const employee = await softDelete(Employee, { _id: id, tenantId });
  if (!employee) {
    throw new HttpError('Personel bulunamadı.', 404);
  }
  return employee;
};

module.exports = {
  getEmployees,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  deleteEmployee
};
