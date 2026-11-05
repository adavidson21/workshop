/* Notes: links to other apps' records, written as standard Markdown links with a ws: address:

     [Fix the login timeout](ws:prioritizer/task/t_k2f9)
     [Platform roadmap](ws:runway)

   ws:<app>/<route> opens that app at that route inside Workshop (ws.open), or Workshop's site from Notes' own
   site. The renderer shows them as chips. Only an app id and route characters are accepted, so a ws: link can
   never become a script or another site. Pure: no DOM and no SDK. */

const APP = /^[a-z][a-z0-9-]{0,39}$/;
const ROUTE = /^[A-Za-z0-9._~:@-]+(?:\/[A-Za-z0-9._~:@-]+){0,7}$/;

/** {app, path} for a ws: href, else null. */
export function appLink(href) {
  const m = /^ws:([^/?#\s]+)(?:\/([^?#\s]*))?$/.exec(String(href || '').trim());
  if (!m || !APP.test(m[1])) return null;
  const path = m[2] || '';
  if (path && (!ROUTE.test(path) || path.split('/').some(s => s === '.' || s === '..'))) return null;
  return { app: m[1], path };
}

/** The ws: href for an app and route. */
export function appHref(app, path = '') {
  if (!APP.test(app)) throw new RangeError('Not an app id.');
  const href = `ws:${app}${path ? '/' + path : ''}`;
  if (!appLink(href)) throw new RangeError('Not a route Notes can link to.');
  return href;
}

/**
 * Which notes link to which app records: Map '<app>/<path>' -> [{from, line}], from each note's links
 * (facts(): [{href, line}]). notes: Map path -> {links}.
 */
export function appRefs(notes) {
  const out = new Map();
  for (const [from, n] of notes) {
    for (const l of n.links || []) {
      const a = !l.image && appLink(l.href);
      if (!a) continue;
      const key = a.path ? `${a.app}/${a.path}` : a.app;
      if (!out.has(key)) out.set(key, []);
      out.get(key).push({ from, line: l.line });
    }
  }
  return out;
}
