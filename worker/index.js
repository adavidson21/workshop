// The Cloudflare Worker for workshop.alexisdavidson.org (wrangler.jsonc). It serves this repo as static
// assets, and adds one thing: on dispatch.alexisdavidson.org, Dispatch (apps/agents/) is the whole site.
// There, "/" serves apps/agents/index.html and its relative files (agents.css, js/main.js) resolve under
// apps/agents/. Shared files (/shared/, /icons/) and the service worker are served as they are, since
// "../../shared/..." from "/" resolves to "/shared/...". Every other host gets the assets unchanged.
//
// assets.run_worker_first is on so "/" on the Dispatch host reaches this code instead of the root index.html.

export const DISPATCH_HOST = /^dispatch\./;
const SHARED = /^\/(shared|icons|apps)\//;

// The path to serve for a request to the Dispatch host, or null to serve it as it is.
export function dispatchPath(pathname) {
  if (SHARED.test(pathname) || pathname === '/sw.js' || pathname === '/manifest.webmanifest') return null;
  return '/apps/agents' + (pathname === '/' || pathname === '' ? '/' : pathname);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/__debug") return new Response(request.url + " host=" + request.headers.get("host"));
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
