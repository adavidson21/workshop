/* What Docket says about work item sync, which runs only through Workshop's tracker connectors (ADO and GitHub).
   Pure, so it is unit tested (test/tracker-status.test.mjs). `error` stops a sync (nothing would work); `warn` is
   shown but sync still runs (for example a token that expires soon, or one of two trackers not ready). */

/** The tracker connectors Docket syncs from, in order, with their short names. */
export const TRACKERS = Object.freeze({ ado: 'ADO', github: 'GitHub' });
export const trackerName = id => TRACKERS[id] || 'ADO';

/** {error, warn} for one connector entry `c` (undefined when Workshop does not have it). */
export function connectorNote(c, id = (c && c.id) || 'ado') {
  const name = trackerName(id);
  if (!c) return { error: `This Workshop has no ${name} connector. Update Workshop on this computer.`, warn: '' };
  const s = c.status || {};
  if (!c.enabled || s.state === 'disabled') return { error: `The ${name} connector is turned off. Turn it on in Workshop Settings.`, warn: '' };
  const d = s.details || {};
  // A rejected token keeps the connector "ready" (the next request may work), but every sync fails until it is replaced.
  const rejected = [d.patsRejected, d.tokensRejected].some(r => Array.isArray(r) && r.length);
  if (rejected) return { error: s.message || `${name} rejected the token. Make a new one, then run: workshop pat`, warn: '' };
  if (s.state !== 'ready') return { error: s.message || `The ${name} connector is ${s.state || 'not ready yet'}.`, warn: '' };
  return { error: '', warn: s.message || '' };
}

/**
 * Which trackers to sync from Workshop's connector list, and what to say: {ids, error, warn, by}. `ids` are the
 * enabled tracker connectors that can sync now. `error` only when none can; a tracker that is on but not ready
 * while another works becomes a warning, so the working one still syncs. `by` has each enabled tracker's note.
 */
export function trackersNote(list) {
  const all = (Array.isArray(list) ? list : []).filter(c => c && Object.hasOwn(TRACKERS, c.id));
  if (!all.length) return { ids: [], error: 'This Workshop has no tracker connector. Update Workshop on this computer.', warn: '', by: {} };
  const on = all.filter(c => c.enabled && (c.status || {}).state !== 'disabled');
  if (!on.length) return { ids: [], error: 'Turn on the ADO or GitHub connector in Workshop Settings.', warn: '', by: {} };
  const by = Object.fromEntries(on.map(c => [c.id, connectorNote(c)]));
  const ids = on.filter(c => !by[c.id].error).map(c => c.id);
  const errors = on.filter(c => by[c.id].error).map(c => by[c.id].error);
  const warns = ids.map(id => by[id].warn).filter(Boolean);
  if (!ids.length) return { ids, error: errors.join(' '), warn: '', by };
  return { ids, error: '', warn: [...errors, ...warns].join(' '), by };
}

/**
 * Why Workshop's connectors can't be reached from this page, or '' when they can. `w` is the SDK connection
 * (null if it failed). `pairSaved`: this site has a saved pairing (shared/pair.js) that did not answer.
 * `embedded`: the page runs inside Workshop's own page, which does the pairing.
 */
export function reachNote(w, { pairSaved = false, embedded = false } = {}) {
  if (w && w.backend === 'agent')
    return w.online === false ? 'Workshop on this computer stopped answering, so work item sync is paused. Start Workshop again (run: workshop open); Docket picks it up by itself.' : '';
  if (w && w.storage === 'device') return 'Work item sync runs through Workshop on a computer, so it is not available in the phone app.';
  if (embedded) return 'Work items sync through Workshop on this computer. Install or start Workshop (run: workshop open), connect this page to it, then turn on the ADO or GitHub connector in Workshop Settings.';
  if (pairSaved) return "Can't reach Workshop on this computer. Start it (run: workshop open), then reload this page. If it still can't connect, pair this site again from the folder menu.";
  return 'Work items sync through Workshop on this computer. Install or start Workshop, pair this site (folder menu, Use Workshop on this computer), then turn on the ADO or GitHub connector in Workshop Settings.';
}

/**
 * Turn Docket's sync on by itself: a tracker connector is ready and the person never turned sync off here.
 * `list` is Workshop's connector list (or one connector entry); `t` is Docket's per-device ui.tracker ({on, offByUser}).
 */
export function shouldAutoConnect(list, t) {
  if (!t || t.on || t.offByUser) return false;
  return trackersNote(Array.isArray(list) ? list : list ? [list] : []).ids.length > 0;
}

/**
 * A PR key ("<collection URL>|<project>|<id>") in a form that ignores how the collection URL was typed: case,
 * trailing slashes and %-encoding. Boards synced by the retired ado_helper.py keep their PR tasks when the
 * connector's collection URL is written a little differently.
 */
export function prMatchKey(key) {
  const parts = String(key || '').split('|');
  if (parts.length < 3) return String(key || '');
  const dec = s => { try { return decodeURIComponent(s); } catch { return s; } };
  const id = parts.pop(), project = parts.pop(), base = parts.join('|');
  return `${dec(base).replace(/\/+$/, '').toLowerCase()}|${dec(project).toLowerCase()}|${id}`;
}
