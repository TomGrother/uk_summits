const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function requireAdminSecret(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const secret = process.env.ADMIN_SECRET;
  if (!secret || token !== secret) {
    return res.status(401).json({ error: 'Not authorized' });
  }
  next();
}

// Clears and reloads the summits table from seed/summits.json.
// Usage: curl -X POST -H "Authorization: Bearer $ADMIN_SECRET" https://<your-app>/api/admin/reseed
router.post('/reseed', requireAdminSecret, (req, res) => {
  const summits = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'summits.json'), 'utf8'));
  const insert = db.prepare(`
    INSERT INTO summits (name, region, classification, area, wiki, height_m, lat, lng)
    VALUES (@name, @region, @classification, @area, @wiki, @height_m, @lat, @lng)
  `);

  const run = db.transaction((rows) => {
    db.exec('DELETE FROM completions');
    db.exec('DELETE FROM summits');
    for (const s of rows) insert.run(s);
  });
  run(summits);

  res.json({ ok: true, count: summits.length });
});

// One-off: grant admin rights to a user by username.
// Usage: curl -X POST -H "Authorization: Bearer $ADMIN_SECRET" -H "Content-Type: application/json" \
//   -d '{"username":"..."}' https://<your-app>/api/admin/grant
router.post('/grant', requireAdminSecret, (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'Username is required' });

  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(user.id);
  res.json({ ok: true });
});

// --- Admin panel endpoints (require a logged-in admin user) ---

router.get('/stats', requireAuth, requireAdmin, (req, res) => {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const summitCount = db.prepare('SELECT COUNT(*) AS c FROM summits').get().c;
  const completionCount = db.prepare('SELECT COUNT(*) AS c FROM completions').get().c;
  res.json({ users: userCount, summits: summitCount, completions: completionCount });
});

router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.email, u.is_admin, u.created_at,
           COUNT(c.id) AS completed
    FROM users u
    LEFT JOIN completions c ON c.user_id = u.id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `).all();
  res.json({ users: users.map(u => ({ ...u, isAdmin: !!u.is_admin })) });
});

router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: "You can't delete your own account here" });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
