// Seeds the 282 Scottish Munros into the summits table on first run.
// Safe to re-run (no-op once they exist).
const db = require('../db');
const { osGridToWgs84 } = require('./osGridToWgs84');
const munros = require('../seed/munros');

function wikiUrl(name) {
  const title = name.replace(/\s*\(.*?\)/g, '').trim().replace(/ /g, '_');
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title).replace(/%2F/g, '/')}`;
}

function seedMunros() {
  const existing = db.prepare("SELECT COUNT(*) AS c FROM summits WHERE classification = 'Munro'").get().c;
  if (existing > 0) return;

  const insert = db.prepare(`
    INSERT INTO summits (name, region, classification, area, wiki, image, height_m, lat, lng)
    VALUES (@name, @region, @classification, @area, @wiki, @image, @height_m, @lat, @lng)
  `);

  const run = db.transaction((rows) => {
    for (const [name, area, height_m, gridRef] of rows) {
      const { lat, lon } = osGridToWgs84(gridRef);
      insert.run({
        name,
        region: 'Scotland',
        classification: 'Munro',
        area: `Scottish Highlands: ${area}`,
        wiki: wikiUrl(name),
        image: null,
        height_m,
        lat,
        lng: lon,
      });
    }
  });
  run(munros);

  console.log(`Seeded ${munros.length} Scottish Munros`);
}

module.exports = { seedMunros };
