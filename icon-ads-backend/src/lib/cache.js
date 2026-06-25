const store = new Map();

function withCache(ttlMs = 5 * 60 * 1000) {
  return (req, res, next) => {
    if (req.method !== 'GET') return next();
    const key = req.originalUrl;
    const hit = store.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return res.json(hit.data);
    const originalJson = res.json.bind(res);
    res.json = (data) => {
      if (res.statusCode === 200) store.set(key, { data, at: Date.now() });
      return originalJson(data);
    };
    next();
  };
}

function invalidatePrefix(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

module.exports = { withCache, invalidatePrefix };
