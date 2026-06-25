const { createClient } = require('@supabase/supabase-js');

const BUCKET = 'ads';
const isConfigured = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);

let supabase = null;
let bucketReady = false;

if (isConfigured) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

async function ensureBucket() {
  if (!supabase || bucketReady) return;
  try {
    const { data } = await supabase.storage.getBucket(BUCKET);
    if (!data) {
      const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
      if (error) throw error;
      console.log(`[supabase-storage] Bucket "${BUCKET}" creado`);
    }
    bucketReady = true;
  } catch (err) {
    console.warn('[supabase-storage] ensureBucket error:', err.message);
  }
}

async function uploadFile(filename, buffer, mimetype) {
  await ensureBucket();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(filename, buffer, { contentType: mimetype, upsert: false });
  if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);
  return getPublicUrl(filename);
}

async function deleteFile(filename) {
  if (!supabase) return;
  try {
    await supabase.storage.from(BUCKET).remove([filename]);
  } catch (err) {
    console.warn('[supabase-storage] deleteFile failed:', err.message);
  }
}

function getPublicUrl(filename) {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  return `${base}/storage/v1/object/public/${BUCKET}/${filename}`;
}

module.exports = { isConfigured, ensureBucket, uploadFile, deleteFile, getPublicUrl };
