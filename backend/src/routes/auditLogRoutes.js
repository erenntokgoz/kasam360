const express = require('express');
const { getAuditLogs } = require('../controllers/auditLogController');
const { requireAuth } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/', requireAuth, getAuditLogs);

module.exports = router;
