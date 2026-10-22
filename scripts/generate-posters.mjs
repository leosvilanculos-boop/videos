// Run before deployment: FFMPEG_PATH=/path/to/ffmpeg npm run posters:generate
// Reads the configured DB/storage; writes only local, small JPEG files.
import 'dotenv/config';
import { mkdir, stat, rename, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { posterFileName } from '../catalog-performance.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'public/posters');
const env = (...names) => names.map(name => process.env[name]?.trim()).find(Boolean) || '';
const binary = env('FFMPEG_PATH') || 'ffmpeg';
const db = createClient(env('SUPABASE_URL', 'VITE_SUPABASE_URL'),
  env('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } });
let result = await db.from('videos').select('*, video_sources(*)').eq('is_active', true);
if (result.error && /relationship|foreign|video_sources|schema cache/i.test(result.error.message)) {
  result = await db.from('videos').select('*').eq('is_active', true);
}
if (result.error) throw new Error(result.error.message);
const rows = result.data || [];
const config = (await db.from('site_config').select('wasabi_config').limit(1).maybeSingle()).data?.wasabi_config || {};
const storage = {
  region: env('WASABI_REGION', 'VITE_WASABI_REGION') || config.region,
  endpoint: env('WASABI_ENDPOINT', 'VITE_WASABI_ENDPOINT') || config.endpoint,
  credentials: {
    accessKeyId: env('WASABI_ACCESS_KEY', 'VITE_WASABI_ACCESS_KEY') || config.accessKey || config.access_key,
    secretAccessKey: env('WASABI_SECRET_KEY', 'VITE_WASABI_SECRET_KEY') || config.secretKey || config.secret_key,
  },
  forcePathStyle: true,
};
const bucket = env('WASABI_BUCKET', 'VITE_WASABI_BUCKET') || config.bucket;
const s3 = new S3Client(storage);
await mkdir(out, { recursive: true });
let generated = 0, skipped = 0, failed = 0, bytes = 0;
async function generate(row) {
  const name = posterFileName(row);
  const destination = path.join(out, name);
  try {
    const existing = await stat(destination).catch(() => null);
    if (existing?.size) { skipped++; bytes += existing.size; return; }
    const sources = [...(row.video_sources || [])].sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
    const key = row.video_file_id || sources[0]?.source_file_id;
    const url = /^https?:\/\//i.test(row.public_video_url || '') ? row.public_video_url
      : key ? await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 3600 }) : '';
    if (!url) throw new Error('No video source');
    const t = Number(row.poster_at);
    const time = Number.isFinite(t) && t >= 0 ? t : 1;
    const partial = destination + '.partial.jpg';
    await new Promise((resolve, reject) => {
      let diagnostic = '';
      const ffmpeg = spawn(binary, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-rw_timeout', '20000000', '-ss', String(time), '-i', url, '-frames:v', '1',
        '-vf', 'scale=480:270:force_original_aspect_ratio=increase,crop=480:270', '-q:v', '5', '-threads', '1', partial], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      ffmpeg.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-2000); });
      const timer = setTimeout(() => ffmpeg.kill(), 35_000);
      ffmpeg.once('error', error => { clearTimeout(timer); reject(error); });
      ffmpeg.once('exit', code => {
        clearTimeout(timer);
        const error = new Error('Frame extraction failed');
        error.code = /403|AccessDenied/i.test(diagnostic) ? 'SOURCE_FORBIDDEN'
          : /404|not found/i.test(diagnostic) ? 'SOURCE_MISSING'
          : /Invalid data|moov atom/i.test(diagnostic) ? 'INVALID_VIDEO' : code == null ? 'TIMEOUT' : 'FFMPEG_FAILED';
        code === 0 ? resolve() : reject(error);
      });
    });
    const size = (await stat(partial)).size;
    if (!size) throw new Error('Empty cover');
    await rename(partial, destination);
    generated++; bytes += size;
    console.log(`Cover ${generated + skipped}/${rows.length}: ${name} (${Math.round(size / 1024)} KB)`);
  } catch (error) {
    failed++;
    await rm(destination + '.partial.jpg', { force: true });
    // Never log signed source URLs or storage credentials.
    console.error(`Cover failed: ${name} (${error.code || error.name || 'Error'})`);
  }
}
let next = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (next < rows.length) await generate(rows[next++]);
}));
s3.destroy();
console.log(JSON.stringify({ total: rows.length, generated, skipped, failed, bytes }));
if (failed) process.exitCode = 1;
