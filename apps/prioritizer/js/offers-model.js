/* Docket: every-sprint tasks other apps offer (Workshop docs/handoffs.md, Receivers). Pure functions with no DOM,
   so Node tests can import them (test/offers.test.mjs).

   Another app writes offers to its own `handoffs` collection. Docket reads the
   ones addressed to it with payload.kind 'every-sprint', shows them in the Day view's settings, and the person
   accepts or dismisses each. Accepting adds an every-sprint item marked `from: {app, id}`; a later offer with the
   same source updates that item instead of adding another. What was handled is kept in Docket's own data
   (dayplan/settings meta.handled), never in the sender's.

   A handled key is `<app>:<offer id>:<fingerprint of its text and payload>`, so an offer the sender changes after
   you handled it shows again (to update the item), while one sent again unchanged does not. */

/* The apps Docket reads offers from: app id to the name shown for it. An app read but not named here shows by its
   id. A new sender follows Workshop docs/handoffs.md (Receivers) and is added here by its app id. Home's quick
   capture and the Dispatch hub send accepted tasks (kind 'task', accepted: true; Workshop docs/hub.md). */
const SENDERS = { home: 'Home', agents: 'Dispatch' };
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

/* ---------- accepted tasks (Workshop docs/handoffs.md, rule 4) ----------
   A capture the person already accepted in Home or the Dispatch hub: payload.kind 'task' and accepted: true.
   Docket adds it as a task when it loads, with no second click, and records it as handled. Text is never parsed
   as Quick add syntax. A task keeps `from: {app, id}`, so the same capture is never added twice even after the
   handled list is trimmed. */
const MAX_PEOPLE = 10;
const taskKey = (app, h) => `${app}:${h.id}:task`;

function cleanTaskOffer(app, h){
  if (!h || typeof h !== 'object' || typeof h.id !== 'string' || !h.id || h.to !== 'prioritizer' || h.accepted !== true) return null;
  const p = h.payload;
  if (!p || typeof p !== 'object' || p.kind !== 'task') return null;
  const title = str(p.title, 300) || str(h.text, 300);
  if (!title) return null;
  const people = Array.isArray(p.people) ? [...new Set(p.people.map(n => str(n, 80)).filter(Boolean))].slice(0, MAX_PEOPLE) : [];
  return {
    key: taskKey(app, h), app, from: SENDERS[app] || app, id: h.id, title, people,
    list: str(p.list, 120), waiting: p.waiting === true, due: isDate(p.due) ? p.due : null, urgent: p.urgent === true,
    value: Number.isInteger(p.value) && p.value >= 1 && p.value <= 4 ? p.value : null,
    effort: EFFORTS.includes(p.effort) ? p.effort : null,
    notes: typeof p.notes === 'string' ? p.notes.trim().slice(0, 2000) : ''
  };
}

/* Accepted tasks from one sender that Docket has not added yet. tasks: Docket's tasks, to skip one already
   added (its `from` matches). */
function acceptedTasks(app, env, handled = [], tasks = []){
  if (!env || env.schema !== `${app}.handoffs` || env.version !== HANDOFF_VERSION || !Array.isArray(env.items)) return [];
  const done = new Set(handled);
  const have = new Set((tasks || []).filter(t => t && t.from && t.from.app).map(t => `${t.from.app}:${t.from.id}`));
  return env.items.map(h => cleanTaskOffer(app, h)).filter(o => o && !done.has(o.key) && !have.has(`${o.app}:${o.id}`))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/* The list an accepted task goes to: the one named (without case, top level or nested), else fallback. */
function listFor(o, lists, fallback){
  const want = (o.list || '').toLowerCase();
  const hit = want && (lists || []).find(l => l && typeof l.name === 'string' && l.name.toLowerCase() === want);
  return hit ? hit.id : fallback;
}

/* A new task from an accepted offer. ctx: {id, listId, rank, color, today}. people are names; the caller
   makes them Docket's canonical spellings. */
function taskFromOffer(o, ctx){
  return {
    id: ctx.id, title: o.title, notes: o.notes, color: ctx.color, rank: ctx.rank,
    value: o.value, effort: o.effort, due: o.due, urgentFlag: o.urgent,
    listId: ctx.listId, done: false, doneAt: null, wontDo: false,
    createdAt: ctx.today, ageFrom: ctx.today, waiting: o.waiting, nudgeOn: null, focusOn: null,
    people: o.people.slice(), from: {app: o.app, id: o.id}
  };
}

export { HANDLED_MAX, HANDOFF_VERSION, SENDERS, acceptedTasks, applyOffer, cleanHandled, cleanOffer, cleanTaskOffer, fingerprint, listFor, markHandled, matchFor, offerKey, pendingOffers, taskFromOffer };
