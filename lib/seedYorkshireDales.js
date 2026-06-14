// Seeds the peaks of the Yorkshire Dales into the summits table on first run.
// Safe to re-run (no-op once they exist).
const db = require('../db');
const { osGridToWgs84 } = require('./osGridToWgs84');
const peaks = require('../seed/yorkshireDales');

function wikiUrl(name) {
  const title = name.replace(/\s*\(.*?\)/g, '').trim().replace(/ /g, '_');
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title).replace(/%2F/g, '/')}`;
}

function seedYorkshireDales() {
  const existing = db.prepare("SELECT COUNT(*) AS c FROM summits WHERE classification = 'Yorkshire Dales'").get().c;
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
        region: 'England',
        classification: 'Yorkshire Dales',
        area: `Yorkshire Dales: ${area}`,
        wiki: wikiUrl(name),
        image: null,
        height_m,
        lat,
        lng: lon,
      });
    }
  });
  run(peaks);

  console.log(`Seeded ${peaks.length} Yorkshire Dales peaks`);
}

module.exports = { seedYorkshireDales };
