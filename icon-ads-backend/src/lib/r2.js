const {
  S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand,
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

function getPublicUrl(key) {
  const base = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  return `${base}/${key}`;
}

module.exports = {
  isConfigured, hasPublicUrl,
  getPresignedUploadUrl, deleteObject, objectExists, putFile, getPublicUrl,
};
