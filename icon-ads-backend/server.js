require('dotenv').config();
const runStartupMigrations = require('./src/lib/startup-migrate');
const app = require('./src/app');

const PORT = process.env.PORT || 3000;

runStartupMigrations().then(async () => {
  // Load system config into memory after migrations complete
  if (app.refreshMaintenanceMode) await app.refreshMaintenanceMode().catch(() => {});
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ICON ADS] Server running on port ${PORT} — ${process.env.NODE_ENV || 'development'}`);
  });
  // CORS de R2 para la subida directa desde el panel. En segundo plano: un
  // fallo acá no afecta el arranque. El resultado queda en systemConfig.
  const r2 = require('./src/lib/r2');
  const prisma = require('./src/lib/prisma');
  const origins = (process.env.FRONTEND_URL || 'http://localhost:3001').split(',').map((s) => s.trim()).filter(Boolean);
  r2.ensureUploadCors(origins)
    .catch((err) => `error: ${err.message}`)
    .then((status) => {
      console.log(`[r2] CORS de subida: ${status}`);
      const value = `${new Date().toISOString()} ${status}`;
      return prisma.systemConfig.upsert({ where: { key: 'r2_cors_status' }, update: { value }, create: { key: 'r2_cors_status', value } });
    })
    .catch(() => {});
});
