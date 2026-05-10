const express = require('express');
const { register, login, refresh, deleteAccount, updateProfile } = require('../controllers/authController');
const { requireAuth } = require('../middlewares/authMiddleware');

const router = express.Router();

// POST /api/auth/register
router.post('/register', register);

// POST /api/auth/login
router.post('/login', login);

// POST /api/auth/refresh-token
router.post('/refresh-token', refresh);

// DELETE /api/auth/account
router.delete('/account', requireAuth, deleteAccount);

// PATCH /api/auth/profile
router.patch('/profile', requireAuth, updateProfile);

module.exports = router;
