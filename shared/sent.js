/* Workshop: say where work went, the same way in every app (docs/handoffs.md, Saying where it went).

   When an app sends something to another app, or starts opencode work that shows up somewhere else, it tells you
   where it landed, by the name you see on screen, with one button that takes you there:

     Sent to Agents: Fix the login timeout.   [Open Agents]

   Builds shows as the Agents tab of Tasks (manifest tabOf), so its on-screen name is "Agents". Without Tasks it is
   on the rail as "Builds". placeName gives whichever is true on this site once loadPlaces has read the app list,
   and "Agents" until then (the usual setup). Pure but for sentToast and loadPlaces; test/sent.test.mjs. */

/** On-screen names when the app list is not known yet. */
const DEFAULTS = { builds: 'Agents', tasks: 'Tasks', chat: 'Chat', notes: 'Notes', people: 'People', roadmaps: 'Roadmaps', settings: 'Settings', bench: 'Bench', home: 'Needs you' };
let names = { ...DEFAULTS };

/** {id: name} from ws.apps.list() entries: a tab (tabOf whose host is on the site) is named by its tab name. */
export function namesFrom(apps) {
  const list = Array.isArray(apps) ? apps.filter(a => a && typeof a.id === 'string') : [];
  const ids = new Set(list.map(a => a.id));
  const out = { ...DEFAULTS };
  for (const a of list) {
    const t = a.tabOf;
    out[a.id] = t && t.app && ids.has(t.app) && t.name ? String(t.name) : String(a.name || out[a.id] || a.id);
  }
  return out;
}

/** The name you see for app `id` on this site ("Agents" for Builds inside Tasks). */
export const placeName = id => names[id] || DEFAULTS[id] || String(id || '');

/** Read the app list once so placeName is right on this site. Resolves the names; never rejects. */
let loading = null;
export function loadPlaces(ws) {
  if (!loading) loading = (ws && ws.apps && ws.apps.list ? ws.apps.list() : Promise.resolve(null))
    .then(apps => { if (Array.isArray(apps)) names = namesFrom(apps); return names; }, () => names);
  return loading;
}

/** The toast text: "Sent to Agents: <what>." (what trimmed to one short line), or "Sent to Agents." */
export function sentText(app, what = '', verb = 'Sent to') {
  const w = String(what || '').replace(/\s+/g, ' ').trim();
  const short = w.length > 70 ? w.slice(0, 69).trimEnd() + '…' : w;
  return `${verb} ${placeName(app)}${short ? `: ${short.replace(/[.]$/, '')}` : ''}.`;
}

/**
 * Tell the person where something went, with a button there. `app` and `path` are where it landed; `text` replaces
 * the usual "Sent to <place>: <what>." when a sentence says it better; `label` replaces "Open <place>".
 */
export function sentToast(ws, { app, path = '', what = '', text = '', label = '', kind = 'success' } = {}) {
  if (!ws || !app) return;
  const msg = text || sentText(app, what);
  ws.toast(msg, { kind, action: { label: label || `Open ${placeName(app)}`, open: { app, path: String(path || '') } } });
}
