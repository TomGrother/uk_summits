const fs = require('fs');
const path = require('path');
const db = require('../db');

const summits = JSON.parse(fs.readFileSync(path.join(__dirname, 'summits.json'), 'utf8'));

const insert = db.prepare(`
  INSERT INTO summits (name, region, classification, height_m, lat, lng)
  VALUES (@name, @region, @classification, @height_m, @lat, @lng)
`);

function seed({ reset = false } = {}) {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM summits').get().c;
  if (existing > 0 && !reset) {
    return { seeded: false, existing };
  }

  const run = db.transaction((rows) => {
    if (reset) {
      db.exec('DELETE FROM completions');
      db.exec('DELETE FROM summits');
    }
    for (const s of rows) insert.run(s);
  });
  run(summits);
  return { seeded: true, count: summits.length };
}

if (require.main === module) {
  const reset = process.argv.includes('--reset');
  const result = seed({ reset });
  if (!result.seeded) {
    console.log(`summits table already has ${result.existing} rows, skipping seed (use --reset to replace)`);
  } else {
    console.log(`Seeded ${result.count} summits${reset ? ' (reset)' : ''}`);
  }
}

module.exports = { seed };
