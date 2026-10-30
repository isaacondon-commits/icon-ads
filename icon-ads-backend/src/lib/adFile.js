// Validación y guardado del archivo de un anuncio. Lo usan la subida del
// panel (routes/ads.js) y la del portal de empresas (routes/portalUpload.js).

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const r2 = require('./r2');
const supabaseStorage = require('./supabase-storage');

const IMAGE_MAX = 10 * 1024 * 1024;
const VIDEO_MAX = 100 * 1024 * 1024;
const ALLOWED_EXT = /\.(mp4|jpg|jpeg|png|webp)$/i;

const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

function detectMimeFromBuffer(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return 'video/mp4';
  return null;
}

async function compressImage(buffer, mimetype) {
  try {
    const s = sharp(buffer).resize(1920, 1080, { fit: 'inside', withoutEnlargement: true });
    if (mimetype === 'image/png') return await s.png({ quality: 80 }).toBuffer();
    if (mimetype === 'image/webp') return await s.webp({ quality: 80 }).toBuffer();
    return await s.jpeg({ quality: 80 }).toBuffer();
  } catch {
    return buffer;
  }
}

// R2 primero (mismo formato de key que /api/ads/presign), después Supabase y,
// en desarrollo, disco. Devuelve diskPath para poder borrarlo si algo falla.
async function storeAdFile(buffer, originalname, mimetype) {
  const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const filename = `${unique}${path.extname(originalname)}`;
  if (r2.isConfigured) {
    const key = `uploads/${filename}`;
    await r2.putBuffer(key, buffer, mimetype);
    return { fileUrl: r2.getPublicUrl(key), filename, storage: 'r2', diskPath: null };
  }
  if (supabaseStorage.isConfigured) {
    return { fileUrl: await supabaseStorage.uploadFile(filename, buffer, mimetype), filename, storage: 'supabase', diskPath: null };
  }
  const diskPath = path.join(uploadDir, filename);
  fs.writeFileSync(diskPath, buffer);
  return { fileUrl: `/uploads/${filename}`, filename, storage: 'disk', diskPath };
}

module.exports = { IMAGE_MAX, VIDEO_MAX, ALLOWED_EXT, uploadDir, detectMimeFromBuffer, compressImage, storeAdFile };
