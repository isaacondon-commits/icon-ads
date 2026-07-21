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

// Direct-upload path (#network-error-large-videos) — the browser PUTs the file
// straight to Supabase using this URL, bypassing the backend entirely so a
// 100MB video doesn't have to round-trip through Render's request timeout
// twice (client→backend, then backend→Supabase).
async function getSignedUploadUrl(filename) {
  await ensureBucket();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(filename);
  if (error) throw new Error(`Supabase createSignedUploadUrl failed: ${error.message}`);
  return { uploadUrl: data.signedUrl, path: data.path };
}

async function deleteFile(filename) {
  if (!supabase) return;
  try {
    await supabase.storage.from(BUCKET).remove([filename]);
  } catch (err) {
    console.warn('[supabase-storage] deleteFile failed:', err.message);
  }
}

// Sums real object sizes from Storage (paginated — list() caps at 1000/call)
// rather than trusting anything cached in our own DB, so it stays correct
// even if a row and its file ever drift out of sync.
async function getUsageBytes() {
  if (!supabase) return { totalBytes: 0, fileCount: 0 };
  let totalBytes = 0;
  let fileCount = 0;
  let offset = 0;
  const limit = 1000;
  for (;;) {
    const { data, error } = await supabase.storage.from(BUCKET).list('', { limit, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`Supabase Storage list failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const f of data) {
      if (f.metadata?.size != null) { totalBytes += f.metadata.size; fileCount += 1; }
    }
    if (data.length < limit) break;
    offset += limit;
  }
  return { totalBytes, fileCount };
}

function getPublicUrl(filename) {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  return `${base}/storage/v1/object/public/${BUCKET}/${filename}`;
}

module.exports = { isConfigured, ensureBucket, uploadFile, deleteFile, getPublicUrl, getSignedUploadUrl, getUsageBytes };
