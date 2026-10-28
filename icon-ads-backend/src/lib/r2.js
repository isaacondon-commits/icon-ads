const {
  S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand,
  GetBucketCorsCommand, PutBucketCorsCommand,
} = require('@aws-sdk/client-s3');
const fs = require('fs');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const isConfigured = !!(
  process.env.R2_ACCOUNT_ID &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  process.env.R2_BUCKET
);

// Habilitado sólo si además hay URL pública (redirect de /package).
const hasPublicUrl = isConfigured && !!process.env.R2_PUBLIC_URL;

let client = null;
if (isConfigured) {
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

async function getPresignedUploadUrl(key, contentType, expiresIn = 300) {
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client, command, { expiresIn });
}

async function deleteObject(key) {
  if (!client) return;
  try {
    await client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
  } catch (err) {
    console.warn('[r2] deleteObject failed:', err.message);
  }
}

// ¿Existe el objeto? (para el caché de ZIPs — sobrevive los redeploys de Render).
async function objectExists(key) {
  if (!client) return false;
  try {
    await client.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
    return true;
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return false;
    console.warn('[r2] objectExists error:', err.name, err.message);
    return false;
  }
}

// Sube un archivo de disco a R2.
async function putFile(key, filePath, contentType) {
  if (!client) throw new Error('R2 no configurado');
  const stat = fs.statSync(filePath);
  await client.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    Body: fs.createReadStream(filePath),
    ContentLength: stat.size,
    ContentType: contentType,
  }));
  return stat.size;
}

// Sube un buffer en memoria a R2 (para el APK subido vía multipart al backend).
async function putBuffer(key, buffer, contentType) {
  if (!client) throw new Error('R2 no configurado');
  await client.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentLength: buffer.length,
    ContentType: contentType,
  }));
  return buffer.length;
}

// El panel sube la media directo del navegador a R2 (URL prefirmada): sin una
// regla CORS para su origen el navegador corta el PUT y el panel muestra
// "Error de red". Agrega la regla si falta, conservando las que ya existen.
// Nunca saca nada. Devuelve un texto con el resultado (para systemConfig).
async function ensureUploadCors(origins) {
  if (!client) return 'r2 no configurado';
  const Bucket = process.env.R2_BUCKET;
  let rules = [];
  try {
    const r = await client.send(new GetBucketCorsCommand({ Bucket }));
    rules = r.CORSRules || [];
  } catch (err) {
    if (err.name !== 'NoSuchCORSConfiguration' && err.Code !== 'NoSuchCORSConfiguration') {
      return `no se pudo leer CORS: ${err.name} ${err.message}`;
    }
  }
  const covers = (o) => rules.some((r) =>
    (r.AllowedOrigins || []).some((a) => a === '*' || a === o)
    && (r.AllowedMethods || []).includes('PUT'));
  const missing = origins.filter((o) => !covers(o));
  if (!missing.length) return `ok: ya permitido (${rules.length} regla/s)`;
  const next = [...rules, {
    AllowedOrigins: missing,
    AllowedMethods: ['GET', 'PUT', 'HEAD'],
    AllowedHeaders: ['*'],
    ExposeHeaders: ['ETag'],
    MaxAgeSeconds: 3600,
  }];
  try {
    await client.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: { CORSRules: next } }));
    return `ok: agregado ${missing.join(', ')} (antes ${rules.length} regla/s)`;
  } catch (err) {
    return `no se pudo escribir CORS: ${err.name} ${err.message}`;
  }
}

function getPublicUrl(key) {
  const base = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  return `${base}/${key}`;
}

module.exports = {
  isConfigured, hasPublicUrl,
  getPresignedUploadUrl, deleteObject, objectExists, putFile, putBuffer, getPublicUrl,
  ensureUploadCors,
};
