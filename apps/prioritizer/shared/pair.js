/* Pairing a site with Workshop on this computer (docs/run-modes.md, Pairing). Shared by the Workshop shell and
   by apps that run on their own site (Docket keeps an exact copy). The page's own UI asks for the port and
   shows messages; this module does the pairing itself.

     import { canPair, pairWith, forgetPairing, isPaired } from '../shared/pair.js';
     if (canPair(ws)) await pairWith(4380);   // opens the agent's pairing window; reloads once allowed

   The agent's /pair page asks the user to allow this site, then posts {type: 'workshop-pair', api: 1, url,
   token} back to this window. The pair is stored as workshop.agent in this site's localStorage; on reload
   the SDK uses the agent (hosted mode). */

export const PAIR_KEY = 'workshop.agent';
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost):(\d{2,5})$/;

/** True on a site (https) not yet paired, in a browser (not the Android app, not the agent's own page). */
export function canPair(ws) {
  return !!ws && ws.mode === 'browser' && ws.storage !== 'device' && location.protocol === 'https:';
}

/** True when this site is paired with Workshop on this computer and using it. */
export function isPaired(ws) {
  return !!ws && ws.mode === 'hosted';
}

let pending = null;

/**
 * Open the agent's pairing window for this site. Resolves 'blocked' if the browser blocked the window, else
 * 'opened'. When the user allows the site, the pair is saved and the page reloads. `onError(message)` gets
 * a plain message if the pair cannot be saved.
 */
export function pairWith(port, { onError = () => {} } = {}) {
  const n = Math.round(Number(port));
  if (!(n >= 1024 && n <= 65535)) throw new RangeError('The port is a number from 1024 to 65535.');
  const agent = `http://127.0.0.1:${n}`;
  const win = window.open(`${agent}/pair?origin=${encodeURIComponent(location.origin)}`, 'workshop-pair', 'popup,width=520,height=420');
  if (!win) return 'blocked';
  if (pending) window.removeEventListener('message', pending);
  pending = (e) => {
    const m = e.data;
    if (e.source !== win || !m || m.type !== 'workshop-pair' || m.api !== 1) return;
    if (!LOOPBACK.test(e.origin) || m.url !== e.origin || typeof m.token !== 'string' || !m.token) return;
    window.removeEventListener('message', pending);
    pending = null;
    try { localStorage.setItem(PAIR_KEY, JSON.stringify({ url: m.url, token: m.token })); }
    catch (err) { onError('This browser would not save the connection.'); return; }
    location.reload();
  };
  window.addEventListener('message', pending);
  return 'opened';
}

/** Forget this site's pairing and reload, back to browser storage. */
export function forgetPairing() {
  try { localStorage.removeItem(PAIR_KEY); } catch (e) { /* nothing stored */ }
  location.reload();
}

/** The words for asking the port, the same everywhere. */
export const PAIR_HELP = 'Workshop must be running on this computer, and this browser signed in to it once (the installer does this, or run workshop open). Then click Connect and allow this site.';
