// Seeds pilot walking-route data for Snowdon into summit_routes.
// Safe to re-run (no-op once routes exist for Snowdon).
const db = require('../db');
const { snowdonRoutes } = require('../seed/snowdonRoutes');

function seedSnowdonRoutes() {
  const summit = db.prepare("SELECT id FROM summits WHERE name = 'Snowdon'").get();
  if (!summit) return;

  const existing = db.prepare('SELECT COUNT(*) AS c FROM summit_routes WHERE summit_id = ?').get(summit.id).c;
  if (existing === snowdonRoutes().length) return;
  db.prepare('DELETE FROM summit_routes WHERE summit_id = ?').run(summit.id);

  const insert = db.prepare(`
    INSERT INTO summit_routes (summit_id, name, distance_km, ascent_m, difficulty, description, geojson, source)
    VALUES (@summit_id, @name, @distance_km, @ascent_m, @difficulty, @description, @geojson, @source)
  `);

  const run = db.transaction((rows) => {
    for (const r of rows) insert.run({ summit_id: summit.id, ...r });
  });
  run(snowdonRoutes());
  console.log(`Seeded ${snowdonRoutes().length} routes for Snowdon`);
}

module.exports = { seedSnowdonRoutes };
