/* Home (the Needs you panel): loading through the SDK, with no DOM, so Node tests can drive it with a fake `ws`.
   main.js owns the page and calls paint() through onChange.

   Waiting for the folder: in browser mode Chrome may have to be asked again before Workshop can use the
   data folder (a bar in the shell has the Allow button). Reads then fail with code `unavailable`. Like
   Docket, Home then shows a message instead of an empty panel, saves nothing, and loads again once
   `online` turns true. */
import { agentCounts, blockingRows, boardFromSummary, dateStr, inboxRows, upcomingRows, weekRows } from './view.js';
import { readCards } from '../../../shared/summary.js';

const P = { app: 'prioritizer' };
const OC = 'opencode';

export function createHome(ws, { onChange = () => {}, now = () => new Date() } = {}) {
  const v = { now: now(), profile: {}, inbox: [], blocking: [], focus: null, week: [], upcoming: [], apps: [], board: null, agents: { state: 'loading' }, waiting: false, embedded: !!ws.embedded };

  const changed = () => { v.now = now(); onChange(v); };
  // True (and Home waits) when the error means the browser's folder store needs Allow.
  function waitFor(e) {
    if (!(e && e.code === 'unavailable' && ws.backend === 'browser')) return false;
    v.waiting = true;
    return true;
  }

  /* How many tasks Docket has (Get started's "a Docket task" step), from Docket's summary (docs/summaries.md): its
     `board` card for today. No summary yet is an empty board; one with no entry for today is unknown (null). */
  async function loadBoard() {
    try {
      const env = await ws.data.get('summary', P);
      const cards = readCards(env, 'prioritizer');
      const board = cards && boardFromSummary(cards.get('board'), dateStr(now()));
      v.board = !env ? { total: 0 } : board ? { total: board.total } : null;
    } catch (e) { waitFor(e); v.board = null; }
    changed();
  }

  async function loadAgents() {
    if (ws.backend !== 'agent') { v.agents = { state: 'browser' }; return changed(); }
    try {
      const c = (await ws.connectors.list()).find(x => x.id === OC);
      if (!c || c.status.state !== 'ready') {
        v.agents = { state: 'off', message: !c ? 'The opencode connector is not installed.' : c.status.state === 'disabled' ? 'The opencode connector is off. Turn it on in Settings.' : c.status.message || 'The opencode connector is not ready yet.' };
      } else {
        v.agents = { state: 'ready', ...agentCounts(await ws.connectors.call(OC, 'state')) };
      }
    } catch (e) {
      v.agents = { state: 'off', message: "Couldn't reach Workshop on this computer." };
    }
    changed();
  }

  /* Needs you and the week, from every app's summary (docs/summaries.md): `needs` and `done-week` list cards,
     Docket's included. Agents waiting (the opencode connector) join the inbox here. */
  async function loadInbox() {
    try {
      if (!v.apps.length) v.apps = (await ws.apps.list().catch(() => [])).filter(a => a.id !== 'home');
      const sums = await Promise.all(v.apps.map(a => ws.data.get('summary', { app: a.id }).then(env => readCards(env, a.id)).catch(() => null)));
      const byApp = v.apps.map((a, i) => ({ app: a.id, name: a.name, cards: sums[i] }));
      v.inbox = inboxRows(byApp);
      const docket = byApp.find(a => a.app === 'prioritizer');
      v.blocking = blockingRows(docket && docket.cards);
      v.week = weekRows(byApp);
      v.upcoming = upcomingRows(byApp, dateStr(now()));
    } catch (e) { waitFor(e); }
    changed();
  }

  async function loadProfile() {
    try {
      const env = await ws.data.get('profile');
      const m = env && env.meta || {};
      v.profile = { name: typeof m.name === 'string' ? m.name : '', role: typeof m.role === 'string' ? m.role : '' };
    } catch (e) { waitFor(e); /* otherwise keep the profile shown */ }
    changed();
  }

  // Everything once. While waiting, a successful load of all of it ends the wait.
  async function loadAll() {
    const was = v.waiting;
    v.waiting = false;
    await Promise.all([loadProfile(), loadBoard(), loadAgents()]);
    await loadInbox();
    if (was && !v.waiting) changed();
  }

  // Folder access (or the agent) came back: load everything again, once per change to online.
  ws.on('online', p => { if (p && p.online) loadAll(); });

  return {
    v, loadAll, loadBoard, loadAgents, loadInbox, loadProfile,
    get waiting() { return v.waiting; }
  };
}
