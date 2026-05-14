const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  console.error('[Error Handler]', err);

  res.status(err.statusCode).json({
    success: false,
    status: err.status,
    message: err.message,
    // instructions say maskeleme yasak, so maybe we send stack or just detailed message
    // Let's send stack as well if it's not production, or always send it if strictly "no masking"
    stack: err.stack
  });
};

module.exports = errorHandler;
