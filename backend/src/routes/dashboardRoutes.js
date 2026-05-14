'use strict';

const express = require('express');
const { getDashboard } = require('../controllers/dashboardController');
const { requireAuth } = require('../middlewares/authMiddleware');

const router = express.Router();

// GET /api/dashboard — analitik özet (auth gerekli)
router.get('/', requireAuth, getDashboard);

module.exports = router;
