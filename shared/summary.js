/* Workshop: summaries (docs/summaries.md). What an app publishes about itself for other apps to show, in its own
   `summary` collection. Writers use createSummaryWriter; readers use readCards and cardDay. Pure functions plus a
   small writer over ws.data, no DOM, so Node tests can drive them.

   Writer (in the app that owns the data):
     const summary = createSummaryWriter({ data: ws.data, app: 'prioritizer', build: () => cards });
     summary.schedule();   // after a save: writes a moment later, only when a card changed
   Reader (in another app):
     const cards = readCards(await ws.data.get('summary', { app: 'prioritizer' }), 'prioritizer');
     const today = cardDay(cards.get('board'), '2026-11-04');   // null when missing or stale */

export const SUMMARY = 'summary';
export const SUMMARY_VERSION = 1;
export const HORIZON = 7;   // date cards cover today and the next 6 days

const canon = c => { const o = Object.assign({}, c); delete o.updatedAt; return JSON.stringify(o); };

/** The days a date card covers, from `today` (YYYY-MM-DD). */
export function horizon(today, n = HORIZON) {
  const d0 = new Date(today + 'T00:00:00Z');
  return Array.from({ length: n }, (_, i) => new Date(d0.getTime() + i * 864e5).toISOString().slice(0, 10));
}

/** The envelope to put for `cards`: unchanged cards keep their stamp, changed ones get `now`, and cards that
    went away become tombstones. null when nothing changed. */
export function summaryEnvelope(app, cards, stored, now) {
  const ok = stored && stored.version === SUMMARY_VERSION && Array.isArray(stored.items);
  const before = new Map((ok ? stored.items : []).map(i => [i.id, i]));
  let changed = !ok;
  const items = cards.map(c => {
    const old = before.get(c.id);
    if (old && canon(old) === canon(c)) return Object.assign({}, c, { updatedAt: old.updatedAt });
    changed = true;
    return Object.assign({}, c, { updatedAt: now });
  });
  const deleted = Object.assign({}, ok && stored.deleted || {});
  for (const id of before.keys()) if (!cards.some(c => c.id === id)) { deleted[id] = now; changed = true; }
  for (const c of cards) delete deleted[c.id];
  if (!changed) return null;
  return { schema: `${app}.${SUMMARY}`, version: SUMMARY_VERSION, rev: stored ? stored.rev : 0, items, deleted };
}

/**
 * Writes an app's summary a moment after its data changes. data: ws.data. app: the app's id. build(): the
 * cards (without updatedAt), or null to skip (data not loaded, read-only). A conflict (another window wrote it)
 * is read again and retried once; other failures wait for the next change, since a summary is only for showing.
 * Returns {schedule(), flush()}; flush() resolves true when it wrote.
 */
export function createSummaryWriter({ data, app, build, delayMs = 1500, timers = globalThis, now = () => Date.now() }) {
  let timer = null, running = Promise.resolve();
  async function write() {
    let cards;
    try { cards = build(); } catch (e) { return false; }
    if (!cards) return false;
    for (let attempt = 0; attempt < 2; attempt++) {
      let stored = null;
      try { stored = await data.get(SUMMARY); } catch (e) { return false; }
      if (stored && stored.version > SUMMARY_VERSION) return false;   // a newer writer owns it
      const env = summaryEnvelope(app, cards, stored, now());
      if (!env) return false;
      try { await data.put(SUMMARY, env); return true; }
      catch (e) { if (!(e && e.code === 'conflict')) return false; }
    }
    return false;
  }
  return {
    schedule() { if (timer) timers.clearTimeout(timer); timer = timers.setTimeout(() => { timer = null; running = running.then(write, write); }, delayMs); },
    flush() { if (timer) { timers.clearTimeout(timer); timer = null; } running = running.then(write, write); return running; }
  };
}

/** An app's summary cards by id, or null when the envelope is missing or unreadable (another schema or version). */
export function readCards(env, app) {
  if (!env || env.schema !== `${app}.${SUMMARY}` || env.version !== SUMMARY_VERSION || !Array.isArray(env.items)) return null;
  return new Map(env.items.filter(c => c && typeof c.id === 'string' && typeof c.kind === 'string').map(c => [c.id, c]));
}

/** A date card's entry for `date` (YYYY-MM-DD), or null when the card is missing or has no such day (stale). */
export function cardDay(card, date) {
  return card && card.days && typeof card.days === 'object' && card.days[date] && typeof card.days[date] === 'object' ? card.days[date] : null;
}

/** The first `targets` card for a capture kind across apps' cards: [{id, title}], or null when none. */
export function targetsFor(cardsByApp, capture) {
  for (const cards of cardsByApp) {
    if (!cards) continue;
    for (const c of cards.values()) if (c.kind === 'targets' && c.capture === capture && Array.isArray(c.rows)) return c.rows.filter(r => r && typeof r.id === 'string' && typeof r.title === 'string');
  }
  return null;
}
