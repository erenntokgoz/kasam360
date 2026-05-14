const softDelete = async (Model, query, extraUpdates = {}, options = {}) => {
  return await Model.findOneAndUpdate(
    query,
    { $set: { isDeleted: true, deletedAt: new Date(), ...extraUpdates } },
    { new: true, ...options }
  );
};
const softDeleteMany = async (Model, query, extraUpdates = {}, options = {}) => {
  return await Model.updateMany(
    query,
    { $set: { isDeleted: true, deletedAt: new Date(), ...extraUpdates } },
    options
  );
};
module.exports = { softDelete, softDeleteMany };
