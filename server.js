require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const authRoutes = require('./routes/auth');
const summitRoutes = require('./routes/summits');
const adminRoutes = require('./routes/admin');
const imageRoutes = require('./routes/images');
const reviewRoutes = require('./routes/reviews');

// Populate the summits table on first run (no-op if already seeded).
(function seedIfEmpty() {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM summits').get().c;
  if (existing > 0) return;

  const summits = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed', 'summits.json'), 'utf8'));
  const insert = db.prepare(`
    INSERT INTO summits (name, region, classification, area, wiki, image, height_m, lat, lng)
    VALUES (@name, @region, @classification, @area, @wiki, @image, @height_m, @lat, @lng)
  `);
  const run = db.transaction((rows) => {
    for (const s of rows) insert.run(s);
  });
  run(summits);
  console.log(`Seeded ${summits.length} summits`);
})();

require('./lib/seedWainwrights').seedWainwrights();
require('./lib/seedMunros').seedMunros();
require('./lib/seedPeakDistrict').seedPeakDistrict();
require('./lib/seedYorkshireDales').seedYorkshireDales();
require('./lib/seedShropshireHills').seedShropshireHills();
require('./lib/seedSnowdonRoutes').seedSnowdonRoutes();

const app = express();
const PORT = process.env.PORT || 3000;

// Railway sits in front of the app as a reverse proxy; trust its X-Forwarded-For
// so req.ip reflects the real client (used for rate limiting).
app.set('trust proxy', 1);

app.use(compression());
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' https://unpkg.com",
    "style-src 'self' 'unsafe-inline' https://unpkg.com",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "font-src 'self' data:",
  ].join('; '));
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/summits', summitRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/summits', imageRoutes);
app.use('/api/summits', reviewRoutes);

const dataDir = process.env.DATA_DIR || __dirname;
app.use('/uploads', express.static(path.join(dataDir, 'uploads'), { maxAge: '7d' }));

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html') || filePath.endsWith('.css') || filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`UK Summits server running on http://localhost:${PORT}`);
});

require('./lib/altNames').backfillAltNames()
  .catch(err => console.error('Alt name backfill failed:', err))
  .then(() => require('./lib/backfillImages').backfillImages())
  .catch(err => console.error('Image backfill failed:', err));
