const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Use a persistent volume if mounted (e.g. Railway volume at /app/data),
// otherwise fall back to a local file for development.
const dataDir = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'summits.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS summits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  classification TEXT,
  area TEXT,
  wiki TEXT,
  image TEXT,
  height_m REAL NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  summit_id INTEGER NOT NULL REFERENCES summits(id) ON DELETE CASCADE,
  completed_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT,
  UNIQUE(user_id, summit_id)
);

CREATE TABLE IF NOT EXISTS friendships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(requester_id, recipient_id)
);

CREATE TABLE IF NOT EXISTS summit_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  summit_id INTEGER NOT NULL REFERENCES summits(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS summit_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  summit_id INTEGER NOT NULL REFERENCES summits(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,
  body TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(summit_id, user_id)
);

CREATE TABLE IF NOT EXISTS plan_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT,
  start_lat REAL NOT NULL,
  start_lng REAL NOT NULL,
  end_lat REAL NOT NULL,
  end_lng REAL NOT NULL,
  geometry TEXT NOT NULL,
  distance_km REAL,
  duration_min REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_plan_items_user ON plan_items(user_id);
CREATE INDEX IF NOT EXISTS idx_summit_reviews_summit ON summit_reviews(summit_id);
CREATE INDEX IF NOT EXISTS idx_summit_images_summit ON summit_images(summit_id);
CREATE INDEX IF NOT EXISTS idx_summits_region ON summits(region);
CREATE INDEX IF NOT EXISTS idx_completions_user ON completions(user_id);
CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id);
CREATE INDEX IF NOT EXISTS idx_friendships_recipient ON friendships(recipient_id);
`);

db.exec('DROP TABLE IF EXISTS summit_routes');

// plan_items schema changed from per-summit pins to saved routes; drop and recreate if old shape.
{
  const planColumns = db.prepare("PRAGMA table_info(plan_items)").all().map(c => c.name);
  if (planColumns.length && !planColumns.includes('geometry')) {
    db.exec('DROP TABLE plan_items');
    db.exec(`
      CREATE TABLE plan_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT,
        start_lat REAL NOT NULL,
        start_lng REAL NOT NULL,
        end_lat REAL NOT NULL,
        end_lng REAL NOT NULL,
        geometry TEXT NOT NULL,
        distance_km REAL,
        duration_min REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_plan_items_user ON plan_items(user_id);
    `);
  }
}

const summitColumns = db.prepare("PRAGMA table_info(summits)").all().map(c => c.name);
if (!summitColumns.includes('area')) {
  db.exec('ALTER TABLE summits ADD COLUMN area TEXT');
}
if (!summitColumns.includes('wiki')) {
  db.exec('ALTER TABLE summits ADD COLUMN wiki TEXT');
}
if (!summitColumns.includes('image')) {
  db.exec('ALTER TABLE summits ADD COLUMN image TEXT');
}
if (!summitColumns.includes('alt_name')) {
  db.exec('ALTER TABLE summits ADD COLUMN alt_name TEXT');
}
if (!summitColumns.includes('wiki_extract')) {
  db.exec('ALTER TABLE summits ADD COLUMN wiki_extract TEXT');
}
for (const col of ['route_start_lat', 'route_start_lng', 'route_start_name', 'route_starts']) {
  if (summitColumns.includes(col)) {
    db.exec(`ALTER TABLE summits DROP COLUMN ${col}`);
  }
}

db.prepare("UPDATE summits SET area = 'Brecon Beacons' WHERE name = 'Cefn yr Ystrad' AND area = 'Cambrian Mountains'").run();

const userColumns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userColumns.includes('is_admin')) {
  db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
}

module.exports = db;
