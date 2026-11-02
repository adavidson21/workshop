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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/__debug") return new Response(request.url + " host=" + request.headers.get("host"));
    const script = await installer(url, request, env);
    if (script) return script;
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
