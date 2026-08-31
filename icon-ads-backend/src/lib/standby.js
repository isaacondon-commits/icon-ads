// Tiempo de standby = cuánto tiempo estuvo parado el taxi.
//
// Se deriva del rastro GPS (`tablet_locations`, ~1 punto/min). No requiere
// cambios en la app: agrupa puntos consecutivos que se mantienen dentro de un
// radio chico y suma esos tramos. Un hueco largo de tiempo en la misma
// posición (tablet dormida/en Doze con el auto apagado) también cuenta como
// standby; un hueco largo tras haberse movido se marca como "desconocido" y no
// suma ni a standby ni a movimiento.
//
// Follow-up (app v1.10): que el PowerController reporte los intervalos de
// quietud/energía directamente y el backend los prefiera sobre esta estimación.

const RADIUS_M = 60;          // dentro de este radio = "no se movió"
const MIN_STANDBY_MS = 5 * 60_000;   // tramos parados de menos de 5 min no cuentan
const GAP_CAP_MS = 20 * 60_000;      // hueco mayor a esto tras moverse = desconocido

function haversineM(aLat, aLng, bLat, bLng) {
  const R = 6_371_000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * @param {Array<{lat:number,lng:number,created_at:Date|string}>} points  orden ASC por tiempo
 * @returns {{standbyMinutes:number, movingMinutes:number, unknownMinutes:number,
 *            firstSeen:string|null, lastSeen:string|null,
 *            segments:Array<{start:string,end:string,minutes:number,lat:number,lng:number}>}}
 */
function computeStandby(points) {
  const empty = {
    standbyMinutes: 0, movingMinutes: 0, unknownMinutes: 0,
    firstSeen: null, lastSeen: null, segments: [],
  };
  if (!Array.isArray(points) || points.length < 2) return empty;

  const pts = points.map((p) => ({
    lat: Number(p.lat),
    lng: Number(p.lng),
    t: new Date(p.created_at).getTime(),
  })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(p.t));
  if (pts.length < 2) return empty;

  const segments = [];
  let standbyMs = 0;
  let unknownMs = 0;

  let anchor = pts[0];        // primer punto del tramo parado actual
  let runStart = pts[0].t;
  let runEnd = pts[0].t;

  const closeRun = () => {
    const dur = runEnd - runStart;
    if (dur >= MIN_STANDBY_MS) {
      standbyMs += dur;
      segments.push({
        start: new Date(runStart).toISOString(),
        end: new Date(runEnd).toISOString(),
        minutes: Math.round(dur / 60_000),
        lat: anchor.lat,
        lng: anchor.lng,
      });
    }
  };

  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const prev = pts[i - 1];
    const movedFar = haversineM(anchor.lat, anchor.lng, p.lat, p.lng) > RADIUS_M;
    const bigGap = p.t - prev.t > GAP_CAP_MS;

    if (!movedFar) {
      // Sigue en el mismo lugar (con o sin hueco de datos): extiende el tramo.
      runEnd = p.t;
    } else {
      // Se movió: cierra el tramo parado.
      closeRun();
      if (bigGap) {
        // Hueco largo Y cambió de posición: no sabemos qué pasó en el medio.
        unknownMs += p.t - prev.t;
      }
      anchor = p;
      runStart = p.t;
      runEnd = p.t;
    }
  }
  closeRun();

  const firstT = pts[0].t;
  const lastT = pts[pts.length - 1].t;
  const spanMin = (lastT - firstT) / 60_000;
  const standbyMinutes = Math.round(standbyMs / 60_000);
  const unknownMinutes = Math.round(unknownMs / 60_000);
  const movingMinutes = Math.max(0, Math.round(spanMin - standbyMinutes - unknownMinutes));

  return {
    standbyMinutes,
    movingMinutes,
    unknownMinutes,
    firstSeen: new Date(firstT).toISOString(),
    lastSeen: new Date(lastT).toISOString(),
    segments,
  };
}

module.exports = { computeStandby, RADIUS_M, MIN_STANDBY_MS };
