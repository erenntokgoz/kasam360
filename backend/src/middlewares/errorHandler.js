/**
 * Global Error Handler Middleware
 * ──────────────────────────────────────────────────────────────────────────────
 * Desteklenen hata pattern'leri:
 *   1. HttpError (utils/httpError.js)    → err.statusCode + err.isOperational
 *   2. Object.assign(new Error, { httpStatus })  → err.httpStatus (legacy controller pattern)
 *   3. Mongoose ValidationError          → 400
 *   4. Mongoose CastError (bad ObjectId) → 400
 *   5. JWT TokenExpiredError             → 401
 *   6. JWT JsonWebTokenError             → 401
 *   7. MongoDB Duplicate Key (11000)     → 409
 *   8. Diğer tüm hatalar                → 500
 */
const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || err.httpStatus || 500;
  let message    = err.message || 'Sistemsel bir hata oluştu.';
  let isOperational = !!err.isOperational;

  // ── Mongoose Validation Error ─────────────────────────────────────────────
  if (err.name === 'ValidationError') {
    statusCode    = 400;
    message       = Object.values(err.errors).map((e) => e.message).join(', ');
    isOperational = true;
  }

  // ── Mongoose CastError (geçersiz ObjectId) ────────────────────────────────
  if (err.name === 'CastError' || err.name === 'BSONError') {
    statusCode    = 400;
    message       = 'Geçersiz kayıt kimliği formatı.';
    isOperational = true;
  }

  // ── JWT Hataları ──────────────────────────────────────────────────────────
  if (err.name === 'TokenExpiredError') {
    statusCode    = 401;
    message       = 'Oturum süresi dolmuştur. Lütfen yeniden giriş yapın.';
    isOperational = true;
  }

  if (err.name === 'JsonWebTokenError') {
    statusCode    = 401;
    message       = 'Geçersiz token.';
    isOperational = true;
  }

  // ── MongoDB Duplicate Key ─────────────────────────────────────────────────
  if (err.code === 11000) {
    statusCode    = 409;
    const field   = Object.keys(err.keyValue || {})[0] || 'kayıt';
    message       = `Bu ${field} zaten kayıtlı.`;
    isOperational = true;
  }

  // ── Geliştirme Ortamı: Tüm detayları dön ─────────────────────────────────
  if (process.env.NODE_ENV === 'development') {
    return res.status(statusCode).json({
      success: false,
      message,
      error: err,
      stack: err.stack,
    });
  }

  // ── Üretim Ortamı ─────────────────────────────────────────────────────────
  if (isOperational) {
    return res.status(statusCode).json({
      success: false,
      message,
    });
  }

  // Beklenmedik hatalar — hiçbir iç detay sızdırılmaz
  console.error('[errorHandler] Unexpected error 💥:', err);
  return res.status(500).json({
    success: false,
    message: 'Sistemsel bir hata oluştu. Lütfen tekrar deneyin.',
  });
};

module.exports = errorHandler;
