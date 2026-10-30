// Cloudflare Pages middleware (this repo is a Pages project: workshop.alexisdavidson.org).
//
// dispatch.alexisdavidson.org is a second custom domain on the same project. There, Dispatch (apps/agents/)
// is the whole site: "/" serves apps/agents/index.html, and its relative files (agents.css, js/main.js) resolve
// under apps/agents/. Shared files (/shared/, /icons/) and the service worker are served as they are, since
// "../../shared/..." from "/" resolves to "/shared/...". Every other host is untouched.
//
// Setup: in the Pages project, Custom domains, add dispatch.alexisdavidson.org.

export const DISPATCH_HOST = /^dispatch\./;
const SHARED = /^\/(shared|icons|apps)\//;

// The path to serve for a request to the Dispatch host, or null to serve it as it is.
export function dispatchPath(pathname) {
  if (SHARED.test(pathname) || pathname === '/sw.js' || pathname === '/manifest.webmanifest') return null;
  return '/apps/agents' + (pathname === '/' || pathname === '' ? '/' : pathname);
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (!DISPATCH_HOST.test(url.hostname)) return context.next();
  const path = dispatchPath(url.pathname);
  if (!path) return context.next();
  url.pathname = path;
  return context.env.ASSETS.fetch(new Request(url.toString(), context.request));
}
