import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createTimedCache, posterFileName } from '../catalog-performance.js';

test('simultaneous catalog visitors share one DB load; a failed load can retry', async () => {
  let calls = 0;
  const cache = createTimedCache(async () => { calls++; return { videos: [] }; }, 1000);
  const values = await Promise.all(Array.from({ length: 30 }, () => cache.get()));
  assert.equal(calls, 1);
  assert.ok(values.every(value => value === values[0]));
  await cache.get();
  assert.equal(calls, 1);
  let failures = 0;
  const retry = createTimedCache(async () => { if (++failures === 1) throw new Error('offline'); return 'ok'; }, 1000);
  await assert.rejects(retry.get(), /offline/);
  assert.equal(await retry.get(), 'ok');
});

test('admin invalidation prevents an older in-flight response from refilling cache', async () => {
  let finish;
  let calls = 0;
  const cache = createTimedCache(() => ++calls === 1 ? new Promise(resolve => { finish = resolve; }) : 'updated', 1000);
  const first = cache.get();
  await Promise.resolve();
  cache.clear();
  assert.equal(await cache.get(), 'updated');
  finish('old');
  await first;
  assert.equal(await cache.get(), 'updated');
  assert.equal(calls, 2);
});

test('expired entries reload instead of retaining stale catalog data', async () => {
  let calls = 0;
  const cache = createTimedCache(async () => ++calls, 0);
  assert.equal(await cache.get(), 1);
  assert.equal(await cache.get(), 2);
});

test('cover filenames change with source or selected frame, and cannot contain paths', () => {
  const row = { id: '../unsafe', video_file_id: 'private/file.mp4', poster_at: 1 };
  const first = posterFileName(row);
  assert.match(first, /^[a-f0-9]{24}\.jpg$/);
  assert.notEqual(first, posterFileName({ ...row, video_file_id: 'new.mp4' }));
  assert.notEqual(first, posterFileName({ ...row, poster_at: 2 }));
  assert.equal(first, posterFileName({ ...row, title: 'Renamed' }));
  assert.notEqual(posterFileName({ ...row, public_video_url: 'https://cdn.example/a.mp4' }),
    posterFileName({ ...row, public_video_url: 'https://cdn.example/b.mp4' }));
});

test('prebuilt covers load as lazy images without requesting or creating a video', async () => {
  const images = [];
  const browser = {
    URL, URLSearchParams,
    document: { createElement(tag) {
      assert.equal(tag, 'img');
      const img = { setAttribute() {}, complete: true, naturalWidth: 480, style: {} };
      images.push(img);
      return img;
    } },
  };
  vm.runInNewContext(readFileSync(new URL('../public/js/storefront.js', import.meta.url), 'utf8'), browser);
  const inlinePlayer = { style: {} };
  const container = { firstChild: null,
    querySelector(selector) { return selector === 'video' ? inlinePlayer : null; }, insertBefore() {} };
  let ready = 0;
  await browser.Storefront.hydrateVideoPoster({ id: '1', poster_url: '/posters/test.jpg' }, container,
    { onReady() { ready++; } });
  assert.equal(images.length, 1);
  assert.equal(images[0].src, '/posters/test.jpg');
  assert.equal(images[0].loading, 'lazy');
  assert.equal(ready, 1);
  assert.notEqual(inlinePlayer.style.display, 'none', 'Cover hydration must not hide the actual player');
});
