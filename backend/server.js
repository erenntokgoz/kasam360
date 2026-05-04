const express = require('express');
const dotenv = require('dotenv');
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

dotenv.config();

const app = express();

app.disable('x-powered-by');

// ── Core Middleware ───────────────────────────────────────────────────────────
app.use(cors({ origin: ['com.kasam360.app://', 'http://localhost:3000'] }));
app.use(helmet());
app.use(mongoSanitize());
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));            // ← increased for base64 receipt images

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

app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/ocr', ocrRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/debts', debtRoutes);
app.use('/api/audit-logs', auditLogRoutes);

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

// ── Bootstrap ─────────────────────────────────────────────────────────────────
require('./src/cron/dailyAlertCheck');

const PORT = process.env.PORT || 5000;

const start = async () => {
  await connectDB(); // Establish DB connection before accepting traffic
  app.listen(PORT, () => {
    console.log(`[server] Kasam360 API running on port ${PORT} [${process.env.NODE_ENV}]`);
  });
};

start();
