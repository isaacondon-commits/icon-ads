// IDs de tablets que deben re-chequear la APK publicada en su próxima conexión,
// ignorando el guard local de "esta versión ya la intenté" (promptedApkVersion).
// En memoria, se resetea al reiniciar el server — es una señal efímera, igual
// que forceSyncFlags.
module.exports = new Set();
