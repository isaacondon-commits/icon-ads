#!/usr/bin/env node
// Publica la APK compilada usando una API key, sin sesión de navegador.
// Opcionalmente fuerza la actualización en toda la flota.
//
// El APK se sube DIRECTO a R2 (Cloudflare) con una URL prefirmada que da el
// backend — los bytes NO pasan por Render. Después se registra la versión con
// un POST liviano en JSON. La flota baja el APK de R2 (egress gratis).
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

// ── 1) URL prefirmada de R2 ──────────────────────────────────────────────
const APK_CT = 'application/vnd.android.package-archive';
const buf = readFileSync(apkPath);

const pre = await fetch(`${panelUrl}/api/admin/apk/presign`, {
  method: 'POST',
  headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ versionCode }),
});
const preBody = await pre.json().catch(() => ({}));
if (!pre.ok || !preBody.uploadUrl) {
  console.error(`Falló el presign (HTTP ${pre.status}):`, preBody.error || preBody);
  process.exit(1);
}

// ── 2) PUT del APK directo a R2 (no pasa por Render) ─────────────────────
const put = await fetch(preBody.uploadUrl, {
  method: 'PUT',
  headers: { 'Content-Type': APK_CT },
  body: buf,
});
if (!put.ok) {
  console.error(`Falló la subida a R2 (HTTP ${put.status}):`, await put.text().catch(() => ''));
  process.exit(1);
}
console.log(`✓ APK subido a R2 (${(buf.length / 1e6).toFixed(1)} MB, directo, 0 bytes por Render)`);

// ── 3) Registrar la versión (POST liviano en JSON) ─────────────────────
const up = await fetch(`${panelUrl}/api/admin/apk`, {
  method: 'POST',
  headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ versionCode, versionName }),
});
const upBody = await up.json().catch(() => ({}));
if (!up.ok) {
  console.error(`Falló la publicación (HTTP ${up.status}):`, upBody.error || upBody);
  process.exit(1);
}
console.log(`✓ Publicada: v${upBody.versionName} (código ${upBody.versionCode})  →  ${upBody.url}`);

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
