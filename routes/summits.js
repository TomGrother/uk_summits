const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getAllBadgesForUser } = require('./badges');

const router = express.Router();

// List all summits, with completion status if logged in.
router.get('/', (req, res) => {
  const summits = db.prepare('SELECT * FROM summits ORDER BY height_m DESC').all();

  let completedIds = new Set();
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    try {
      const jwt = require('jsonwebtoken');
      const { SECRET } = require('../middleware/auth');
      const payload = jwt.verify(header.slice(7), SECRET);
      const rows = db.prepare('SELECT summit_id FROM completions WHERE user_id = ?').all(payload.id);
      completedIds = new Set(rows.map(r => r.summit_id));
    } catch {
      // ignore invalid token, just return uncompleted list
    }
  }

  res.json(summits.map(s => ({ ...s, completed: completedIds.has(s.id) })));
});

// Get the logged-in user's progress summary.
router.get('/progress', requireAuth, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS c FROM summits').get().c;
  const completed = db.prepare('SELECT COUNT(*) AS c FROM completions WHERE user_id = ?').get(req.user.id).c;
  res.json({ total, completed });
});

// Get the logged-in user's earned badges.
router.get('/badges', requireAuth, (req, res) => {
  res.json({ badges: getAllBadgesForUser(req.user.id) });
});

// Mark a summit as completed.
router.post('/:id/complete', requireAuth, (req, res) => {
  const summit = db.prepare('SELECT id FROM summits WHERE id = ?').get(req.params.id);
  if (!summit) return res.status(404).json({ error: 'Summit not found' });

  const { notes } = req.body || {};
  db.prepare(`
    INSERT INTO completions (user_id, summit_id, notes) VALUES (?, ?, ?)
    ON CONFLICT(user_id, summit_id) DO UPDATE SET notes = excluded.notes
  `).run(req.user.id, summit.id, notes || null);

  res.json({ ok: true });
});

// Unmark a summit.
router.delete('/:id/complete', requireAuth, (req, res) => {
  db.prepare('DELETE FROM completions WHERE user_id = ? AND summit_id = ?').run(req.user.id, req.params.id);
  res.json({ ok: true });
});

// Weather cache: summitId -> { data, fetchedAt }
const weatherCache = new Map();
const WEATHER_TTL_MS = 30 * 60 * 1000;

const WEATHER_CODES = {
  0: { label: 'Clear sky', icon: '☀️' },
  1: { label: 'Mainly clear', icon: '🌤️' },
  2: { label: 'Partly cloudy', icon: '⛅' },
  3: { label: 'Overcast', icon: '☁️' },
  45: { label: 'Fog', icon: '🌫️' },
  48: { label: 'Fog', icon: '🌫️' },
  51: { label: 'Light drizzle', icon: '🌦️' },
  53: { label: 'Drizzle', icon: '🌦️' },
  55: { label: 'Dense drizzle', icon: '🌦️' },
  61: { label: 'Light rain', icon: '🌧️' },
  63: { label: 'Rain', icon: '🌧️' },
  65: { label: 'Heavy rain', icon: '🌧️' },
  71: { label: 'Light snow', icon: '🌨️' },
  73: { label: 'Snow', icon: '🌨️' },
  75: { label: 'Heavy snow', icon: '🌨️' },
  77: { label: 'Snow grains', icon: '🌨️' },
  80: { label: 'Light showers', icon: '🌦️' },
  81: { label: 'Showers', icon: '🌦️' },
  82: { label: 'Heavy showers', icon: '🌧️' },
  85: { label: 'Snow showers', icon: '🌨️' },
  86: { label: 'Heavy snow showers', icon: '🌨️' },
  95: { label: 'Thunderstorm', icon: '⛈️' },
  96: { label: 'Thunderstorm with hail', icon: '⛈️' },
  99: { label: 'Thunderstorm with hail', icon: '⛈️' },
};

