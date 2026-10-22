import crypto from 'node:crypto';

// One in-flight load per cache prevents a burst of visitors from repeating DB work.
export function createTimedCache(load, ttlMs) {
  let value;
  let expiresAt = 0;
  let pending;
  let generation = 0;
  return {
    get() {
      if (Date.now() < expiresAt) return Promise.resolve(value);
      if (pending) return pending;
      const current = generation;
      const request = Promise.resolve().then(load).then(result => {
        if (generation === current) {
          value = result;
          expiresAt = Date.now() + ttlMs;
        }
        return result;
      }).finally(() => { if (pending === request) pending = null; });
      pending = request;
      return request;
    },
    clear() {
      generation += 1;
      expiresAt = 0;
      pending = null;
    },
  };
}

// Source and frame time are part of the name, so changed videos cannot reuse old covers.
export function posterFileName(row) {
  const sources = [...(row.video_sources || [])].sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  const publicUrl = String(row.public_video_url || '').trim();
  const source = /^https?:\/\//i.test(publicUrl) ? publicUrl : row.video_file_id || sources[0]?.source_file_id || '';
  const at = Number(row.poster_at);
  const time = Number.isFinite(at) && at >= 0 ? at : 1;
  return crypto.createHash('sha256').update(JSON.stringify([String(row.id), source, time])).digest('hex').slice(0, 24) + '.jpg';
}
