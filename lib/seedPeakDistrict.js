// Seeds the hills of the Peak District into the summits table on first run.
// Safe to re-run (no-op once they exist).
const db = require('../db');
const { osGridToWgs84 } = require('./osGridToWgs84');
const hills = require('../seed/peakDistrict');

function wikiUrl(name) {
  const title = name.replace(/\s*\(.*?\)/g, '').trim().replace(/ /g, '_');
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title).replace(/%2F/g, '/')}`;
}

function seedPeakDistrict() {
  const existing = db.prepare("SELECT COUNT(*) AS c FROM summits WHERE classification = 'Peak District'").get().c;
  if (existing > 0) return;

  const insert = db.prepare(`
    INSERT INTO summits (name, region, classification, area, wiki, image, height_m, lat, lng)
    VALUES (@name, @region, @classification, @area, @wiki, @image, @height_m, @lat, @lng)
  `);

  const run = db.transaction((rows) => {
    for (const [name, height_m, gridRef] of rows) {
      const { lat, lon } = osGridToWgs84(gridRef);
      insert.run({
        name,
        region: 'England',
        classification: 'Peak District',
        area: 'Peak District',
        wiki: wikiUrl(name),
        image: null,
        height_m,
        lat,
        lng: lon,
      });
    }
  });
  run(hills);

  console.log(`Seeded ${hills.length} Peak District hills`);
}

module.exports = { seedPeakDistrict };
