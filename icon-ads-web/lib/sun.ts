// Amanecer / atardecer con el algoritmo del Almanac (US Naval Observatory).
// Puerto del SunCalc.kt de la app para mostrar la previsualización en Ajustes.

const MONTEVIDEO = { lat: -34.9011, lng: -56.1645, tzHours: -3 };
const ZENITH = 90.833;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const norm = (x: number, max: number) => ((x % max) + max) % max;

function dayOfYear(d: Date) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86400000);
}

function event(n: number, lat: number, lng: number, tz: number, rising: boolean): number | null {
  const lngHour = lng / 15;
  const t = rising ? n + (6 - lngHour) / 24 : n + (18 - lngHour) / 24;
  const m = 0.9856 * t - 3.289;
  let l = m + 1.916 * Math.sin(rad(m)) + 0.02 * Math.sin(rad(2 * m)) + 282.634;
  l = norm(l, 360);
  let ra = deg(Math.atan(0.91764 * Math.tan(rad(l))));
  ra = norm(ra, 360);
  ra += Math.floor(l / 90) * 90 - Math.floor(ra / 90) * 90;
  ra /= 15;
  const sinDec = 0.39782 * Math.sin(rad(l));
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(rad(ZENITH)) - sinDec * Math.sin(rad(lat))) / (cosDec * Math.cos(rad(lat)));
  if (Math.abs(cosH) > 1) return null;
  let h = rising ? 360 - deg(Math.acos(cosH)) : deg(Math.acos(cosH));
  h /= 15;
  const meanT = h + ra - 0.06571 * t - 6.622;
  const ut = norm(meanT - lngHour, 24);
  const localT = norm(ut + tz, 24);
  return Math.round(localT * 60);
}

/** { sunriseMin, sunsetMin } en minutos desde medianoche local (Montevideo). */
export function sunTimes(date = new Date()): { sunriseMin: number; sunsetMin: number } {
  const n = dayOfYear(date);
  const { lat, lng, tzHours } = MONTEVIDEO;
  return {
    sunriseMin: event(n, lat, lng, tzHours, true) ?? 6 * 60,
    sunsetMin: event(n, lat, lng, tzHours, false) ?? 19 * 60,
  };
}

export function fmtMin(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export type SchedulePoint = { ref: 'sunrise' | 'sunset'; offsetMin: number; pct: number };

export const DEFAULT_SCHEDULE: SchedulePoint[] = [
  { ref: 'sunrise', offsetMin: -120, pct: 25 },
  { ref: 'sunrise', offsetMin: 0, pct: 55 },
  { ref: 'sunrise', offsetMin: 120, pct: 90 },
  { ref: 'sunset', offsetMin: -120, pct: 90 },
  { ref: 'sunset', offsetMin: 0, pct: 55 },
  { ref: 'sunset', offsetMin: 120, pct: 25 },
];

/** Brillo (0-100) para un minuto del día, según la tabla y los eventos solares. */
export function brightnessAt(minOfDay: number, points: SchedulePoint[], sun: { sunriseMin: number; sunsetMin: number }): number {
  const resolved = points
    .map((p) => ({ t: (p.ref === 'sunset' ? sun.sunsetMin : sun.sunriseMin) + p.offsetMin, v: p.pct }))
    .sort((a, b) => a.t - b.t);
  if (resolved.length === 0) return 100;
  if (minOfDay <= resolved[0].t) return resolved[0].v;
  if (minOfDay >= resolved[resolved.length - 1].t) return resolved[resolved.length - 1].v;
  for (let i = 0; i < resolved.length - 1; i++) {
    const a = resolved[i];
    const b = resolved[i + 1];
    if (minOfDay >= a.t && minOfDay <= b.t) {
      if (b.t === a.t) return b.v;
      return a.v + ((minOfDay - a.t) / (b.t - a.t)) * (b.v - a.v);
    }
  }
  return resolved[resolved.length - 1].v;
}
