// The Cloudflare Worker for receipts.alexisdavidson.org (wrangler.jsonc). It serves this repo as static
// assets with one change: the app (apps/receipts/) is the whole site, so "/" serves apps/receipts/index.html
// and its relative files (app.css, js/main.js) resolve under apps/receipts/. Shared files (/shared/, /icons/),
// the service worker and the manifest are served as they are, since "../../shared/..." from "/" resolves to
// "/shared/...". Same layout and rule as Dispatch in the workshop repo.
//
// Every response gets headers that keep the page from talking to anything but itself (and Workshop on
// 127.0.0.1 if you pair it): the CSP matches the one in apps/receipts/index.html.
const SHARED = /^\/(shared|icons|apps)\//;
const AS_IS = new Set(['/sw.js', '/manifest.webmanifest', '/robots.txt']);

export function appPath(pathname) {
  if (SHARED.test(pathname) || AS_IS.has(pathname)) return null;
  return '/apps/receipts' + (pathname === '/' || pathname === '' ? '/' : pathname);
}

export const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:*; frame-src 'none'; frame-ancestors 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = appPath(url.pathname);
    if (path) url.pathname = path;
    const res = await env.ASSETS.fetch(path ? new Request(url.toString(), request) : request);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
    return out;
  }
};
