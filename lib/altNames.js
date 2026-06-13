// Backfills summits.alt_name from Wikipedia (lead extract "also known as" /
// "Welsh:" wording, falling back to a redirect that points at the page).
// Runs once at startup for any summit that doesn't have an alt_name yet,
// and is safe to re-run (no-op once every row is filled in).
const db = require('../db');

function titleFromWiki(wiki) {
  if (!wiki) return null;
  const m = wiki.match(/\/wiki\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

function normalize(s) {
  return s.toLowerCase().replace(/[()]/g, '').replace(/[_\s]+/g, ' ').trim();
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'SummitStack/1.0 (alt-name-backfill)' } });
  return res.json();
}

async function getAltName(summit) {
  const title = titleFromWiki(summit.wiki);
  if (!title) return null;

  try {
    const extractData = await fetchJson(
      `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&titles=${encodeURIComponent(title)}&format=json`
    );
    const page = Object.values(extractData?.query?.pages || {})[0];
    const extract = page?.extract || '';

    let m = extract.match(/also known as ([A-Za-zÀ-ÿ' -]+?)[.,;)]/i);
    if (m) return m[1].trim();

    m = extract.match(/\(Welsh:\s*([A-Za-zÀ-ÿ' -]+?)\)/i);
    if (m) return m[1].trim();
  } catch (e) { /* fall through to redirects */ }

  try {
    const redirData = await fetchJson(
      `https://en.wikipedia.org/w/api.php?action=query&prop=redirects&rdlimit=50&titles=${encodeURIComponent(title)}&format=json`
    );
    const page = Object.values(redirData?.query?.pages || {})[0];
    const redirects = (page?.redirects || []).map(r => r.title.replace(/_/g, ' '));

    const baseNorm = normalize(summit.name);
    const candidate = redirects.find(r => {
      const n = normalize(r);
      if (n === baseNorm) return false;
      if (n.includes(baseNorm) || baseNorm.includes(n)) return false;
      if (/\d{4}|disambiguation|list of/i.test(r)) return false;
      return true;
    });
    if (candidate) return candidate;
  } catch (e) { /* give up for this summit */ }

  return null;
}

async function backfillAltNames() {
  const pending = db.prepare(
    "SELECT id, name, wiki FROM summits WHERE (alt_name IS NULL OR alt_name = '') AND wiki IS NOT NULL"
  ).all();
  if (!pending.length) return;

  const update = db.prepare('UPDATE summits SET alt_name = ? WHERE id = ?');
  console.log(`Backfilling alt names for ${pending.length} summits...`);

  for (const summit of pending) {
    try {
      const alt = await getAltName(summit);
      if (alt) update.run(alt, summit.id);
    } catch (e) {
      console.error(`alt name lookup failed for ${summit.name}:`, e.message);
    }
    await new Promise(r => setTimeout(r, 150));
  }
  console.log('Alt name backfill complete.');
}

module.exports = { backfillAltNames };
