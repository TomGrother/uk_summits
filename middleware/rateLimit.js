// Minimal in-memory sliding-window rate limiter, keyed by IP address.
// Good enough for a single-instance app to blunt brute-force login attempts.
function rateLimit({ windowMs, max, message }) {
  const hits = new Map();

  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, timestamps] of hits) {
      const recent = timestamps.filter(t => t > cutoff);
      if (recent.length === 0) hits.delete(key);
      else hits.set(key, recent);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const cutoff = now - windowMs;
    const timestamps = (hits.get(key) || []).filter(t => t > cutoff);

    if (timestamps.length >= max) {
      return res.status(429).json({ error: message || 'Too many requests, please try again later' });
    }

    timestamps.push(now);
    hits.set(key, timestamps);
    next();
  };
}

module.exports = { rateLimit };
