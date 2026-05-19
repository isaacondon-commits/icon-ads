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
});
