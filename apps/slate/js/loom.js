/* Loom: Slate's board and Dispatch's agent runs in one app (plan: claude/slate-run-panel-v1-plan.md in the
   Workshop project). The page has one SDK connection, one summary and one set of tabs. This file is the seam
   between the two halves: the board half (main.js, model.js, view.js) and the runs half (dispatch/).

   - ws: the one connection, as app `slate` (the board's data stays where it was).
   - tabs: Inbox, Board, Health, Chat, Reviews. The runs half draws the tab bar; Board and Health show the board
     half's page (#board-root), the rest the runs half's (#app).
   - summary: each half hands its cards here; writeSummary merges them into Loom's one `summary` (docs/summaries.md).
   Pure parts (mergeCards, splitRoute) are tested in Node. */

export const BOARD_TABS = ['board', 'health'];
export const TABS = [['inbox', 'Inbox'], ['board', 'Board'], ['health', 'Health'], ['chat', 'Chat'], ['reviews', 'Reviews']];

/**
 * Which half a route belongs to: the board half for its own paths (item/<id>, health, sprints, board, runway/...,
 * roadmaps), else the runs half (inbox, chat, reviews, work, hub/<text>, a run's id or folder). Returns {half: 'board'|'runs', tab, path}.
 */
export function splitRoute(path) {
  const p = String(path || '').replace(/^\/+/, '');
  const head = p.split('/')[0];
  if (head === 'item') return { half: 'board', tab: 'board', path: p };
  // Runway's links (runway/<map>/<item>) and Slate's old roadmaps address: the board half opens Runway or the card.
  if (['runway', 'roadmaps', 'roadmap'].includes(head)) return { half: 'board', tab: 'board', path: p };
  if (head === 'board') return { half: 'board', tab: 'board', path: '' };
  if (head === 'health' || head === 'sprints') return { half: 'board', tab: 'health', path: p };
  return { half: 'runs', tab: '', path: p };
}

/**
 * Merge the two halves' summary cards into one list. Cards with the same id and kind combine: a `list` card's rows
 * join (the runs half's first, the same row id once), counts add up and the title says Loom; a `held` card's counts
 * add up. Other cards pass through.
 */
export function mergeCards(board = [], runs = []) {
  const out = board.map(c => ({ ...c }));
  for (const r of runs) {
    const i = out.findIndex(c => c.id === r.id);
    if (i < 0) { out.push({ ...r }); continue; }
    const b = out[i];
    if (b.kind === 'list' && r.kind === 'list') {
      const seen = new Set();
      const rows = [...(r.rows || []), ...(b.rows || [])].filter(x => { const k = x && x.id; if (!k) return true; if (seen.has(k)) return false; seen.add(k); return true; });
      const count = (Number(b.count) || (b.rows || []).length) + (Number(r.count) || (r.rows || []).length);
      out[i] = { ...b, title: b.id === 'needs' ? 'Needs you in Loom' : b.title, rows: rows.slice(0, 20), count, ...(b.updatedAt || r.updatedAt ? { updatedAt: Math.max(Number(b.updatedAt) || 0, Number(r.updatedAt) || 0) || undefined } : {}) };
      if (out[i].updatedAt === undefined) delete out[i].updatedAt;
    } else if (b.kind === 'held' && r.kind === 'held') {
      const count = (b.count || 0) + (r.count || 0);
      out[i] = { ...b, count, label: `${count} update${count === 1 ? '' : 's'} waiting in Loom` };
    }
  }
  return out;
}

/* ---------- the page side (not loaded in Node tests) ---------- */

let wsPromise = null;
/** The one SDK connection. */
export function getWs() {
  if (!wsPromise) wsPromise = import('../../../shared/workshop-sdk.js').then(m => m.connect({ app: 'slate' }));
  return wsPromise;
}

const cards = { board: null, runs: null };
let writer = null;
/** The board half registers how to write the summary (data.js writeSummary). */
export function setSummaryWriter(fn) { writer = fn; flush(); }
/** Each half hands over its cards when they change. */
export function setCards(half, list) { cards[half] = list; flush(); }
let timer = null;
function flush() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!writer || !cards.board) return; // the board half writes once it has loaded its items
    writer(mergeCards(cards.board, cards.runs || [])).catch(() => {});
  }, 200);
}

/* Tabs: the runs half owns the tab bar and tells the page which tab is in view; the board half listens. */
const tabSubs = new Set();
let tab = '';
export function setTab(t) {
  tab = t;
  document.body.dataset.loomTab = t; // not data-tab: the runs half reads [data-tab] on click
  const root = document.getElementById('board-root');
  if (root) root.hidden = !BOARD_TABS.includes(t);
  for (const f of tabSubs) f(t);
}
export const currentTab = () => tab;
export function onTab(f) { tabSubs.add(f); if (tab) f(tab); }

/* Routes for the board half, sent by the runs half's router. */
const routeSubs = new Set();
let lastRoute = null; // a route that came before the board half was listening
export function routeBoard(path) { if (!routeSubs.size) lastRoute = path; for (const f of routeSubs) f(path); }
export function onBoardRoute(f) { routeSubs.add(f); if (lastRoute !== null) { const p = lastRoute; lastRoute = null; f(p); } }

/* The board half asks for a tab (open an item from Health, say); the runs half switches its tab bar. */
const askSubs = new Set();
export function requestTab(t) { for (const f of askSubs) f(t); }
export function onTabRequest(f) { askSubs.add(f); }

/* The rail badge: what waits on you in both halves, added up. */
const badges = { board: 0, runs: 0 };
let badgeOpts = {};
let lastBadge = null;
export function setBadge(half, count, opts = {}) {
  badges[half] = Number(count) || 0;
  if (half === 'runs') badgeOpts = opts;
  const n = badges.board + badges.runs;
  const key = n + ':' + JSON.stringify(badgeOpts);
  if (key === lastBadge) return;
  lastBadge = key;
  getWs().then(ws => ws.badge(n || null, badgeOpts)).catch(() => {});
}
