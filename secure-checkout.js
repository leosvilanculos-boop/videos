import crypto from 'node:crypto';

// Compatibility entry points only redirect; payment sessions belong to Secure.
export function registerSecureCheckoutRedirects(app, secureUrl) {
  app.get(['/api/checkout', '/api/walled-checkout', '/api/payjsr-checkout', '/api/paypal-checkout'], (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    let origin;
    try {
      const url = new URL(String(secureUrl || '').trim());
      if (url.protocol !== 'https:' || url.username || url.password || url.host === req.get('host')) throw new Error();
      origin = url.origin;
    } catch {
      return res.status(503).type('text').send('Secure checkout is unavailable. Please contact support.');
    }
    const params = new URLSearchParams();
    const bundle = ['all', 'true'].includes(String(req.query.bundle || '').toLowerCase());
    const videoId = typeof req.query.video_id === 'string' ? req.query.video_id.trim() : '';
    if (bundle) params.set('bundle', 'true');
    else if (videoId) params.set('video_id', videoId);
    else return res.status(400).type('text').send('Choose a video before checkout.');
    params.set('requestKey', crypto.randomUUID());
    return res.redirect(303, `${origin}/api/walled-checkout?${params}`);
  });
}
