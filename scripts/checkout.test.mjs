import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import http from 'node:http';
import { test } from 'node:test';
import express from 'express';
import { registerSecureCheckoutRedirects } from '../secure-checkout.js';

const browser = { URL, URLSearchParams };
vm.runInNewContext(readFileSync(new URL('../public/js/storefront.js', import.meta.url), 'utf8'), browser);
const storefront = browser.Storefront;

async function withServer(origin, run) {
  const app = express();
  registerSecureCheckoutRedirects(app, origin);
  // A legacy handler must never be reached, including on configuration errors.
  app.get('/api/payjsr-checkout', (req, res) => res.status(500).send('Legacy provider reached'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('video and bundle clicks reach the Secure payment page without browser prices or return URLs', async () => {
  await withServer('https://secure.example/old-path/', async base => {
    for (const [path, expected] of [
      [storefront.checkoutUrl('', 0.01, 'Fake', 'Untrusted title', 'video & 1'), { video_id: 'video & 1' }],
      [storefront.bundleCheckoutUrl(), { bundle: 'true' }],
      ['/api/payjsr-checkout?bundle=all&amount=1&success_url=https://untrusted.example', { bundle: 'true' }],
      ['/api/paypal-checkout?video_id=video-2&amount=1', { video_id: 'video-2' }],
      ['/api/walled-checkout?video_id=video-3', { video_id: 'video-3' }],
    ]) {
      const response = await fetch(base + path, { redirect: 'manual' });
      assert.equal(response.status, 303);
      assert.equal(response.headers.get('cache-control'), 'no-store, private');
      const target = new URL(response.headers.get('location'));
      assert.equal(target.origin, 'https://secure.example');
      assert.equal(target.pathname, '/checkout');
      assert.match(target.searchParams.get('requestKey'), /^[a-f0-9-]{36}$/);
      target.searchParams.delete('requestKey');
      assert.deepEqual(Object.fromEntries(target.searchParams), expected);
    }
  });
});

test('missing or unsafe Secure configuration cannot fall back to a local provider', async () => {
  for (const origin of ['', 'not-a-url', 'http://secure.example', 'javascript:alert(1)', 'https://user:pass@secure.example']) {
    await withServer(origin, async base => {
      const response = await fetch(base + '/api/payjsr-checkout?video_id=video-1', { redirect: 'manual' });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('location'), null);
    });
  }
  await withServer('https://secure.example', async base => {
    const status = await new Promise((resolve, reject) => {
      http.get(base + '/api/checkout?video_id=video-1', { headers: { Host: 'secure.example' } }, response => {
        response.resume();
        resolve(response.statusCode);
      }).on('error', reject);
    });
    assert.equal(status, 503);
  });
});

test('missing or ambiguous video identity is rejected', async () => {
  assert.equal(storefront.checkoutUrl('', 10, '', '', ''), null);
  await withServer('https://secure.example', async base => {
    for (const query of ['', '?amount=10', '?video_id=a&video_id=b']) {
      const response = await fetch(base + '/api/checkout' + query, { redirect: 'manual' });
      assert.equal(response.status, 400);
    }
  });
});

test('catalog and watch button handlers use the shared checkout entry point', () => {
  for (const page of ['index', 'watch']) {
    const html = readFileSync(new URL(`../public/${page}.html`, import.meta.url), 'utf8');
    assert.doesNotMatch(html, /PrivacyCheckout|privacy-checkout|dlg-video-payment/);
    // Compile all inline scripts as well as exercising the actual click handlers.
    for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
    let destination;
    const context = {
      Storefront: storefront, EBOOKS_ORIGIN: '',
      window: { location: { assign(url) { destination = url; } } },
    };
    const start = html.match(/      function startCheckout\([^]*?\n      \}/)[0];
    vm.runInNewContext(start + '\nstartCheckout(25, null, "Video", "video-1");', context);
    assert.equal(destination, '/api/checkout?video_id=video-1');
    if (page === 'index') {
      const video = html.match(/      function startVideoCheckout\([^]*?\n      \}/)[0];
      vm.runInNewContext(start + '\n' + video + '\nstartVideoCheckout({id:"video-2",title:"Video",price:35,is_free:false});', context);
      assert.equal(destination, '/api/checkout?video_id=video-2');
      const promo = html.match(/      function startPromoCheckout\([^]*?\n      \}/)[0];
      vm.runInNewContext(promo + '\nstartPromoCheckout();', context);
      assert.equal(destination, '/api/checkout?bundle=true');
    } else {
      const elements = { 'v-price': {}, 'btn-pay-label': {}, 'btn-contact-tg': {}, 'btn-pay-instant': {
        setAttribute() {}, classList: { add() {} },
      } };
      context.document = { getElementById(id) {
        assert.ok(elements[id], `Unexpected intermediate UI: ${id}`);
        return elements[id];
      } };
      context.cryptoWallets = [];
      context.tgUrlForVideo = () => '#';
      const panel = html.match(/      function renderPayPanel\([^]*?\n      \}/)[0];
      vm.runInNewContext(start + '\n' + panel + '\nrenderPayPanel({id:"video-3",title:"Video",price:45,is_free:false});', context);
      elements['btn-pay-instant'].onclick();
      assert.equal(destination, '/api/checkout?video_id=video-3');
    }
  }
});
