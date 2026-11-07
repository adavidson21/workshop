/* Dispatch: what it publishes for other apps (Workshop docs/summaries.md), and what it reads from Slate.
   Pure, so Node tests drive it. main.js writes the cards when the state changes.

   Cards: `needs` (agents waiting for an answer and pull requests waiting for your review, for Home's inbox) and
   `done-week` (runs that reached PR or finished in the last 7 days, for the weekly status). */

const DAY = 864e5;

/** Dispatch's summary cards from the connector's state and the PR inbox. */
export function summaryCards({ items = [], prompts = [], prs = [], now = Date.now() } = {}) {
  const needs = [];
  const asking = new Map();
  for (const p of prompts) if (p && p.folder) asking.set(p.folder, (asking.get(p.folder) || 0) + 1);
  for (const it of items) {
    if (!asking.has(it.folder)) continue;
    needs.push({ id: it.folder, title: it.id ? `#${it.id} ${it.title || ''}`.trim() : (it.title || it.folder), note: 'The agent is asking you something', route: it.id ? String(it.id) : it.folder, flag: 'urgent' });
  }
  const waiting = prs.filter(p => p && !p.waiting);
  if (waiting.length) needs.push({ id: 'prs', title: `${waiting.length} pull request${waiting.length === 1 ? '' : 's'} waiting for your review`, note: waiting.slice(0, 3).map(p => p.title).filter(Boolean).join(', ').slice(0, 200), route: 'reviews' });
  const week = now - 7 * DAY;
  const done = items.filter(it => it.kind === 'item' && (it.bucket === 'done' || (it.next && it.next.stage === 'ship')) && (it.modifiedMs || 0) >= week)
    .sort((a, b) => (b.modifiedMs || 0) - (a.modifiedMs || 0))
    .map(it => ({ id: it.folder, title: it.id ? `#${it.id} ${it.title || ''}`.trim() : (it.title || it.folder), note: it.bucket === 'done' ? 'Shipped' : 'PR ready', route: it.id ? String(it.id) : it.folder, due: new Date(it.modifiedMs).toISOString().slice(0, 10) }));
  const at = now;
  return [
    { id: 'needs', kind: 'list', title: 'Needs you in Dispatch', updatedAt: at, rows: needs.slice(0, 20), count: needs.length },
    { id: 'done-week', kind: 'list', title: 'Shipped with Tandem this week', updatedAt: at, rows: done.slice(0, 20), count: done.length }
  ];
}

/**
 * Slate's summary as a Map of ADO id or run folder -> {route, note, title, merged}: where a run's request came from,
 * and whether Slate saw everything for it merge. Reads the `runs` card (ADO ids and run folders, Slate 1.7.0) and
 * the older `ado` card (ADO ids only), so either Slate works.
 */
export function slateLinks(env) {
  const out = new Map();
  if (!env || env.schema !== 'slate.summary' || env.version !== 1 || !Array.isArray(env.items)) return out;
  const str = (v) => (typeof v === 'string' ? v : '');
  const card = (id) => env.items.find(x => x && x.id === id && x.kind === 'list' && Array.isArray(x.rows));
  const ado = card('ado');
  for (const r of (ado && ado.rows) || []) if (r && /^\d+$/.test(String(r.id))) out.set(String(r.id), { route: str(r.route), note: str(r.note), title: str(r.title), merged: false });
  const runs = card('runs');
  for (const r of (runs && runs.rows) || []) {
    if (!r || typeof r.id !== 'string' || !r.id) continue;
    const v = { route: str(r.route), note: str(r.note), title: str(r.title), merged: r.flag === 'done' };
    out.set(r.id, v);
    if (str(r.folder)) out.set(r.folder, v);
  }
  return out;
}
