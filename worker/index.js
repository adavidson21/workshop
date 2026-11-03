// The Cloudflare Worker for workshop.alexisdavidson.org (wrangler.jsonc). It serves this repo as static
// assets, and adds one thing: on dispatch.alexisdavidson.org, Dispatch (apps/agents/) is the whole site.
// There, "/" serves apps/agents/index.html and its relative files (agents.css, js/main.js) resolve under
// apps/agents/. Shared files (/shared/, /icons/) and the service worker are served as they are, since
// "../../shared/..." from "/" resolves to "/shared/...". Every other host gets the assets unchanged.
//
// assets.run_worker_first is on so "/" on the Dispatch host reaches this code instead of the root index.html.
//
// On every host, /install.ps1 and /install.sh serve the one-line installers (scripts/bootstrap.ps1 and .sh)
// as plain text, with {{SITE}} replaced by this site's origin so Workshop allows the site the installer came from.
//
// Apps from another site (apps/remote.json; docs/app-manifest.md, "Apps from another site"), like Docket from
// docket.alexisdavidson.org: their code lives in their own repo and deploys there, and they show up here as if
// they were in apps/<id>/, so the shell can frame them (it frames only its own origin).
//   - /apps/<id>/<path> is fetched from <site>/<path>, through the service binding named in the entry when
//     wrangler.jsonc has it, else over the internet.
//   - A page opened at the top level (not in the shell's frame) is sent to <site> instead: that is the app's
//     own address.
//   - /apps/registry.json gets each remote app's live app.json in place of the snapshot in apps/remote.json,
//     so a new file or command in the app needs no Workshop change. The snapshot is the fallback.

export const DISPATCH_HOST = /^dispatch\./;
const SHARED = /^\/(shared|icons|apps)\//;

// The path to serve for a request to the Dispatch host, or null to serve it as it is.
export function dispatchPath(pathname) {
  if (SHARED.test(pathname) || pathname === '/sw.js' || pathname === '/manifest.webmanifest') return null;
  return '/apps/agents' + (pathname === '/' || pathname === '' ? '/' : pathname);
}

export const INSTALLERS = { '/install.ps1': '/scripts/bootstrap.ps1', '/install.sh': '/scripts/bootstrap.sh' };

/** The installer script for this request, with the site filled in, or null if the path is not an installer. */
export async function installer(url, request, env) {
  const file = INSTALLERS[url.pathname];
  if (!file) return null;
  const res = await env.ASSETS.fetch(new Request(new URL(file, url.origin).toString(), request));
  if (!res || !res.ok) return new Response('The installer is not available right now.', { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const text = (await res.text()).replaceAll('{{SITE}}', url.origin);
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' } });
}

/* ---------- apps from another site ---------- */

const remoteCache = new WeakMap(); // env.ASSETS -> Promise<[{id, site, binding, manifest}]>

/** apps/remote.json from this site's assets, read once per Worker instance. */
export function remoteApps(env) {
  const key = env.ASSETS;
  if (!remoteCache.has(key)) {
    remoteCache.set(key, (async () => {
      try {
        const res = await env.ASSETS.fetch(new Request('https://assets.local/apps/remote.json'));
        if (!(res instanceof Response) || !res.ok) return [];
        return ((await res.json()).apps || []).filter(r => r && /^[a-z][a-z0-9-]{0,39}$/.test(r.id) && /^https:\/\//.test(r.site));
      } catch (e) { return []; }
    })());
  }
  return remoteCache.get(key);
}

/** The remote app a path belongs to, and the path on its site: {app, path} or null. */
export function remoteMatch(apps, pathname) {
  for (const app of apps) {
    const base = `/apps/${app.id}`;
    if (pathname === base) return { app, path: '/', bare: true };
    if (pathname.startsWith(base + '/')) return { app, path: pathname.slice(base.length) };
  }
  return null;
}

// Fetch a URL on a remote app's site: through its service binding when this Worker has it, else the internet.
function siteFetch(app, env, url, init) {
  const binding = app.binding && env[app.binding];
  return binding && typeof binding.fetch === 'function' ? binding.fetch(new Request(url, init)) : fetch(url, init);
}

/** The response for a request to a remote app's path. */
export async function remoteApp(url, request, env, { app, path, bare }) {
  const site = app.site.replace(/\/$/, '');
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  if (bare) return Response.redirect(`${url.origin}/apps/${app.id}/${url.search}`, 301);
  // Opened on its own (a bookmark, a typed address): the app's own site is its standalone home.
  if (request.headers.get('Sec-Fetch-Dest') === 'document') return Response.redirect(site + path + url.search, 302);
  const headers = new Headers();
  for (const h of ['accept', 'accept-language', 'if-none-match', 'if-modified-since', 'range']) {
    const v = request.headers.get(h); if (v) headers.set(h, v);
  }
  let res;
  try { res = await siteFetch(app, env, site + path + url.search, { method: request.method, headers, redirect: 'manual' }); }
  catch (e) { return new Response(`${app.manifest?.name || app.id} is not reachable right now.`, { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
  const out = new Response(res.body, res);
  out.headers.delete('set-cookie');
  // A redirect on the app's site (like a missing trailing slash) stays under /apps/<id>/ here.
  const loc = out.headers.get('location');
  if (loc) {
    const to = new URL(loc, site + path);
    if (to.origin === new URL(site).origin) out.headers.set('location', `/apps/${app.id}${to.pathname}${to.search}`);
  }
  return out;
}

/** apps/registry.json with each remote app's live manifest swapped in (the snapshot stays if that fails). */
export async function liveRegistry(request, env) {
  const res = await env.ASSETS.fetch(request);
  const apps = await remoteApps(env);
  if (!(res instanceof Response) || !res.ok || !apps.length) return res;
  let registry;
  try { registry = await res.json(); } catch (e) { return res; }
  await Promise.all(apps.map(async app => {
    const entry = registry.apps.find(a => a.base === `/apps/${app.id}/`);
    if (!entry) return;
    try {
      const r = await Promise.race([
        siteFetch(app, env, app.site.replace(/\/$/, '') + '/app.json', { headers: { accept: 'application/json' } }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
      ]);
      if (!r.ok) return;
      const live = await r.json();
      if (live && live.id === app.id && typeof live.entry === 'string' && typeof live.name === 'string') entry.manifest = live;
    } catch (e) { /* keep the snapshot */ }
  }));
  return new Response(JSON.stringify(registry, null, 2) + '\n', { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const script = await installer(url, request, env);
    if (script) return script;
    if (url.pathname.startsWith('/apps/')) {
      if (url.pathname === '/apps/registry.json') return liveRegistry(request, env);
      const match = remoteMatch(await remoteApps(env), url.pathname);
      if (match) return remoteApp(url, request, env, match);
    }
    if (DISPATCH_HOST.test(url.hostname)) {
      const path = dispatchPath(url.pathname);
      if (path) {
        url.pathname = path;
        return env.ASSETS.fetch(new Request(url.toString(), request));
      }
    }
    return env.ASSETS.fetch(request);
  }
};
