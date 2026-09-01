// Tabla de brillo por horario solar. Las tablets no tienen sensor de luz, así
// que el brillo sigue el amanecer/atardecer reales (calculados en el dispositivo
// para Montevideo). Cada punto: relativo a un evento solar ("sunrise"/"sunset")
// con un offset en minutos, y un % de brillo. Entre puntos se interpola lineal;
// antes del primero / después del último, se mantiene el valor del extremo.

const DEFAULT_BRIGHTNESS_SCHEDULE = {
  points: [
    { ref: 'sunrise', offsetMin: -120, pct: 25 },
    { ref: 'sunrise', offsetMin: 0, pct: 55 },
    { ref: 'sunrise', offsetMin: 120, pct: 90 },
    { ref: 'sunset', offsetMin: -120, pct: 90 },
    { ref: 'sunset', offsetMin: 0, pct: 55 },
    { ref: 'sunset', offsetMin: 120, pct: 25 },
  ],
};

// Devuelve un schedule normalizado, o null si no tiene forma válida.
function validateSchedule(obj) {
  if (!obj || !Array.isArray(obj.points) || obj.points.length < 2) return null;
  const points = [];
  for (const p of obj.points) {
    const ref = p.ref === 'sunset' ? 'sunset' : p.ref === 'sunrise' ? 'sunrise' : null;
    const offsetMin = Number(p.offsetMin);
    const pct = Number(p.pct);
    if (!ref || !Number.isFinite(offsetMin) || !Number.isFinite(pct)) return null;
    points.push({
      ref,
      offsetMin: Math.max(-720, Math.min(720, Math.round(offsetMin))),
      pct: Math.max(0, Math.min(100, Math.round(pct))),
    });
  }
  return { points };
}

function safeParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}

// El string JSON que se manda a las tablets: el configurado si es válido, si no
// el default.
function resolveScheduleJson(rawValue) {
  const v = rawValue ? validateSchedule(safeParse(rawValue)) : null;
  return JSON.stringify(v || DEFAULT_BRIGHTNESS_SCHEDULE);
}

module.exports = { DEFAULT_BRIGHTNESS_SCHEDULE, validateSchedule, safeParse, resolveScheduleJson };
