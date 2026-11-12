/* What Docket says about Azure DevOps sync, which runs only through Workshop's ADO connector. Pure, so it is
   unit tested (test/ado-status.test.mjs). `error` stops a sync (nothing would work); `warn` is shown but
   sync still runs (for example a PAT that expires soon). */

/** {error, warn} for the connector entry `c` (undefined when Workshop has no ADO connector). */
export function connectorNote(c) {
  if (!c) return { error: 'This Workshop has no ADO connector. Update Workshop on this computer.', warn: '' };
  const s = c.status || {};
  if (!c.enabled || s.state === 'disabled') return { error: 'The ADO connector is turned off. Turn it on in Workshop Settings.', warn: '' };
  const d = s.details || {};
  // A rejected PAT keeps the connector "ready" (the next request may work), but every sync fails until it is replaced.
  if (Array.isArray(d.patsRejected) && d.patsRejected.length) return { error: s.message || 'ADO rejected the PAT. Make a new one, then run: workshop pat', warn: '' };
  if (s.state !== 'ready') return { error: s.message || `The ADO connector is ${s.state || 'not ready yet'}.`, warn: '' };
  return { error: '', warn: s.message || '' };
}

/**
 * Why Workshop's connectors can't be reached from this page, or '' when they can. `w` is the SDK connection
 * (null if it failed). `pairSaved`: this site has a saved pairing (shared/pair.js) that did not answer.
 * `embedded`: the page runs inside Workshop's own page, which does the pairing.
 */
export function reachNote(w, { pairSaved = false, embedded = false } = {}) {
  if (w && w.backend === 'agent')
    return w.online === false ? 'Workshop on this computer stopped answering, so ADO sync is paused. Start Workshop again (run: workshop open); Docket picks it up by itself.' : '';
  if (w && w.storage === 'device') return 'Azure DevOps sync runs through Workshop on a computer, so it is not available in the phone app.';
  if (embedded) return 'Azure DevOps syncs through Workshop on this computer. Install or start Workshop (run: workshop open), connect this page to it, then turn on the ADO connector in Workshop Settings.';
  if (pairSaved) return "Can't reach Workshop on this computer. Start it (run: workshop open), then reload this page. If it still can't connect, pair this site again from the folder menu.";
  return 'Azure DevOps syncs through Workshop on this computer. Install or start Workshop, pair this site (folder menu, Use Workshop on this computer), then turn on the ADO connector in Workshop Settings.';
}

/**
 * Turn Docket's ADO sync on by itself: the connector is ready and the person never turned sync off here.
 * `ado` is Docket's per-device ui.ado ({on, offByUser}).
 */
export function shouldAutoConnect(c, ado) {
  if (!ado || ado.on || ado.offByUser) return false;
  return !!c && c.enabled === true && !connectorNote(c).error;
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
