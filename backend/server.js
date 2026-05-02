require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

// Route Imports
const authRoutes = require('./src/routes/authRoutes');
const ocrRoutes = require('./src/routes/ocrRoutes');
const transactionRoutes = require('./src/routes/transactionRoutes');
const debtRoutes = require('./src/routes/debtRoutes');

const app = express();

// Basic Global Error Handling
process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught Exception:', err.message);
    console.error(err.stack);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

// Security & Core Middleware
app.use(helmet());
app.use(cors({ origin: '*' })); // Mobile network bypass
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health Check
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', uptime: process.uptime() }));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/ocr', ocrRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/debts', debtRoutes);

// Server Configuration & Database Connection
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

const startServer = async () => {
    try {
        if (!MONGO_URI) {
            throw new Error('MONGO_URI is not defined in .env file');
        }

        // Optimize connection options to resolve MetadataLookupWarning and DNS noise
        await mongoose.connect(MONGO_URI, {
            family: 4, // Enforce IPv4
            serverSelectionTimeoutMS: 5000,
            autoIndex: true
        });
        
        console.log('[DB] MongoDB Connected successfully (IPv4 Enforced)');

        // Bind to 0.0.0.0 for physical device accessibility
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`[SERVER] Kasam360 Backend running on port ${PORT}`);
            console.log(`[NETWORK] Accessible at http://0.0.0.0:${PORT} (Binding: 0.0.0.0)`);
            console.log(`[ENV] Current Environment: ${process.env.NODE_ENV || 'development'}`);
        });
    } catch (error) {
        console.error('[ERROR] Startup failed:', error.message);
        process.exit(1);
    }
};

startServer();
