const records = [];

function record(method, path, ms, status) {
  records.push({ method, path, ms, status, ts: new Date().toISOString() });
  if (records.length > 500) records.shift();
  if (ms > 2000) console.warn(`[slow] ${method} ${path} ${status} — ${ms}ms`);
}

function getSummary() {
  if (records.length === 0) return { count: 0, avg: 0, p95: 0, slow: [], recent: [] };
  const sorted = [...records].sort((a, b) => a.ms - b.ms);
  const p95 = sorted[Math.floor(sorted.length * 0.95)]?.ms ?? 0;
  const avg = Math.round(records.reduce((s, r) => s + r.ms, 0) / records.length);
  return {
    count: records.length,
    avg,
    p95,
    slow: records.filter((r) => r.ms > 1000).slice(-10).reverse(),
    recent: records.slice(-20).reverse(),
  };
}

module.exports = { record, getSummary };
