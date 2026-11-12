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
// /install-work.ps1 and /install-work.sh serve the same installers with work mode on. Every app is part of this
// site; old app domains redirect to Pop out (below).
import { SITE, hostOf } from '../shared/site.js';

export const DISPATCH_HOST = /^dispatch\./;

/* ---------- no standalone sites (docs/site.md, Retired sites) ----------
   Apps no longer have sites of their own: Pop out gives any app its own window here. The old app domains, once
   attached to this Worker, send every address to the app in a pop-out window, so bookmarks keep working. A 302,
   not a 301, so a browser does not remember it for good. */
export const RETIRED_HOSTS = Object.freeze(Object.fromEntries(Object.entries(SITE.apps).map(([id, url]) => [hostOf(url), id])));

/** The redirect for a request to a retired app domain, or null. */
export function retiredRedirect(url) {
  const id = RETIRED_HOSTS[url.hostname];
  return id ? Response.redirect(`${SITE.workshop}/?solo=${id}#/${id}`, 302) : null;
}

/** An app's page opened on its own (a bookmark, a typed address, not the shell's frame) opens the app in a pop-out
 *  window instead, so every app looks and works the same. Only the app's start page; its other pages are left alone. */
export function topLevelApp(url, request) {
  if (request.headers.get('Sec-Fetch-Dest') !== 'document') return null;
  const m = url.pathname.match(/^\/apps\/([a-z][a-z0-9-]{0,39})\/(index\.html)?$/);
  return m ? Response.redirect(`${url.origin}/?solo=${m[1]}#/${m[1]}`, 302) : null;
}
const SHARED = /^\/(shared|icons|apps)\//;

// The path to serve for a request to the Dispatch host, or null to serve it as it is.
export function dispatchPath(pathname) {
  if (SHARED.test(pathname) || pathname === '/sw.js' || pathname === '/manifest.webmanifest') return null;
  return '/apps/agents' + (pathname === '/' || pathname === '' ? '/' : pathname);
}

// /install-work.* is the same installer with work mode on ({{WORK}} becomes 1), for a work computer.
export const INSTALLERS = {
  '/install.ps1': { file: '/scripts/bootstrap.ps1', work: false },
  '/install.sh': { file: '/scripts/bootstrap.sh', work: false },
  '/install-work.ps1': { file: '/scripts/bootstrap.ps1', work: true },
  '/install-work.sh': { file: '/scripts/bootstrap.sh', work: true }
};

/** The installer script for this request, with the site filled in, or null if the path is not an installer. */
export async function installer(url, request, env) {
  const entry = INSTALLERS[url.pathname];
  if (!entry) return null;
  const res = await env.ASSETS.fetch(new Request(new URL(entry.file, url.origin).toString(), request));
  if (!res || !res.ok) return new Response('The installer is not available right now.', { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const text = (await res.text()).replaceAll('{{SITE}}', url.origin).replaceAll('{{WORK}}', entry.work ? '1' : '0');
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const retired = retiredRedirect(url);
    if (retired) return retired;
    const script = await installer(url, request, env);
    if (script) return script;
    if (url.pathname.startsWith('/apps/')) {
      const solo = topLevelApp(url, request);
      if (solo) return solo;
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
