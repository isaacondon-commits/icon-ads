// Migra la media de anuncios de Supabase Storage a Cloudflare R2.
// Los bytes van Supabase -> esta máquina -> R2. NO pasan por Render.
// Corré desde icon-ads-backend (para tener @aws-sdk/client-s3 en node_modules).

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const API = 'https://icon-ads-backend.onrender.com';
const API_KEY = process.env.KEY;
const R2_ACCOUNT = '184766a880e207560cdb651d9aec5fd4';
const R2_KEY = '826a97eef98faf0ee1067f12ab4dfbe6';
const R2_SECRET = '09329cef2d8d48cb1a24f68c6e56900d0e55b032246bb9d09c6d2768ebaf6bb0';
const R2_BUCKET = 'iconads-media';
const R2_PUBLIC = 'https://pub-26536a1d97c94c01bb8168b6dfaa25cb.r2.dev';

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_KEY, secretAccessKey: R2_SECRET },
});

const CT = {
  '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
};
const ctFor = (name) => CT[name.slice(name.lastIndexOf('.')).toLowerCase()] || 'application/octet-stream';

async function r2Has(key) {
  try { await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key })); return true; }
  catch { return false; }
}

async function main() {
  const list = await fetch(`${API}/api/admin/media/list`, { headers: { 'X-API-Key': API_KEY } }).then((r) => r.json());
  console.log(`Anuncios: ${list.count}`);

  // Dedupe por filename (varios anuncios pueden compartir archivo).
  const byFile = new Map();
  for (const ad of list.ads) {
    if (!byFile.has(ad.filename)) byFile.set(ad.filename, ad.fileUrl);
  }
  console.log(`Archivos únicos: ${byFile.size}`);

  let done = 0, skipped = 0, failed = 0, bytes = 0;
  for (const [filename, srcUrl] of byFile) {
    const key = `media/${filename}`;
    try {
      if (await r2Has(key)) { skipped++; process.stdout.write('.'); continue; }
      const resp = await fetch(srcUrl);
      if (!resp.ok) throw new Error(`GET src HTTP ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      await s3.send(new PutObjectCommand({
        Bucket: R2_BUCKET, Key: key, Body: buf, ContentLength: buf.length, ContentType: ctFor(filename),
      }));
      bytes += buf.length; done++;
      process.stdout.write('+');
    } catch (e) {
      failed++;
      console.log(`\n  FALLO ${filename}: ${e.message}`);
    }
  }
  console.log(`\nSubidos: ${done} | ya estaban: ${skipped} | fallidos: ${failed} | ${(bytes / 1e6).toFixed(1)} MB movidos`);

  if (failed) { console.log('Hay fallidos — NO reapunto URLs. Revisá.'); process.exit(1); }

  // Reapuntar las URLs de TODOS los anuncios a R2.
  const items = list.ads.map((ad) => ({ id: ad.id, fileUrl: `${R2_PUBLIC}/media/${ad.filename}` }));
  const res = await fetch(`${API}/api/admin/media/relink`, {
    method: 'POST', headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  }).then((r) => r.json());
  console.log(`Relink en DB: ${JSON.stringify(res)}`);

  // Verificación: 3 URLs de R2 al azar.
  const sample = [...byFile.keys()].slice(0, 3);
  for (const f of sample) {
    const u = `${R2_PUBLIC}/media/${f}`;
    const r = await fetch(u, { method: 'HEAD' });
    console.log(`  ${r.status}  ${u}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
