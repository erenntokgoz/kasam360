const softDelete = async (model, query, extraUpdates = {}, options = {}) => {
  return await model.findOneAndUpdate(
    { ...query, isDeleted: false },
    { $set: { isDeleted: true, deletedAt: new Date(), ...extraUpdates } },
    { new: true, ...options }
  );
};

const softDeleteMany = async (model, query, extraUpdates = {}, options = {}) => {
  return await model.updateMany(
    { ...query, isDeleted: false },
    { $set: { isDeleted: true, deletedAt: new Date(), ...extraUpdates } },
    options
  );
};

module.exports = { softDelete, softDeleteMany };
