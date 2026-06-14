// Seeds the 214 Lake District Wainwrights into the summits table on first
// run. Safe to re-run (no-op once they exist).
const db = require('../db');
const { osGridToWgs84 } = require('./osGridToWgs84');
const wainwrights = require('../seed/wainwrights');

const AREA_NAMES = {
  N: 'Lake District: Northern Fells',
  E: 'Lake District: Eastern Fells',
  CW: 'Lake District: Central & Western Fells',
  S: 'Lake District: Southern Fells',
};

function wikiUrl(name) {
  const title = name.replace(/\s*\[.*?\]/g, '').trim().replace(/ /g, '_');
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title).replace(/%2F/g, '/')}`;
}

function seedWainwrights() {
  const existing = db.prepare("SELECT COUNT(*) AS c FROM summits WHERE classification = 'Wainwright'").get().c;
  if (existing > 0) return;

  const insert = db.prepare(`
    INSERT INTO summits (name, region, classification, area, wiki, image, height_m, lat, lng)
    VALUES (@name, @region, @classification, @area, @wiki, @image, @height_m, @lat, @lng)
  `);

  const run = db.transaction((rows) => {
    for (const [name, section, height_m, gridRef] of rows) {
      const { lat, lon } = osGridToWgs84(gridRef);
      insert.run({
        name,
        region: 'England',
        classification: 'Wainwright',
        area: AREA_NAMES[section],
        wiki: wikiUrl(name),
        image: null,
        height_m,
        lat,
        lng: lon,
      });
    }
  });
  run(wainwrights);

  console.log(`Seeded ${wainwrights.length} Lake District Wainwrights`);
}

module.exports = { seedWainwrights };
