const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getAllBadgesForUser } = require('./badges');

const router = express.Router();

// List all summits, with completion status if logged in.
router.get('/', (req, res) => {
  const summits = db.prepare('SELECT * FROM summits ORDER BY height_m DESC').all();

  let completedIds = new Set();
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    try {
      const jwt = require('jsonwebtoken');
      const { SECRET } = require('../middleware/auth');
      const payload = jwt.verify(header.slice(7), SECRET);
      const rows = db.prepare('SELECT summit_id FROM completions WHERE user_id = ?').all(payload.id);
      completedIds = new Set(rows.map(r => r.summit_id));
    } catch {
      // ignore invalid token, just return uncompleted list
    }
  }

  res.json(summits.map(s => ({ ...s, completed: completedIds.has(s.id) })));
});

// List walking routes for a summit.
router.get('/:id/routes', (req, res) => {
  const routes = db.prepare(`
    SELECT id, name, distance_km, ascent_m, difficulty, description, geojson, source
    FROM summit_routes WHERE summit_id = ? ORDER BY distance_km ASC
  `).all(req.params.id);

  res.json({ routes: routes.map(r => ({ ...r, geojson: JSON.parse(r.geojson) })) });
});

// Get the logged-in user's progress summary.
router.get('/progress', requireAuth, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS c FROM summits').get().c;
  const completed = db.prepare('SELECT COUNT(*) AS c FROM completions WHERE user_id = ?').get(req.user.id).c;
  res.json({ total, completed });
});

// Get the logged-in user's earned badges.
router.get('/badges', requireAuth, (req, res) => {
  res.json({ badges: getAllBadgesForUser(req.user.id) });
});

// Mark a summit as completed.
router.post('/:id/complete', requireAuth, (req, res) => {
  const summit = db.prepare('SELECT id FROM summits WHERE id = ?').get(req.params.id);
  if (!summit) return res.status(404).json({ error: 'Summit not found' });

  const { notes } = req.body || {};
  db.prepare(`
    INSERT INTO completions (user_id, summit_id, notes) VALUES (?, ?, ?)
    ON CONFLICT(user_id, summit_id) DO UPDATE SET notes = excluded.notes
  `).run(req.user.id, summit.id, notes || null);

  res.json({ ok: true });
});

// Unmark a summit.
router.delete('/:id/complete', requireAuth, (req, res) => {
  db.prepare('DELETE FROM completions WHERE user_id = ? AND summit_id = ?').run(req.user.id, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