// Current weather for a summit (proxied + cached to avoid hammering Open-Meteo).
router.get('/:id/weather', async (req, res) => {
  const summit = db.prepare('SELECT id, lat, lng, height_m FROM summits WHERE id = ?').get(req.params.id);
  if (!summit) return res.status(404).json({ error: 'Summit not found' });

  const cached = weatherCache.get(summit.id);
  if (cached && Date.now() - cached.fetchedAt < WEATHER_TTL_MS) {
    return res.json(cached.data);
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${summit.lat}&longitude=${summit.lng}` +
      `&current=temperature_2m,apparent_temperature,wind_speed_10m,wind_gusts_10m,weather_code` +
      `&hourly=temperature_2m,weather_code,precipitation_probability` +
      `&elevation=${summit.height_m}&wind_speed_unit=mph&timezone=auto&forecast_days=2`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Open-Meteo responded ${response.status}`);
    const json = await response.json();
    const current = json.current || {};
    const code = current.weather_code;
    const info = WEATHER_CODES[code] || { label: 'Unknown', icon: '❓' };

    const hourly = json.hourly || {};
    const nowIso = current.time;
    let startIdx = (hourly.time || []).findIndex(t => t > nowIso);
    if (startIdx === -1) startIdx = 0;

    const forecast = [0, 2, 4, 6].map(offset => {
      const idx = startIdx + offset;
      const time = hourly.time[idx];
      const hCode = hourly.weather_code[idx];
      const hInfo = WEATHER_CODES[hCode] || { label: 'Unknown', icon: '❓' };
      return {
        time: time.slice(11, 16),
        temperature: Math.round(hourly.temperature_2m[idx]),
        precipitation: hourly.precipitation_probability[idx],
        icon: hInfo.icon,
      };
    });

    const data = {
      temperature: Math.round(current.temperature_2m),
      feelsLike: Math.round(current.apparent_temperature),
      windSpeed: Math.round(current.wind_speed_10m),
      windGusts: Math.round(current.wind_gusts_10m),
      label: info.label,
      icon: info.icon,
      forecast,
    };

    weatherCache.set(summit.id, { data, fetchedAt: Date.now() });
    res.json(data);
  } catch (err) {
    console.error('Weather fetch failed:', err.message);
    if (cached) return res.json(cached.data);
    res.status(502).json({ error: 'Weather unavailable' });
  }
});

// Short intro text from a summit's Wikipedia article, if it has one.
// Fetched once and stored on the summit row; re-fetch only if wiki_extract is cleared.
router.get('/:id/wiki-summary', async (req, res) => {
  const summit = db.prepare('SELECT id, wiki, wiki_extract FROM summits WHERE id = ?').get(req.params.id);
  if (!summit) return res.status(404).json({ error: 'Summit not found' });
  if (!summit.wiki) return res.json({ extract: null });

  if (summit.wiki_extract) {
    return res.json({ extract: summit.wiki_extract });
  }

  try {
    const title = decodeURIComponent(summit.wiki.split('/').pop());
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'SummitStack/1.0 (https://uksummits-production.up.railway.app; contact via GitHub TomGrother/uk_summits)',
        Accept: 'application/json',
      },
    });
    if (!response.ok) throw new Error(`Wikipedia responded ${response.status}`);
    const json = await response.json();
    const extract = json.extract || null;
    if (extract) {
      db.prepare('UPDATE summits SET wiki_extract = ? WHERE id = ?').run(extract, summit.id);
    }
    res.json({ extract });
  } catch (err) {
    console.error('Wikipedia summary fetch failed for', summit.wiki, ':', err.message);
    res.json({ extract: null, error: err.message });
  }
});

// Get the logged-in user's saved routes.
router.get('/plan', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, start_lat, start_lng, end_lat, end_lng, geometry, distance_km, duration_min, created_at
    FROM plan_items
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(req.user.id);

  const items = rows.map(row => ({
    ...row,
    geometry: JSON.parse(row.geometry),
  }));
  res.json({ items });
});

// Save a planned route to the logged-in user's plan.
router.post('/plan', requireAuth, (req, res) => {
  const { name, start, end, geometry, distance_km, duration_min } = req.body || {};
  if (!start || !end || !geometry || typeof start.lat !== 'number' || typeof start.lng !== 'number' ||
      typeof end.lat !== 'number' || typeof end.lng !== 'number') {
    return res.status(400).json({ error: 'Invalid route' });
  }

  db.prepare(`
    INSERT INTO plan_items (user_id, name, start_lat, start_lng, end_lat, end_lng, geometry, distance_km, duration_min)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.id,
    name || null,
    start.lat, start.lng, end.lat, end.lng,
    JSON.stringify(geometry),
    Number.isFinite(distance_km) ? distance_km : null,
    Number.isFinite(duration_min) ? duration_min : null,
  );

  res.json({ ok: true });
});

// Remove a saved route from the logged-in user's plan.
router.delete('/plan/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM plan_items WHERE user_id = ? AND id = ?').run(req.user.id, req.params.id);
  res.json({ ok: true });
});

// Plan a walking route between two points using known paths/trails.
router.post('/route', requireAuth, async (req, res) => {
  const { start, end } = req.body || {};
  if (!start || !end || typeof start.lat !== 'number' || typeof start.lng !== 'number' ||
      typeof end.lat !== 'number' || typeof end.lng !== 'number') {
    return res.status(400).json({ error: 'start and end coordinates are required' });
  }

  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Routing is not configured' });

  try {
    const response = await fetch('https://api.openrouteservice.org/v2/directions/foot-hiking/geojson', {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        coordinates: [[start.lng, start.lat], [end.lng, end.lat]],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('ORS routing failed:', response.status, text);
      return res.status(502).json({ error: 'Could not find a route between those points' });
    }

    const data = await response.json();
    const feature = data.features[0];
    res.json({
      geometry: feature.geometry,
      distanceKm: feature.properties.summary.distance / 1000,
      durationMin: feature.properties.summary.duration / 60,
    });
  } catch (err) {
    console.error('Route fetch failed:', err.message);
    res.status(502).json({ error: 'Could not find a route between those points' });
  }
});

module.exports = router;
