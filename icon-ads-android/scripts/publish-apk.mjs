#!/usr/bin/env node
// Publica la APK compilada en el panel (POST /api/admin/apk) usando una API key,
// sin sesión de navegador. Opcionalmente fuerza la actualización en toda la flota.
//
// Uso:
//   node scripts/publish-apk.mjs [--release|--debug] [--force] [--apk <ruta>]
//
// Config (cualquiera de las dos):
//   - env ICONADS_API_KEY  y  ICONADS_PANEL_URL
//   - archivo scripts/publish.local.json  ->  { "apiKey": "...", "panelUrl": "..." }
//     (gitignored)
//
// versionCode / versionName se leen de app/build.gradle.kts.

import { readFileSync, existsSync } from 'node:fs';
import { basename, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ANDROID_ROOT = resolve(HERE, '..');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const argVal = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const variant = has('--debug') ? 'debug' : 'release';
const force = has('--force');

// ── Config ────────────────────────────────────────────────────────────────
let apiKey = process.env.ICONADS_API_KEY || '';
let panelUrl = process.env.ICONADS_PANEL_URL || '';
const localCfgPath = resolve(HERE, 'publish.local.json');
if (existsSync(localCfgPath)) {
  const c = JSON.parse(readFileSync(localCfgPath, 'utf8'));
  apiKey = apiKey || c.apiKey || '';
  panelUrl = panelUrl || c.panelUrl || '';
}
panelUrl = (panelUrl || 'https://icon-ads-backend.onrender.com').replace(/\/+$/, '');
if (!apiKey) {
  console.error('Falta la API key. Seteá ICONADS_API_KEY o creá scripts/publish.local.json');
  process.exit(1);
}

// ── versionCode / versionName ─────────────────────────────────────────────
const gradle = readFileSync(resolve(ANDROID_ROOT, 'app/build.gradle.kts'), 'utf8');
const versionCode = Number((gradle.match(/versionCode\s*=\s*(\d+)/) || [])[1]);
const versionName = (gradle.match(/versionName\s*=\s*"([^"]+)"/) || [])[1];
if (!versionCode || !versionName) {
  console.error('No pude leer versionCode/versionName de app/build.gradle.kts');
  process.exit(1);
}

// ── APK ──────────────────────────────────────────────────────────────────
const apkPath = argVal('--apk')
  ? resolve(argVal('--apk'))
  : resolve(ANDROID_ROOT, `app/build/outputs/apk/${variant}/app-${variant}.apk`);
if (!existsSync(apkPath)) {
  console.error(`No existe la APK: ${apkPath}\nCompilá primero (gradlew assemble${variant[0].toUpperCase()}${variant.slice(1)}).`);
  process.exit(1);
}

console.log(`Publicando ${basename(apkPath)}  v${versionName} (código ${versionCode})  →  ${panelUrl}`);

// ── Upload ───────────────────────────────────────────────────────────────
const buf = readFileSync(apkPath);
const fd = new FormData();
fd.append('file', new Blob([buf], { type: 'application/vnd.android.package-archive' }), basename(apkPath));
fd.append('versionCode', String(versionCode));
fd.append('versionName', versionName);

const up = await fetch(`${panelUrl}/api/admin/apk`, {
  method: 'POST',
  headers: { 'X-API-Key': apiKey },
  body: fd,
});
const upBody = await up.json().catch(() => ({}));
if (!up.ok) {
  console.error(`Falló la publicación (HTTP ${up.status}):`, upBody.error || upBody);
  process.exit(1);
}
console.log(`✓ Publicada: v${upBody.versionName} (código ${upBody.versionCode})`);

// ── Force (opcional) ─────────────────────────────────────────────────────
if (force) {
  const fr = await fetch(`${panelUrl}/api/admin/force-update-apk`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey },
  });
  const frBody = await fr.json().catch(() => ({}));
  if (!fr.ok) {
    console.error(`Falló el force-update (HTTP ${fr.status}):`, frBody.error || frBody);
    process.exit(1);
  }
  console.log(`✓ ${frBody.message}`);
}
