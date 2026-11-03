/* Docket: every-sprint tasks other apps offer (Workshop docs/handoffs.md, Receivers). Pure functions with no DOM,
   so Node tests can import them (test/offers.test.mjs).

   Another app (Roadmap's sprint cadence, for now) writes offers to its own `handoffs` collection. Docket reads the
   ones addressed to it with payload.kind 'every-sprint', shows them in the Day view's settings, and the person
   accepts or dismisses each. Accepting adds an every-sprint item marked `from: {app, id}`; a later offer with the
   same source updates that item instead of adding another. What was handled is kept in Docket's own data
   (dayplan/settings meta.handled), never in the sender's.

   A handled key is `<app>:<offer id>:<fingerprint of its text and payload>`, so an offer the sender changes after
   you handled it shows again (to update the item), while one sent again unchanged does not. */

const SENDERS = {pm: 'Roadmap'};
const HANDLED_MAX = 200;
const HANDOFF_VERSION = 1;
const EFFORTS = ['XS', 'S', 'M', 'L', 'XL'];
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const str = (v, n) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '';

/* A short, stable fingerprint of a string (FNV-1a, 32 bits, base 36). Not for security: only to notice a change. */
function fingerprint(s){
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
const offerKey = (app, h) => `${app}:${h.id}:${fingerprint(JSON.stringify([h.text, h.payload]))}`;

/* One offer, cleaned into what Docket needs, or null when it is not an every-sprint offer for Docket or is malformed. */
function cleanOffer(app, h){
  if (!h || typeof h !== 'object' || typeof h.id !== 'string' || !h.id || h.to !== 'prioritizer' || !isDate(h.date)) return null;
  const p = h.payload;
  if (!p || typeof p !== 'object' || p.kind !== 'every-sprint') return null;
  const title = str(p.title, 300) || str(h.text, 300);
  const last = p.last === true;
  const dueDay = Number.isInteger(p.dueDay) && p.dueDay >= 1 && p.dueDay <= 60 ? p.dueDay : null;
  if (!title || (!last && dueDay == null)) return null;
  return {
    key: offerKey(app, h), app, from: SENDERS[app] || app, id: h.id, date: h.date,
    sourceId: h.source && typeof h.source.id === 'string' ? h.source.id.slice(0, 200) : null,
    title, dueDay: dueDay || 1, last,
    planKind: str(p.planKind, 40).toLowerCase(),
    value: Number.isInteger(p.value) && p.value >= 1 && p.value <= 4 ? p.value : 2,
    effort: EFFORTS.includes(p.effort) ? p.effort : 'S',
    notes: typeof p.notes === 'string' ? p.notes.trim().slice(0, 2000) : ''
  };
}

/* Offers waiting in Docket from one sender, oldest first. env: the sender's handoffs envelope, or null. An unknown
   schema or version reads as nothing offered (rule 3), never as a reason to write anything. */
function pendingOffers(app, env, handled = []){
  if (!env || env.schema !== `${app}.handoffs` || env.version !== HANDOFF_VERSION || !Array.isArray(env.items)) return [];
  const done = new Set(handled);
  return env.items.map(h => cleanOffer(app, h)).filter(o => o && !done.has(o.key))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.title.localeCompare(b.title)));
}

/* The every-sprint item an offer updates: the one accepted from the same sender and source id. */
const matchFor = (recurring, o) => o.sourceId == null ? null
  : (recurring || []).find(r => r && r.from && r.from.app === o.app && r.from.id === o.sourceId) || null;

/* The every-sprint items after accepting an offer: the matching item updated (keeping its id, list, pause and the
   sprints it already made), or a new item. newItem: {id, listId} for a new one. Returns {recurring, item, updated}. */
function applyOffer(recurring, o, newItem){
  const fields = {title: o.title, dueDay: o.dueDay, last: o.last, planKind: o.planKind, value: o.value, effort: o.effort, notes: o.notes};
  const old = matchFor(recurring, o);
  if (old){
    const item = Object.assign({}, old, fields, {dueDay: o.last ? old.dueDay : o.dueDay});
    return {recurring: recurring.map(r => r === old ? item : r), item, updated: true};
  }
  const item = Object.assign({id: newItem.id, listId: newItem.listId || null, paused: false, made: []}, fields,
    {from: Object.assign({app: o.app}, o.sourceId != null ? {id: o.sourceId} : {})});
  return {recurring: [...(recurring || []), item], item, updated: false};
}

/* The handled list with these keys added, newest last, capped. */
function markHandled(handled, keys){
  const set = [...(Array.isArray(handled) ? handled : []).filter(k => !keys.includes(k)), ...keys];
  return set.slice(-HANDLED_MAX);
}
const cleanHandled = h => Array.isArray(h) ? [...new Set(h.filter(k => typeof k === 'string' && k.length <= 500))].slice(-HANDLED_MAX) : [];

export { HANDLED_MAX, HANDOFF_VERSION, SENDERS, applyOffer, cleanHandled, cleanOffer, fingerprint, markHandled, matchFor, offerKey, pendingOffers };
