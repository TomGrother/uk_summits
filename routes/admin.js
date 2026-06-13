const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');

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
    INSERT INTO summits (name, region, classification, height_m, lat, lng)
    VALUES (@name, @region, @classification, @height_m, @lat, @lng)
  `);

  const run = db.transaction((rows) => {
    db.exec('DELETE FROM completions');
    db.exec('DELETE FROM summits');
    for (const s of rows) insert.run(s);
  });
  run(summits);

  res.json({ ok: true, count: summits.length });
});

module.exports = router;
