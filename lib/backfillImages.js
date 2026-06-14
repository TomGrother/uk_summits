// Backfills summits.image from Wikipedia's page image (the lead photo shown
// in the article infobox/thumbnail). Runs once at startup for any summit
// that doesn't have an image yet, and is safe to re-run (no-op once every
// row is filled in).
const db = require('../db');

function titleFromWiki(wiki) {
  if (!wiki) return null;
  const m = wiki.match(/\/wiki\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'SummitStack/1.0 (image-backfill)' } });
  return res.json();
}

async function getImage(summit) {
  const title = titleFromWiki(summit.wiki);
  if (!title) return null;

  try {
    const data = await fetchJson(
      `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&piprop=original&titles=${encodeURIComponent(title)}&format=json`
    );
    const page = Object.values(data?.query?.pages || {})[0];
    return page?.original?.source || null;
  } catch (e) { /* give up for this summit */ }

  return null;
}

async function backfillImages() {
  const pending = db.prepare(
    "SELECT id, name, wiki FROM summits WHERE (image IS NULL OR image = '') AND wiki IS NOT NULL"
  ).all();
  if (!pending.length) return;

  const update = db.prepare('UPDATE summits SET image = ? WHERE id = ?');
  console.log(`Backfilling images for ${pending.length} summits...`);

  for (const summit of pending) {
    try {
      const img = await getImage(summit);
      if (img) update.run(img, summit.id);
    } catch (e) {
      console.error(`image lookup failed for ${summit.name}:`, e.message);
    }
    await new Promise(r => setTimeout(r, 150));
  }
  console.log('Image backfill complete.');
}

module.exports = { backfillImages };
