const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { SECRET, requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many attempts. Please try again in 15 minutes.' });

const PASSWORD_RULES = 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number and a symbol';
function isValidPassword(password) {
  return password.length >= 8 && password.length <= 72 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);
}

const router = express.Router();

router.post('/register', authLimiter, (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email and password are required' });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: PASSWORD_RULES });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
  if (existing) return res.status(409).json({ error: 'Username or email already in use' });

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(
    'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)'
  ).run(username, email, hash);

  const token = jwt.sign({ id: result.lastInsertRowid, username, isAdmin: false }, SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: result.lastInsertRowid, username, isAdmin: false } });
});

// TODO: hook up to resend.com to actually send a reset email.
router.post('/forgot-password', authLimiter, (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required' });
  // Always respond with ok to avoid leaking which emails are registered.
  res.json({ ok: true });
});

router.post('/login', authLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

  const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const isAdmin = !!user.is_admin;
  const token = jwt.sign({ id: user.id, username: user.username, isAdmin }, SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, username: user.username, isAdmin } });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, username, email, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

module.exports = router;
