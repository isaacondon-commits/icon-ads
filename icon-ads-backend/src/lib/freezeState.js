// Interruptor maestro "producción congelada". Cuando está ON:
//  - GET /api/device/package     -> 403 SIEMPRE, sin armar ni servir nada
//  - GET /api/device/sync        -> responde needsUpdate:false + frozen:true
//  - las tablets siguen reproduciendo su contenido local, no descargan NADA
//
// Estado cacheado en memoria y refrescado cada 20 s desde systemConfig
// (fleet_frozen = '1' / '0'), igual que maintenanceMode. Así el chequeo en el
// hot-path de /package y /sync es instantáneo, sin query.

const prisma = require('./prisma');

let frozen = true; // arranca congelado hasta confirmar lo contrario

async function refresh() {
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: 'fleet_frozen' } });
    frozen = row?.value !== '0'; // ausente o '1' => congelado; sólo '0' descongela
  } catch { /* DB no lista todavía: mantener el último valor */ }
}

setInterval(refresh, 20_000);
refresh();

module.exports = {
  isFrozen: () => frozen,
  refresh,
  async set(on) {
    frozen = !!on;
    await prisma.systemConfig.upsert({
      where: { key: 'fleet_frozen' },
      update: { value: on ? '1' : '0' },
      create: { key: 'fleet_frozen', value: on ? '1' : '0' },
    });
    return frozen;
  },
};
