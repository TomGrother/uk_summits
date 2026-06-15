// One-time per-summit lookup: find the nearest car park via Overpass and store
// it on the summits row, so the live /route endpoint only depends on ORS.
const db = require('../db');

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
];

// Summits the route-finder feature is enabled for (pilot).
const ROUTE_ENABLED_IDS = [2036]; // Ben Nevis

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function queryOverpass(query) {
  let lastErr;
  for (const mirror of MIRRORS) {
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'SummitStack/1.0 (https://uksummits-production.up.railway.app; contact via GitHub TomGrother/uk_summits)',
          Accept: 'application/json',
        },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) {
        lastErr = new Error(`${mirror} responded ${res.status}`);
        continue;
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function findNearestCarPark(summit) {
  const radius = 5000;
  const query = `
    [out:json][timeout:25];
    (
      node["amenity"="parking"](around:${radius},${summit.lat},${summit.lng});
      way["amenity"="parking"](around:${radius},${summit.lat},${summit.lng});
    );
    out center;
  `;
  const json = await queryOverpass(query);
  const candidates = (json.elements || []).map(el => {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) return null;
    return {
      lat,
      lng,
      name: el.tags?.name || 'Nearest car park',
      dist: haversine(summit.lat, summit.lng, lat, lng),
    };
  }).filter(Boolean);

  if (!candidates.length) return null;
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates[0];
}

// Last-resort fallback if Overpass is unreachable at startup, so the pilot
// still works. Overwritten by a real Overpass result on a later restart.
const FALLBACKS = {
  2036: { lat: 56.8094, lng: -5.0726, name: 'Glen Nevis Visitor Centre car park' },
};

async function backfillTrailheads() {
  const placeholders = ROUTE_ENABLED_IDS.map(() => '?').join(',');
  const summits = db.prepare(
    `SELECT id, name, lat, lng FROM summits WHERE id IN (${placeholders}) AND route_start_lat IS NULL`
  ).all(...ROUTE_ENABLED_IDS);

  for (const summit of summits) {
    let trailhead;
    try {
      trailhead = await findNearestCarPark(summit);
    } catch (err) {
      console.error(`Trailhead lookup failed for ${summit.name}:`, err.message);
    }
    if (!trailhead) trailhead = FALLBACKS[summit.id];
    if (!trailhead) {
      console.warn(`No car park found near ${summit.name}`);
      continue;
    }
    db.prepare('UPDATE summits SET route_start_lat = ?, route_start_lng = ?, route_start_name = ? WHERE id = ?')
      .run(trailhead.lat, trailhead.lng, trailhead.name, summit.id);
    console.log(`Trailhead stored for ${summit.name}: ${trailhead.name} (${trailhead.lat}, ${trailhead.lng})`);
  }
}

module.exports = { backfillTrailheads };
