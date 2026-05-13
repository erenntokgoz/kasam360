const dotenv = require('dotenv');
dotenv.config();

// Assert required environment variables
const REQUIRED_ENV = ['JWT_SECRET', 'MONGO_URI', 'JWT_REFRESH_SECRET'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`[CRITICAL] Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const connectDB = require('./src/config/db');
const authRoutes = require('./src/routes/authRoutes');
const ocrRoutes = require('./src/routes/ocrRoutes');
const transactionRoutes = require('./src/routes/transactionRoutes');
const debtRoutes = require('./src/routes/debtRoutes');
const auditLogRoutes = require('./src/routes/auditLogRoutes');
const tenantRoutes = require('./src/routes/tenantRoutes');
const directoryRoutes = require('./src/routes/directoryRoutes');

const app = express();

app.disable('x-powered-by');

// ── Core Middleware ───────────────────────────────────────────────────────────
app.use(cors({ origin: ['com.kasam360.app://', 'http://localhost:3000'] }));
app.use(helmet());
app.use(mongoSanitize());
app.use(morgan('dev'));

// Router-level middleware: Allow 10mb only for OCR route
app.use('/api/ocr', express.json({ limit: '10mb' }));
app.use('/api/ocr', express.urlencoded({ extended: true, limit: '10mb' }));

app.use(express.json({ limit: '1mb' }));
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', globalLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many login attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth', authLimiter);

const ocrLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many OCR scans. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/ocr', ocrLimiter);

app.use(express.urlencoded({ extended: true, limit: '1mb' }));
// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/ocr', ocrRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/debts', debtRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/tenant', tenantRoutes);
app.use('/api/directory', directoryRoutes);

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

// ── Bootstrap ─────────────────────────────────────────────────────────────────
require('./src/cron/dailyAlertCheck');

// ── Error Handling ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.url}`, err);
  const status = err.httpStatus || 500;
  const message = err.message || 'Sunucu tarafında bir hata oluştu.';
  res.status(status).json({ success: false, message });
});

const PORT = process.env.PORT || 5000;

const start = async () => {
  await connectDB(); // Establish DB connection before accepting traffic
  app.listen(PORT, () => {
    console.log(`[server] Kasam360 API running on port ${PORT} [${process.env.NODE_ENV}]`);
  });
};

start();
