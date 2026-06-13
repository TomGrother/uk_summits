const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getBadgesForUser } = require('./badges');

const router = express.Router();

function progressFor(userId) {
  const total = db.prepare('SELECT COUNT(*) AS c FROM summits').get().c;
  const completed = db.prepare('SELECT COUNT(*) AS c FROM completions WHERE user_id = ?').get(userId).c;
  return { total, completed };
}

// List accepted friends with their progress.
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.username
    FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.recipient_id ELSE f.requester_id END
    WHERE f.status = 'accepted' AND (f.requester_id = ? OR f.recipient_id = ?)
  `).all(req.user.id, req.user.id, req.user.id);

  const friends = rows.map(u => ({
    id: u.id,
    username: u.username,
    ...progressFor(u.id),
    badges: getBadgesForUser(u.id),
  }));

  res.json({ friends });
});

// Incoming pending requests.
router.get('/requests', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT f.id, u.id AS userId, u.username
    FROM friendships f
    JOIN users u ON u.id = f.requester_id
    WHERE f.recipient_id = ? AND f.status = 'pending'
  `).all(req.user.id);
  res.json({ requests: rows });
});

// Send a friend request by username.
router.post('/request', requireAuth, (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'Username is required' });

  const target = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: "You can't add yourself" });

  const existing = db.prepare(`
    SELECT * FROM friendships
    WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)
  `).get(req.user.id, target.id, target.id, req.user.id);
  if (existing) return res.status(409).json({ error: 'Friend request already exists' });

  db.prepare('INSERT INTO friendships (requester_id, recipient_id, status) VALUES (?, ?, ?)')
    .run(req.user.id, target.id, 'pending');

  res.json({ ok: true });
});

// Accept a pending request.
router.post('/:id/accept', requireAuth, (req, res) => {
  const request = db.prepare('SELECT * FROM friendships WHERE id = ? AND recipient_id = ? AND status = ?')
    .get(req.params.id, req.user.id, 'pending');
  if (!request) return res.status(404).json({ error: 'Request not found' });

  db.prepare("UPDATE friendships SET status = 'accepted' WHERE id = ?").run(request.id);
  res.json({ ok: true });
});

// Decline a pending request (or remove an existing friendship).
router.delete('/:id', requireAuth, (req, res) => {
  db.prepare(`
    DELETE FROM friendships WHERE id = ? AND (requester_id = ? OR recipient_id = ?)
  `).run(req.params.id, req.user.id, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
