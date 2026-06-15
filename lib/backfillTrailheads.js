// One-time per-summit lookup: find points where a footpath joins a driving
// road near the summit (candidate trailheads), verify each with ORS, and
// store the working ones as JSON on the summit row. The live /route endpoint
// then only needs to call ORS (Overpass is too unreliable for on-demand use).
const db = require('../db');

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
];

// Summits the route-finder feature is enabled for (pilot).
const ROUTE_ENABLED_IDS = [2036]; // Ben Nevis

const ROAD_HIGHWAYS = '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service)$';
const PATH_HIGHWAYS = '^(path|footpath|bridleway|track)$';
const RADIUS_M = 6000;
const NEAR_THRESHOLD_M = 25;
const MIN_SEPARATION_M = 300;
const MAX_CANDIDATES_TO_TRY = 6;
const MAX_ROUTES_TO_STORE = 3;

// Last-resort fallback if Overpass/ORS are unreachable at startup.
const FALLBACKS = {
  2036: [{ lat: 56.8094, lng: -5.0726 }],
};

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
        signal: AbortSignal.timeout(20000),
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

async function fetchHighwayNodes(highwayRegex, summit) {
  const query = `
    [out:json][timeout:30];
    way["highway"~"${highwayRegex}"](around:${RADIUS_M},${summit.lat},${summit.lng});
    node(w);
    out skel;
  `;
  const json = await queryOverpass(query);
  return (json.elements || [])
    .filter(e => e.type === 'node')
    .map(n => ({ id: n.id, lat: n.lat, lng: n.lon }));
}

async function fetchPathWays(summit) {
  const query = `
    [out:json][timeout:30];
    way["highway"~"${PATH_HIGHWAYS}"](around:${RADIUS_M},${summit.lat},${summit.lng});
    out geom;
  `;
  const json = await queryOverpass(query);
  return (json.elements || [])
    .filter(e => e.type === 'way' && Array.isArray(e.geometry) && e.geometry.length >= 2)
    .map(w => w.geometry.map(g => ({ lat: g.lat, lng: g.lon })));
}

// Find distinct footpaths/tracks that start at a driving road, sorted by
// distance from the summit and spread out so they represent different
// approaches up the hill (not the same path with different start points
// further along the connecting road).
async function findTrailheadCandidates(summit) {
  const [roadNodes, pathWays] = await Promise.all([
    fetchHighwayNodes(ROAD_HIGHWAYS, summit),
    fetchPathWays(summit),
  ]);

  const nearRoad = (pt) => roadNodes.some(rn => haversine(pt.lat, pt.lng, rn.lat, rn.lng) < NEAR_THRESHOLD_M);

  const candidates = [];
  for (const way of pathWays) {
    const first = way[0];
    const last = way[way.length - 1];
    // Use the next node *into* the path (not the road junction itself) as the
    // start point, so ORS routes along this footpath rather than the road.
    if (nearRoad(first)) candidates.push(way[1]);
    else if (nearRoad(last)) candidates.push(way[way.length - 2]);
  }

  candidates.sort((a, b) =>
    haversine(summit.lat, summit.lng, a.lat, a.lng) -
    haversine(summit.lat, summit.lng, b.lat, b.lng)
  );

  // Spread candidates out so they represent different routes up the hill.
  const spread = [];
  for (const c of candidates) {
    if (spread.some(s => haversine(s.lat, s.lng, c.lat, c.lng) < MIN_SEPARATION_M)) continue;
    spread.push(c);
    if (spread.length >= MAX_CANDIDATES_TO_TRY) break;
  }
  return spread;
}

async function tryOrsRoute(start, summit, orsKey) {
  const res = await fetch('https://api.openrouteservice.org/v2/directions/foot-hiking/geojson', {
    method: 'POST',
    headers: { Authorization: orsKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ coordinates: [[start.lng, start.lat], [summit.lng, summit.lat]] }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.features && json.features[0] ? start : null;
}

async function backfillTrailheads() {
  const orsKey = process.env.ORS_API_KEY;
  const placeholders = ROUTE_ENABLED_IDS.map(() => '?').join(',');
  const summits = db.prepare(
    `SELECT id, name, lat, lng FROM summits WHERE id IN (${placeholders})`
  ).all(...ROUTE_ENABLED_IDS);

  for (const summit of summits) {
    let working = [];
    try {
      const candidates = await findTrailheadCandidates(summit);
      if (orsKey) {
        for (const c of candidates) {
          const verified = await tryOrsRoute(c, summit, orsKey);
          if (verified) working.push({ lat: verified.lat, lng: verified.lng });
          if (working.length >= MAX_ROUTES_TO_STORE) break;
        }
      } else {
        working = candidates.slice(0, MAX_ROUTES_TO_STORE).map(c => ({ lat: c.lat, lng: c.lng }));
      }
    } catch (err) {
      console.error(`Trailhead lookup failed for ${summit.name}:`, err.message);
    }

    if (!working.length) working = FALLBACKS[summit.id] || [];
    if (!working.length) {
      console.warn(`No trailheads found near ${summit.name}`);
      continue;
    }

    db.prepare('UPDATE summits SET route_starts = ? WHERE id = ?')
      .run(JSON.stringify(working), summit.id);
    console.log(`Stored ${working.length} trailhead(s) for ${summit.name}`);
  }
}

module.exports = { backfillTrailheads };
