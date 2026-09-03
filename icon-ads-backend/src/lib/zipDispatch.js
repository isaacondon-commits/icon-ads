// Dispara el armado del ZIP de una playlist en GitHub Actions (repo
// iconads-zip-builder) via repository_dispatch, para que NO se arme en Render.
// Inerte si faltan GITHUB_DISPATCH_TOKEN o GITHUB_ZIP_REPO.

const enabled = !!(process.env.GITHUB_DISPATCH_TOKEN && process.env.GITHUB_ZIP_REPO);

// Anti-spam: no re-disparar el mismo hash dentro de esta ventana.
const RECENT_TTL_MS = 5 * 60 * 1000;
const recent = new Map(); // hash -> timestamp

function recentlyDispatched(hash) {
  const t = recent.get(hash);
  if (t && Date.now() - t < RECENT_TTL_MS) return true;
  return false;
}

// payload: { playlistId, version, hash, playlistJson, media: [{name,url}] }
async function dispatchBuild(payload) {
  if (!enabled) return { dispatched: false, reason: 'no configurado' };
  if (recentlyDispatched(payload.hash)) return { dispatched: false, reason: 'ya disparado hace poco' };
  recent.set(payload.hash, Date.now());
  // limpiar viejos
  if (recent.size > 200) {
    const cutoff = Date.now() - RECENT_TTL_MS;
    for (const [k, v] of recent) if (v < cutoff) recent.delete(k);
  }
  try {
    const r = await fetch(`https://api.github.com/repos/${process.env.GITHUB_ZIP_REPO}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_DISPATCH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'icon-ads-backend',
      },
      body: JSON.stringify({ event_type: 'build-zip', client_payload: payload }),
    });
    if (r.status === 204) {
      console.log(`[zipDispatch] build-zip disparado (playlist ${payload.playlistId} hash ${payload.hash.slice(0, 12)})`);
      return { dispatched: true };
    }
    const body = await r.text().catch(() => '');
    console.warn(`[zipDispatch] fallo HTTP ${r.status}: ${body.slice(0, 200)}`);
    recent.delete(payload.hash); // permitir reintento
    return { dispatched: false, reason: `HTTP ${r.status}` };
  } catch (e) {
    console.warn('[zipDispatch] error:', e.message);
    recent.delete(payload.hash);
    return { dispatched: false, reason: e.message };
  }
}

module.exports = { enabled, dispatchBuild };
