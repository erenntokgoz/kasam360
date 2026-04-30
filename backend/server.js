const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const connectDB = require('./src/config/db');
const authRoutes = require('./src/routes/authRoutes');
const ocrRoutes = require('./src/routes/ocrRoutes');
const transactionRoutes = require('./src/routes/transactionRoutes');
const debtRoutes = require('./src/routes/debtRoutes');

dotenv.config();

const app = express();

// ── Core Middleware ───────────────────────────────────────────────────────────
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));            // ← increased for base64 receipt images
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/ocr', ocrRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/debts', debtRoutes);

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

// ── Bootstrap ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

const start = async () => {
  await connectDB(); // Establish DB connection before accepting traffic
  app.listen(PORT, () => {
    console.log(`[server] Kasam360 API running on port ${PORT} [${process.env.NODE_ENV}]`);
  });
};

start();
