const Joi = require('joi');

const authSchemas = {
  register: Joi.object({
    shopName: Joi.string().required(),
    phoneNumber: Joi.string().required(),
    password: Joi.string().min(6).required(),
  }),
  login: Joi.object({
    phoneNumber: Joi.string().required(),
    password: Joi.string().required(),
    rememberMe: Joi.boolean().default(false),
  }),
};

const transactionSchemas = {
  create: Joi.object({
    type: Joi.string().valid('INCOME', 'EXPENSE').required(),
    amount: Joi.number().integer().positive().required(),
    method: Joi.string().valid('CASH', 'POS', 'IBAN').required(),
    category: Joi.string().allow('', null),
    description: Joi.string().allow('', null),
    transactionDate: Joi.date().iso().allow(null),
    syncId: Joi.string().allow('', null),
  }),
};

const debtSchemas = {
  create: Joi.object({
    entityName: Joi.string().required(),
    type: Joi.string().valid('GIVEN', 'TAKEN').required(),
    totalAmount: Joi.number().integer().positive().required(),
    dueDate: Joi.date().iso().allow(null),
    syncId: Joi.string().allow('', null),
  }),
  pay: Joi.object({
    amount: Joi.number().integer().positive().required(),
    method: Joi.string().valid('CASH', 'POS', 'IBAN').allow('', null),
  }),
};

module.exports = { authSchemas, transactionSchemas, debtSchemas };
