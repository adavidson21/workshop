/* Docket: focus. Which task you are working on, the day's activity log, re-entry breadcrumbs, and the switch
   counter. Pure functions with no DOM, so Node tests can import them.

   The log is kept per day: log.days[date] = {id: date, events: [...]}. An event is one of
     {at, type: 'start', taskId, switch}   you started working on a task (switch: you left another unfinished one)
     {at, type: 'stop', taskId, why}       you stopped: 'pause', 'done' (finished, won't do or deleted) or 'shutdown'
     {at, type: 'interrupt'}               something pulled you away without changing the task
     {at, type: 'shutdown'}                you wrapped up the day
   `at` is an ISO time. The active task is worked out from today's events, so it never carries over to the next
   day and two windows always agree on it.

   Breadcrumbs live on the task: t.crumbs = [{at, text}], oldest first, at most MAX_CRUMBS. It is an extra field
   on prioritizer.tasks, which older readers keep as is, so tasks stay at v3. */

const MAX_EVENTS = 500, MAX_CRUMBS = 10, CRUMB_LEN = 300;
const TYPES = ['start', 'stop', 'interrupt', 'shutdown'];
const WHYS = ['pause', 'done', 'shutdown'];
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isIso = s => typeof s === 'string' && s.length <= 40 && !isNaN(Date.parse(s));
const str = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';

function cleanEvent(e){
  if (!e || typeof e !== 'object' || !TYPES.includes(e.type) || !isIso(e.at)) return null;
  const o = {at: e.at, type: e.type};
  if (e.type === 'start' || e.type === 'stop'){
    const id = str(e.taskId, 80);
    if (!id) return null;
    o.taskId = id;
  }
  if (e.type === 'start') o.switch = e.switch === true;
  if (e.type === 'stop') o.why = WHYS.includes(e.why) ? e.why : 'pause';
  return o;
}
function cleanRecord(r, date){
  if (!r || typeof r !== 'object') return null;
  const id = isDate(r.id) ? r.id : date;
  if (!isDate(id)) return null;
  const events = (Array.isArray(r.events) ? r.events : []).map(cleanEvent).filter(Boolean)
    .sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0).slice(-MAX_EVENTS);
  return Object.assign({}, r, {id, events});
}
function cleanLog(log){
  const days = {};
  for (const [k, r] of Object.entries(log && log.days || {})){ const c = cleanRecord(r, k); if (c) days[c.id] = c; }
  const handoffs = (log && Array.isArray(log.handoffs) ? log.handoffs : []).map(cleanHandoff).filter(Boolean);
  if (log){ log.days = days; log.handoffs = handoffs; return log; }
  return {days, handoffs};
}
const freshLog = () => cleanLog(null);

/* The task being worked on today, or null. */
function activeOf(log, date){
  const rec = log.days[date];
  let cur = null;
  for (const e of rec ? rec.events : []){
    if (e.type === 'start') cur = e.taskId;
    else if (e.type === 'stop' && e.taskId === cur) cur = null;
    else if (e.type === 'shutdown') cur = null;
  }
  return cur;
}
/* When the active task was started (ISO), or null. */
function activeSince(log, date){
  const rec = log.days[date], cur = activeOf(log, date);
  if (!rec || !cur) return null;
  for (let i = rec.events.length - 1; i >= 0; i--){ const e = rec.events[i]; if (e.type === 'start' && e.taskId === cur) return e.at; }
  return null;
}

function addEvent(log, date, e){
  const ev = cleanEvent(e);
  if (!ev) return null;
  const rec = log.days[date] || (log.days[date] = {id: date, events: []});
  rec.events.push(ev);
  if (rec.events.length > MAX_EVENTS) rec.events.splice(0, rec.events.length - MAX_EVENTS);
  return ev;
}

/* Start working on a task. isOpen(id) says whether a task is still unfinished. Leaving an unfinished task for
   another one is a switch; finishing first and then starting is not. Returns {left, switched}: the task you
   left (its breadcrumb is worth asking for), or null. */
function startTask(log, date, taskId, at, isOpen = () => true){
  const cur = activeOf(log, date);
  if (cur === taskId) return {left: null, switched: false};
  const switched = !!cur && isOpen(cur);
  if (cur) addEvent(log, date, {at, type: 'stop', taskId: cur, why: 'pause'});
  addEvent(log, date, {at, type: 'start', taskId, switch: switched});
  return {left: switched ? cur : null, switched};
}
/* Stop the active task. Returns the task stopped, or null. */
function stopActive(log, date, at, why = 'pause'){
  const cur = activeOf(log, date);
  if (!cur) return null;
  addEvent(log, date, {at, type: 'stop', taskId: cur, why});
  return cur;
}
/* A task was finished, marked won't do, or deleted: if it was active, it stops. */
function taskClosed(log, date, taskId, at){
  if (activeOf(log, date) !== taskId) return false;
  addEvent(log, date, {at, type: 'stop', taskId, why: 'done'});
  return true;
}
function shutdown(log, date, at){
  stopActive(log, date, at, 'shutdown');
  addEvent(log, date, {at, type: 'shutdown'});
}

