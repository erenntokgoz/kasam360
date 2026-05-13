const Joi = require('joi');

const authSchemas = {
  register: Joi.object({
    businessName: Joi.string().required(),
    phone: Joi.string().required(),
    password: Joi.string().min(6).required(),
  }).unknown(true),
  login: Joi.object({
    phone: Joi.string().required(),
    password: Joi.string().required(),
    rememberMe: Joi.boolean().default(false),
  }).unknown(true),
};

const transactionSchemas = {
  create: Joi.object({
    type: Joi.string().valid('INCOME', 'EXPENSE').required(),
    amount: Joi.number().integer().positive().required(),
    method: Joi.string().valid('CASH', 'POS', 'IBAN', 'VERESİYE').required(),
    category: Joi.string().allow('', null),
    description: Joi.string().allow('', null),
    transactionDate: Joi.date().iso().allow(null),
    syncId: Joi.string().allow('', null),
    relatedId: Joi.string().allow('', null),
    relatedType: Joi.string().valid('DEBT', 'RECURRING', 'STAFF', 'CONTACT', 'DIRECTORY').allow('', null),
    directoryId: Joi.string().allow('', null),
    directoryType: Joi.string().allow('', null),
  }).unknown(true),
};

const debtSchemas = {
  create: Joi.object({
    entityName: Joi.string().required(),
    type: Joi.string().valid('GIVEN', 'TAKEN').required(),
    totalAmount: Joi.number().integer().positive().required(),
    dueDate: Joi.date().iso().allow(null),
    syncId: Joi.string().allow('', null),
    description: Joi.string().allow('', null),
    isCash: Joi.boolean().default(false),
    relatedId: Joi.string().allow('', null),
    relatedType: Joi.string().valid('CONTACT', 'STAFF', 'DIRECTORY').allow('', null),
  }).unknown(true),
  pay: Joi.object({
    amount: Joi.number().integer().positive().required(),
    method: Joi.string().valid('CASH', 'POS', 'IBAN').allow('', null),
  }).unknown(true),
};

module.exports = { authSchemas, transactionSchemas, debtSchemas };