/* Home: loading and saving through the SDK, with no DOM, so Node tests can drive it with a fake `ws`.
   main.js owns the page and calls paint() through onChange.

   Waiting for the folder: in browser mode Chrome may have to be asked again before Workshop can use the
   data folder (a bar in the shell has the Allow button). Reads then fail with code `unavailable`. Like
   Prioritizer, Home then shows a message instead of an empty page, saves nothing, and loads again once
   `online` turns true. */
import { DAYPLAN_VERSION, TASKS_VERSION, agentCounts, boardFromSummary, dateStr, dayNow, nowFromDay, summarize, wrapFromDay, wrapState } from './view.js';
import { cardDay, readCards } from '../../../shared/summary.js';

const P = { app: 'prioritizer' };
const OC = 'opencode';

/* Docket's day plan collections Home reads for the Now card. */
export const dayCollections = year => ['dayplan/settings', 'dayplan/templates', `dayplan/days/${year}`, `focus/days/${year}`, 'handoffs'];

export function createHome(ws, { onChange = () => {}, now = () => new Date() } = {}) {
  const v = { now: now(), profile: {}, board: null, dayNow: null, wrap: null, boardNote: '', agents: { state: 'loading' }, waiting: false, embedded: !!ws.embedded };
  let profileEnv = null;

  const changed = () => { v.now = now(); onChange(v); };
  // True (and Home waits) when the error means the browser's folder store needs Allow.
  function waitFor(e) {
    if (!(e && e.code === 'unavailable' && ws.backend === 'browser')) return false;
    v.waiting = true;
    return true;
  }

  async function loadBoard() {
    // Docket's summary first (docs/summaries.md). A missing or stale one falls back to Docket's own collections
    // below, for a Docket that writes no summary yet; that fallback goes after one release.
    try {
      const cards = readCards(await ws.data.get('summary', P), 'prioritizer');
      const d = now(), today = dateStr(d), nowMin = d.getHours() * 60 + d.getMinutes();
      const board = cards && boardFromSummary(cards.get('board'), today);
      const day = cards && cardDay(cards.get('day'), today);
      if (board && day) {
        v.board = board; v.boardNote = ''; v.dayNow = nowFromDay(day, nowMin); v.wrap = wrapFromDay(day, nowMin); v.source = 'summary';
        changed();
        return;
      }
    } catch (e) {
      if (waitFor(e)) { v.board = null; v.boardNote = ''; changed(); return; }
    }
    v.source = 'collections';
    try {
      const year = now().getFullYear();
      const [tasks, lists, people, settings, templates, days, focus, offers] = await Promise.all(['tasks', 'lists', 'people', ...dayCollections(year)].map(c => ws.data.get(c, P)));
      // The day plan is optional: an unknown version or a missing sprint just means no Now card.
      const ok = (env, col) => env && env.schema === 'prioritizer.' + col && env.version === DAYPLAN_VERSION ? env : null;
      v.dayNow = dayNow({ settings: ok(settings, 'dayplan/settings'), templates: ok(templates, 'dayplan/templates'), days: ok(days, `dayplan/days/${year}`) },
        tasks && tasks.version === TASKS_VERSION ? tasks.items : [], now());
      // Docket's focus log and offers (Wrap up), also optional and read only at version 1.
      const d = now(), today = dateStr(d), log = ok(focus, `focus/days/${year}`);
      v.wrap = wrapState({ day: log && log.items.find(i => i.id === today) || null, settings: ok(settings, 'dayplan/settings'), offers: ok(offers, 'handoffs') },
        today, d.getHours() * 60 + d.getMinutes());
      if (tasks && (tasks.schema !== 'prioritizer.tasks' || tasks.version !== TASKS_VERSION)) {
        v.board = null; v.boardNote = 'Your board was saved by a newer Docket. Update Workshop to see it here.';
      } else {
        v.board = summarize({ tasks: tasks ? tasks.items : [], lists: lists ? lists.items : [], people: people ? people.items : [] }, dateStr(now()));
        v.boardNote = '';
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