/* The day's numbers: switches, interruptions, tasks started, and whether the day was wrapped up. */
function dayCounts(log, date){
  const ev = log.days[date] ? log.days[date].events : [];
  return {
    switches: ev.filter(e => e.type === 'start' && e.switch).length,
    interrupts: ev.filter(e => e.type === 'interrupt').length,
    started: new Set(ev.filter(e => e.type === 'start').map(e => e.taskId)).size,
    wrapped: ev.some(e => e.type === 'shutdown')
  };
}
/* Ids of tasks started that day, in the order first started. */
function touchedOn(log, date){
  const ev = log.days[date] ? log.days[date].events : [];
  return [...new Set(ev.filter(e => e.type === 'start').map(e => e.taskId))];
}
/* Undo the last event if it is the one given (the Undo on an "Interruption logged" toast). */
function dropEvent(log, date, ev){
  const rec = log.days[date];
  if (!rec || !ev) return false;
  const i = rec.events.lastIndexOf(ev);
  if (i < 0) return false;
  rec.events.splice(i, 1);
  return true;
}

/* ---------- handoffs (Workshop docs/handoffs.md) ----------
   Offers to another app, kept in log.handoffs and saved as prioritizer.handoffs v1. Wrap up uses them to offer
   today's finished tasks to Receipts. The receiver records what it accepted or dismissed in its own data. */
const HANDOFF_DAYS = 60, HANDOFF_KINDS = ['win', 'growth', 'note'];
const isName = s => typeof s === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(s);
function cleanHandoff(h){
  if (!h || typeof h !== 'object' || typeof h.id !== 'string' || !h.id || h.id.length > 200) return null;
  if (!isName(h.to) || !isDate(h.date) || !isIso(h.createdAt)) return null;
  const text = str(h.text, 2000).replace(/\s+/g, ' ').trim();
  if (!text || !h.source || !isName(h.source.app)) return null;
  const o = Object.assign({}, h, {text, source: {app: h.source.app}});
  if (typeof h.source.id === 'string') o.source.id = h.source.id.slice(0, 200);
  if (h.payload !== undefined && (!h.payload || typeof h.payload !== 'object' || Array.isArray(h.payload))) delete o.payload;
  return o;
}
const receiptId = (taskId, date) => `h_${taskId}_${date}`;
const receiptOffer = (log, taskId, date) => log.handoffs.find(h => h.id === receiptId(taskId, date)) || null;
/* Offer a finished task to Receipts, or update the offer. kind: win, growth or note. */
function offerReceipt(log, taskId, date, text, kind, at){
  const h = cleanHandoff({id: receiptId(taskId, date), to: 'receipts', date, createdAt: at, text,
    payload: {kind: HANDOFF_KINDS.includes(kind) ? kind : 'win', impact: 0, about: 'me'}, source: {app: 'prioritizer', id: taskId}});
  if (!h) return null;
  const i = log.handoffs.findIndex(x => x.id === h.id);
  if (i >= 0){ h.createdAt = log.handoffs[i].createdAt; log.handoffs[i] = h; } else log.handoffs.push(h);
  return h;
}
function withdrawOffer(log, id){
  const i = log.handoffs.findIndex(h => h.id === id);
  if (i < 0) return false;
  log.handoffs.splice(i, 1);
  return true;
}
/* Offers older than HANDOFF_DAYS go (docs/handoffs.md, rule 1). Returns how many were removed. */
function pruneHandoffs(log, today){
  const t = Date.parse(today + 'T00:00:00Z'), before = log.handoffs.length;
  log.handoffs = log.handoffs.filter(h => (t - Date.parse(h.date + 'T00:00:00Z')) / 864e5 <= HANDOFF_DAYS);
  return before - log.handoffs.length;
}

/* ---------- breadcrumbs ---------- */
function cleanCrumbs(a){
  if (!Array.isArray(a)) return [];
  return a.filter(c => c && isIso(c.at) && typeof c.text === 'string' && c.text.trim())
    .map(c => ({at: c.at, text: c.text.replace(/\s+/g, ' ').trim().slice(0, CRUMB_LEN)}))
    .sort((x, y) => x.at < y.at ? -1 : x.at > y.at ? 1 : 0).slice(-MAX_CRUMBS);
}
/* Add a breadcrumb to a task. Blank text adds nothing. Returns true if one was added. */
function addCrumb(t, text, at){
  const v = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!v) return false;
  t.crumbs = cleanCrumbs([...(t.crumbs || []), {at, text: v}]);
  return true;
}
const lastCrumb = t => t && t.crumbs && t.crumbs.length ? t.crumbs[t.crumbs.length - 1] : null;

export { HANDOFF_DAYS, HANDOFF_KINDS, cleanHandoff, offerReceipt, pruneHandoffs, receiptId, receiptOffer, withdrawOffer, CRUMB_LEN, MAX_CRUMBS, MAX_EVENTS, activeOf, activeSince, addCrumb, addEvent, cleanCrumbs, cleanEvent, cleanLog, cleanRecord, dayCounts, dropEvent, freshLog, lastCrumb, shutdown, startTask, stopActive, taskClosed, touchedOn };
