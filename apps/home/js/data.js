/* Home: loading and saving through the SDK, with no DOM, so Node tests can drive it with a fake `ws`.
   main.js owns the page and calls paint() through onChange.

   Waiting for the folder: in browser mode Chrome may have to be asked again before Workshop can use the
   data folder (a bar in the shell has the Allow button). Reads then fail with code `unavailable`. Like
   Prioritizer, Home then shows a message instead of an empty page, saves nothing, and loads again once
   `online` turns true. */
import { agentCounts, boardFromSummary, dateStr, nowFromDay, withNames, wrapFromDay } from './view.js';
import { EMPTY } from '../../../shared/people.js';
import { cardDay, readCards } from '../../../shared/summary.js';

const P = { app: 'prioritizer' };
const OC = 'opencode';

const EMPTY_BOARD = () => ({ total: 0, open: 0, focus: { total: 0, done: 0 }, triage: 0, overdue: 0, dueWeek: 0, upNext: [], team: [] });

export function createHome(ws, { onChange = () => {}, now = () => new Date() } = {}) {
  const v = { now: now(), profile: {}, dir: EMPTY, board: null, dayNow: null, wrap: null, boardNote: '', agents: { state: 'loading' }, waiting: false, embedded: !!ws.embedded };
  let profileEnv = null;

  const changed = () => { v.now = now(); onChange(v); };
  // True (and Home waits) when the error means the browser's folder store needs Allow.
  function waitFor(e) {
    if (!(e && e.code === 'unavailable' && ws.backend === 'browser')) return false;
    v.waiting = true;
    return true;
  }

  /* Docket's numbers, the block on now and Wrap up, from Docket's summary (docs/summaries.md): its `board` and
     `day` cards for today, with names for its ids from the people directory (docs/people.md). No summary yet
     means Docket has not saved one (a new board): an empty board. A summary with no entry for today is stale:
     Home says to open Docket rather than show another day's numbers. */
  async function loadBoard() {
    try {
      const [env, dir] = await Promise.all([ws.data.get('summary', P), ws.people.get().catch(() => EMPTY)]);
      v.dir = dir;
      const cards = readCards(env, 'prioritizer');
      const d = now(), today = dateStr(d), nowMin = d.getHours() * 60 + d.getMinutes();
      v.dayNow = null; v.wrap = null;
      if (!env) { v.board = EMPTY_BOARD(); v.boardNote = ''; }
      else if (!cards) { v.board = null; v.boardNote = 'Your board was saved by a newer Docket. Update Workshop to see it here.'; }
      else {
        const board = boardFromSummary(cards.get('board'), today), day = cardDay(cards.get('day'), today);
        if (!board) { v.board = null; v.boardNote = 'Open Docket to bring your board up to date here.'; }
        else {
          v.board = withNames(board, dir); v.boardNote = '';
          if (day) { v.dayNow = nowFromDay(day, nowMin); v.wrap = wrapFromDay(day, nowMin); }
        }
      }
    } catch (e) {
      v.board = null;
      v.boardNote = waitFor(e) ? '' : "Couldn't read your board right now.";
    }
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

  async function loadProfile() {
    try {
      profileEnv = await ws.data.get('profile');
      const m = profileEnv && profileEnv.meta || {};
      v.profile = { name: typeof m.name === 'string' ? m.name : '', role: typeof m.role === 'string' ? m.role : '' };
    } catch (e) { waitFor(e); /* otherwise keep the profile shown */ }
    changed();
  }

  // Everything once. While waiting, a successful load of all of it ends the wait.
  async function loadAll() {
    const was = v.waiting;
    v.waiting = false;
    await Promise.all([loadProfile(), loadBoard(), loadAgents()]);
    if (was && !v.waiting) changed();
  }

  async function saveProfile(next) {
    if (v.waiting) { const e = new Error('Waiting for you to allow the Workshop folder.'); e.code = 'unavailable'; throw e; }
    const build = base => ({
      schema: 'home.profile', version: 1, rev: base ? base.rev : 0, items: [], deleted: base && base.deleted || {},
      meta: Object.assign({}, base && base.meta, { updatedAt: Date.now(), name: next.name, role: next.role })
    });
    try {
      try {
        const env = build(profileEnv);
        const r = await ws.data.put('profile', env);
        profileEnv = Object.assign(env, { rev: r.rev });
      } catch (e) {
        if (e.code === 'conflict' && e.current) {
          const env = build(e.current);
          const r = await ws.data.put('profile', env);
          profileEnv = Object.assign(env, { rev: r.rev });
        } else throw e;
      }
    } catch (e) {
      if (waitFor(e)) changed();
      throw e;
    }
    v.profile = next;
  }

  // Folder access (or the agent) came back: load everything again, once per change to online.
  ws.on('online', p => { if (p && p.online) loadAll(); });

  return {
    v, loadAll, loadBoard, loadAgents, loadProfile, saveProfile,
    get waiting() { return v.waiting; }
  };
}
