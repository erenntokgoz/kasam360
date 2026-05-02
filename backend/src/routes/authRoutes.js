const express = require('express');
const { register, login, updateProfile } = require('../controllers/authController');
const { requireAuth } = require('../middlewares/authMiddleware');

const router = express.Router();

// POST /api/auth/register
router.post('/register', register);

// POST /api/auth/login
router.post('/login', login);

// PATCH /api/auth/profile
router.patch('/profile', requireAuth, updateProfile);

module.exports = router;
