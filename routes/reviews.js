const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// List reviews for a summit, including the reviewer's username.
router.get('/:id/reviews', (req, res) => {
  const reviews = db.prepare(`
    SELECT sr.id, sr.rating, sr.body, sr.created_at, u.username
    FROM summit_reviews sr
    JOIN users u ON u.id = sr.user_id
    WHERE sr.summit_id = ?
    ORDER BY sr.created_at DESC
  `).all(req.params.id);

  res.json({ reviews });
});

// Create or update the current user's review for a summit.
router.post('/:id/reviews', requireAuth, (req, res) => {
  const summit = db.prepare('SELECT id FROM summits WHERE id = ?').get(req.params.id);
  if (!summit) return res.status(404).json({ error: 'Summit not found' });

  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
  }
  const body = (req.body.body || '').toString().trim().slice(0, 1000);

  db.prepare(`
    INSERT INTO summit_reviews (summit_id, user_id, rating, body) VALUES (?, ?, ?, ?)
    ON CONFLICT(summit_id, user_id) DO UPDATE SET rating = excluded.rating, body = excluded.body, created_at = datetime('now')
  `).run(req.params.id, req.user.id, rating, body);

  res.json({ ok: true });
});

// Delete the current user's review for a summit.
router.delete('/:id/reviews', requireAuth, (req, res) => {
  db.prepare('DELETE FROM summit_reviews WHERE summit_id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
