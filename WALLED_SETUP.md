# Walled checkout setup

The checkout session is created by `secure-main`; the main video site is the storefront that links to it.

Video and bundle buttons open `/api/checkout` on the main site. This endpoint redirects to `EBOOKS_SITE_URL/checkout/review` with a fresh `requestKey` and only `video_id` or `bundle=true`. Secure shows a dedicated order summary and Pay button, without opening the ebook catalog. The button creates the session on the server and mounts the Walled SDK for `checkoutMode=embedded`; an explicit legacy `redirect` response is retained until Walled enables strict mode. Purchases made in Secure's own ebook catalog use `/checkout` and start payment automatically, without this review screen. Amounts, titles, and return URLs are resolved on Secure, not forwarded from the browser. Existing product UUIDs can be retained for the same offers.

Old `/api/payjsr-checkout` and `/api/paypal-checkout` links also redirect to Secure. A missing, invalid, non-HTTPS, or same-host Secure destination returns an error without starting a local checkout.

## Before deploying

1. In Walled, configure the secure site's hostname as the allowed domain. Set Success to `https://<secure-host>/payment/success`, Cancel to `https://<secure-host>/payment/cancel`, and Webhook to `https://<secure-host>/api/webhooks/walled`.
2. Create a Walled API key and webhook signing secret in the same environment (Development or Production).
3. Apply [`sql/walled-checkout.sql`](sql/walled-checkout.sql) to the Supabase project shared by both sites.
4. In the `secure-main` deployment secrets, configure `WALLED_API_BASE_URL`, `WALLED_APP_ORIGIN` (the secure site's HTTPS origin), `WALLED_API_KEY`, `WALLED_WEBHOOK_SECRET`, and Supabase server credentials.
5. For variable pricing, set `WALLED_VARIABLE_PRICING=true` and `WALLED_PRODUCT_ID` to the Walled product UUID. The secure server resolves video prices from Supabase; set `WALLED_ALLOWED_PRICES_USD` for the standalone ebook catalog prices.
6. For fixed pricing, set `WALLED_VARIABLE_PRICING=false`. Ebook prices use `WALLED_FIXED_PRODUCTS_JSON`; main-store prices use `WALLED_VIDEO_FIXED_PRODUCTS_JSON`, including the complete package under the `"100"` price key. `WALLED_VIDEO_BUNDLE_PRODUCT_ID` is an optional bundle override, not a requirement when the map already contains the package. Main-store-only configuration does not require an ebook map. Use gateways that identify the actual offer. The checkout requires an exact configured price and rejects known ebook gateways for video purchases.
7. In the main video site's deployment, set `EBOOKS_SITE_URL` to the secure site's HTTPS origin. Do not configure Walled credentials or its allowed domain on the main site.

The secure site validates video IDs, active/free status, and video prices against Supabase. The browser never supplies the amount for a video purchase. Signed webhook events are stored idempotently, and successful payments are recorded in `purchases`; the return page also reconciles payment status with Walled.

Run `npm run test:checkout` in both projects. Secure exposes `GET /checkout` (and the compatible old `GET /api/walled-checkout` URL) for review, and `POST /api/walled-checkout` for session creation. Its README documents the strict-mode migration flags, SDK origin, ownership cookies and Development validation. A fresh embedded checkout and signed server confirmation still need to be verified on the allowed public HTTPS domain before the migration is complete.

