# Walled checkout setup

The checkout session is created by `secure-main`; the main video site is the storefront that links to it.

Video and bundle buttons open `/api/checkout` on the main site. This endpoint redirects to `EBOOKS_SITE_URL/api/walled-checkout` with a fresh `requestKey` and only `video_id` or `bundle=true`. Secure creates the session and redirects the buyer to Walled. Amounts, titles, and payment return URLs are resolved on Secure, not forwarded from the browser.

Old `/api/payjsr-checkout` and `/api/paypal-checkout` links also redirect to Secure. A missing, invalid, non-HTTPS, or same-host Secure destination returns an error without starting a local checkout.

## Before deploying

1. In Walled, configure the secure site's hostname as the allowed domain. Set Success to `https://<secure-host>/payment/success`, Cancel to `https://<secure-host>/payment/cancel`, and Webhook to `https://<secure-host>/api/webhooks/walled`.
2. Create a Walled API key and webhook signing secret in the same environment (Development or Production).
3. Apply [`sql/walled-checkout.sql`](sql/walled-checkout.sql) to the Supabase project shared by both sites.
4. In the `secure-main` deployment secrets, configure `WALLED_API_BASE_URL`, `WALLED_APP_ORIGIN` (the secure site's HTTPS origin), `WALLED_API_KEY`, `WALLED_WEBHOOK_SECRET`, and Supabase server credentials.
5. For variable pricing, set `WALLED_VARIABLE_PRICING=true` and `WALLED_PRODUCT_ID` to the Walled product UUID. The secure server resolves video prices from Supabase; set `WALLED_ALLOWED_PRICES_USD` for the standalone ebook catalog prices.
6. For fixed pricing, set `WALLED_VARIABLE_PRICING=false` and map each exact amount to a product UUID in `WALLED_FIXED_PRODUCTS_JSON`. A one-click checkout requires an exact configured price; the server will not silently substitute another amount.
7. In the main video site's deployment, set `EBOOKS_SITE_URL` to the secure site's HTTPS origin. Do not configure Walled credentials or its allowed domain on the main site.

The secure site validates video IDs, active/free status, and video prices against Supabase. The browser never supplies the amount for a video purchase. Signed webhook events are stored idempotently, and successful payments are recorded in `purchases`; the return page also reconciles payment status with Walled.

Run `npm run test:checkout` to verify the storefront click handlers and redirects without contacting a payment provider. Before deployment, verify that Secure exposes `GET /api/walled-checkout` and shares the storefront's video catalog. End-to-end payment confirmation still requires a configured Walled Development environment.

