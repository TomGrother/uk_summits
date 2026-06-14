// Seeds the Shropshire Hills into the summits table on first run.
// Safe to re-run (no-op once they exist).
const db = require('../db');
const { osGridToWgs84 } = require('./osGridToWgs84');
const hills = require('../seed/shropshireHills');

function wikiUrl(name) {
  const title = name.replace(/\s*\(.*?\)/g, '').trim().replace(/ /g, '_');
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title).replace(/%2F/g, '/')}`;
}

function seedShropshireHills() {
  const existing = db.prepare("SELECT COUNT(*) AS c FROM summits WHERE classification = 'Shropshire'").get().c;
  if (existing > 0) return;

  const insert = db.prepare(`
    INSERT INTO summits (name, region, classification, area, wiki, image, height_m, lat, lng)
    VALUES (@name, @region, @classification, @area, @wiki, @image, @height_m, @lat, @lng)
  `);

  const run = db.transaction((rows) => {
    for (const [name, height_m, gridRef, image] of rows) {
      const { lat, lon } = osGridToWgs84(gridRef);
      insert.run({
        name,
        region: 'England',
        classification: 'Shropshire',
        area: 'Shropshire Hills',
        wiki: wikiUrl(name),
        image,
        height_m,
        lat,
        lng: lon,
      });
    }
  });
  run(hills);

  console.log(`Seeded ${hills.length} Shropshire Hills`);
}

module.exports = { seedShropshireHills };
