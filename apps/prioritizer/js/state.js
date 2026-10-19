import { ADO_SYNC_MAX, ADO_SYNC_MIN, ADO_SYNC_MINUTES, EFFORTS, KEY, LENSES, POINTS, PR_TIER_DEFAULTS, UI_KEY, VIEWS } from './constants.js';
import { scheduleWrite } from './folder-sync.js';
import { isStale, isTriaged } from './model.js';
import { toast } from './overlays.js';
import { render } from './render.js';
import { isDate, todayStr, uid } from './util.js';
/* Prioritizer: Board state: shape, migration, sanitize, load/save with change stamps, per-device UI state, list and scope helpers. */
/* ---------- state ---------- */
function fresh(){
  const main = {id: uid(), name: 'Main', parentId: null};
  return {version: 2, lists: [main], scope: 'all', view: 'today', lens: 'rank', colorIdx: 0, tasks: [], people: [], capacity: 20, capacityAt: 0, ado: {skip: [], skipPr: [], choose: true, pending: [], syncMinutes: ADO_SYNC_MINUTES, prTiers: cleanTiers()}};
}
function normalizeRanks(s){
  s.tasks.sort((a,b) => (a.rank ?? 0) - (b.rank ?? 0)).forEach((t,i) => t.rank = i + 1);
}
// v1 fields to v2. Runs on every sanitize, so it must be idempotent.
function migrateTask(t){
  if (t.value === 'high') t.value = 4; else if (t.value === 'low') t.value = 2;
  if (typeof t.value === 'string' && /^[1-4]$/.test(t.value.trim())) t.value = +t.value;
  if (!(Number.isInteger(t.value) && t.value >= 1 && t.value <= 4)) t.value = null;
  if (t.value == null){ if (t.important === true) t.value = 3; else if (t.important === false) t.value = 2; }
  if (t.effort === 'high') t.effort = 'L'; else if (t.effort === 'low') t.effort = 'S';
  if (typeof t.effort === 'string' && EFFORTS.includes(t.effort.toUpperCase())) t.effort = t.effort.toUpperCase();
  if (!(t.effort in POINTS)) t.effort = null;
  if (t.urgent === true) t.urgentFlag = true;
  t.urgentFlag = t.urgentFlag === true;
  if (!isDate(t.createdAt)) t.createdAt = todayStr();
  if (!isDate(t.ageFrom)) t.ageFrom = t.createdAt;
  if (!isDate(t.due)) t.due = null;
  if (!isDate(t.nudgeOn)) t.nudgeOn = null;
  t.done = t.done === true;
  if (!t.done) t.doneAt = null;
  t.wontDo = t.wontDo === true && t.done;
  t.ado = cleanAdo(t.ado);
  if (!t.ado) delete t.ado;
  t.pr = cleanPr(t.pr);
  if (!t.pr) delete t.pr;
  delete t.urgent; delete t.important;
}
// ADO link on a task: {id, type, state, url, project, due, gone}. Anything malformed is dropped.
function cleanAdo(a){
  if (!a || typeof a !== 'object') return null;
  const id = parseInt(a.id, 10);
  if (!(id > 0)) return null;
  const str = v => typeof v === 'string' ? v.slice(0, 500) : '';
  const o = {id, type: str(a.type), state: str(a.state), url: /^https?:\/\//.test(a.url) ? str(a.url) : '', project: str(a.project)};
  if (isDate(a.due)) o.due = a.due;
  if (['closed','removed','reassigned','missing','filtered'].includes(a.gone)) o.gone = a.gone;
  return o;
}
// PR review link on a task: {key, id, repo, project, url, author, tier, via, waiting, lastBlocker, gone}.
// key is "<collection url>|<project>|<PR id>" so PRs from two collections never collide.
const PR_GONES = ['reviewed','covered','merged','abandoned','unassigned','draft','own','missing'];
function cleanPr(a){
  if (!a || typeof a !== 'object' || typeof a.key !== 'string' || !a.key) return null;
  const id = parseInt(a.id ?? a.key.split('|').pop(), 10);
  if (!(id > 0)) return null;
  const str = v => typeof v === 'string' ? v.slice(0, 500) : '';
  const o = {key: a.key.slice(0, 500), id, repo: str(a.repo), project: str(a.project), url: /^https?:\/\//.test(a.url) ? str(a.url) : '',
    author: str(a.author), tier: ['blocking','asked','pool'].includes(a.tier) ? a.tier : 'pool',
    via: Array.isArray(a.via) ? a.via.filter(v => typeof v === 'string').slice(0, 10) : [], waiting: a.waiting === true, lastBlocker: a.lastBlocker === true};
  if (PR_GONES.includes(a.gone)) o.gone = a.gone;
  return o;
}
// A new work item waiting for you to add or skip it.
function cleanPending(a){
  const link = cleanAdo(a); if (!link) return null;
  const pr = parseInt(a.priority, 10);
  return Object.assign(link, {title: typeof a.title === 'string' ? a.title.slice(0, 500) : '', priority: pr >= 1 && pr <= 4 ? pr : null, seen: isDate(a.seen) ? a.seen : todayStr()});
}
// Starting value (1 to 4) and urgent flag a new PR review task gets, per tier. Missing or bad entries get the default.
function cleanTiers(t){
  const out = {};
  for (const [k, d] of Object.entries(PR_TIER_DEFAULTS)){
    const v = t && typeof t === 'object' && t[k] && typeof t[k] === 'object' ? t[k] : {};
    out[k] = {value: Number.isInteger(v.value) && v.value >= 1 && v.value <= 4 ? v.value : d.value, urgent: typeof v.urgent === 'boolean' ? v.urgent : d.urgent};
  }
  return out;
}
function sanitize(s){
  if (!s || !Array.isArray(s.lists) || !s.lists.length) return fresh();
  s.version = 2;
  s.tasks = Array.isArray(s.tasks) ? s.tasks : [];
  s.colorIdx = Number.isFinite(s.colorIdx) ? s.colorIdx : 0;
  if (s.view === 'focus') s.view = 'today';
  if (!VIEWS.includes(s.view)) s.view = 'today';
  if (!(s.lens in LENSES)) s.lens = (s.view in LENSES) ? s.view : 'rank';
  s.capacity = Number.isFinite(+s.capacity) && +s.capacity >= 1 ? Math.min(999, Math.round(+s.capacity)) : 20;
  s.capacityAt = Number.isFinite(s.capacityAt) ? s.capacityAt : 0;
  // people: one canonical spelling per name, shared by every task
  const known = new Map();
  const note = n => { n = String(n ?? '').trim(); if (n && !known.has(n.toLowerCase())) known.set(n.toLowerCase(), n); };
  (Array.isArray(s.people) ? s.people : []).forEach(note);
  s.tasks.forEach(t => { (Array.isArray(t.people) ? t.people : []).forEach(note); });
  s.people = [...known.values()];
  s.dead = s.dead && typeof s.dead === 'object' ? s.dead : {};
  for (const k of ['tasks','lists','people']) if (!s.dead[k] || typeof s.dead[k] !== 'object') s.dead[k] = {};
  // forget deletions older than 60 days
  const cutoff = Date.now() - 60 * 864e5;
  for (const k of ['tasks','lists','people']) for (const id in s.dead[k]) if (s.dead[k][id] < cutoff) delete s.dead[k][id];
  s.peopleAt = s.peopleAt && typeof s.peopleAt === 'object' ? s.peopleAt : {};
  s.tasks.forEach(t => {
    t.people = [...new Set((Array.isArray(t.people) ? t.people : []).map(n => known.get(String(n).trim().toLowerCase())).filter(Boolean))];
    t.waiting = t.waiting === true;
    if (t.focusOn && !isDate(t.focusOn)) t.focusOn = null;
    migrateTask(t);
  });
  const ids = new Set(s.lists.map(l => l.id));
  s.lists.forEach(l => {
    if (l.parentId && !ids.has(l.parentId)) l.parentId = null;
    const p = l.parentId && s.lists.find(x => x.id === l.parentId);
    if (p && p.parentId) l.parentId = p.parentId; // keep nesting to one level
  });
  if (!s.lists.some(l => !l.parentId)) s.lists[0].parentId = null;
  s.tasks = s.tasks.filter(t => ids.has(t.listId));
  if (s.scope !== 'all' && !ids.has(s.scope)) s.scope = 'all';
  delete s.includeSub; delete s.activeListId;
  s.ado = s.ado && typeof s.ado === 'object' ? s.ado : {};
  if (s.ado.listId && !ids.has(s.ado.listId)) delete s.ado.listId;
  s.ado.skip = Array.isArray(s.ado.skip) ? s.ado.skip.filter(n => Number.isInteger(n)).slice(-500) : [];
  s.ado.skipPr = Array.isArray(s.ado.skipPr) ? s.ado.skipPr.filter(k => typeof k === 'string').slice(-500) : [];
  s.ado.choose = s.ado.choose !== false;   // new work items wait for you to pick them (default)
  const mins = Math.round(+s.ado.syncMinutes);
  s.ado.syncMinutes = mins >= ADO_SYNC_MIN && mins <= ADO_SYNC_MAX ? mins : ADO_SYNC_MINUTES;
  s.ado.prTiers = cleanTiers(s.ado.prTiers);
  s.ado.pending = Array.isArray(s.ado.pending) ? s.ado.pending.map(cleanPending).filter(Boolean).slice(0, 300) : [];
  if (s.ado.prListId && !ids.has(s.ado.prListId)) delete s.ado.prListId;
  normalizeRanks(s);
  return s;
}
function load(){
  try { const raw = localStorage.getItem(KEY); if (raw) return sanitize(JSON.parse(raw)); } catch(e) {}
  return fresh();
}
let state = load();
let saveWarned = false;
/* Per-item change stamps so two devices can merge instead of overwriting each other. */
let snap = null;
// state and snap are module-private. Other modules change them through these setters, because an ES
// module cannot assign to a binding it imported from here.
function setState(s){ state = s; }
function setSnap(s){ snap = s; }
const stripStamp = o => { const {updatedAt, ...r} = o; return JSON.stringify(r); };
function takeSnap(){
  return {tasks: new Map(state.tasks.map(t => [t.id, stripStamp(t)])), lists: new Map(state.lists.map(l => [l.id, stripStamp(l)])),
          people: new Set(state.people.map(p => p.toLowerCase()))};
}
function stampChanges(){
  const now = Date.now(), cur = takeSnap();
  state.dead = state.dead || {tasks: {}, lists: {}, people: {}};
  state.peopleAt = state.peopleAt || {};
  if (snap){
    for (const k of ['tasks','lists']){
      state[k].forEach(x => { if (snap[k].get(x.id) !== cur[k].get(x.id)){ x.updatedAt = now; delete state.dead[k][x.id]; } });
      snap[k].forEach((_, id) => { if (!cur[k].has(id)) state.dead[k][id] = now; });
    }
    cur.people.forEach(p => { if (!snap.people.has(p)){ state.peopleAt[p] = now; delete state.dead.people[p]; } });
    snap.people.forEach(p => { if (!cur.people.has(p)) state.dead.people[p] = now; });
  }
  snap = cur;
}
function save(){
  state.updatedAt = Date.now();
  stampChanges();
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch(e){ if (!saveWarned){ saveWarned = true; toast('Could not save in this browser. Use Download a copy to keep one.'); } }
  scheduleWrite();
}
function commit(){ save(); render(); }

/* per-device UI state (not synced) */
let ui = {collapsed: false};
try { ui = Object.assign(ui, JSON.parse(localStorage.getItem(UI_KEY) || '{}')); } catch(e) {}
const saveUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch(e) {} };
delete ui.eng; // eng-agents settings moved to shared/eng-client.js

const listById = id => state.lists.find(l => l.id === id);
const childrenOf = id => state.lists.filter(l => l.parentId === id);
const topLists = () => state.lists.filter(l => !l.parentId);
const orderedLists = () => topLists().flatMap(p => [p, ...childrenOf(p.id)]);
const findTask = id => state.tasks.find(t => t.id === id);
function scopeListIds(){
  if (state.scope === 'all') return state.lists.map(l => l.id);
  const L = listById(state.scope);
  if (!L) return state.lists.map(l => l.id);
  return L.parentId ? [L.id] : [L.id, ...childrenOf(L.id).map(c => c.id)];
}
function scopeName(){
  if (state.scope === 'all') return 'All lists';
  const L = listById(state.scope); if (!L) return 'All lists';
  return L.parentId ? `${listById(L.parentId).name} › ${L.name}` : L.name;
}
const defaultListId = () => state.scope !== 'all' && listById(state.scope) ? state.scope : topLists()[0].id;
const inScope = t => scopeListIds().includes(t.listId);
const isDoneToday = t => t.done && !t.wontDo && t.doneAt === todayStr();
const scopeOpen = () => state.tasks.filter(t => !t.done && inScope(t)).sort((a,b) => a.rank - b.rank);
const isFocus = t => t.focusOn === todayStr() && (!t.done || isDoneToday(t));
function triageQueue(){
  return state.tasks.filter(t => !t.done && inScope(t) && (!isTriaged(t) || isStale(t)))
    .sort((a,b) => a.ageFrom.localeCompare(b.ageFrom) || a.rank - b.rank);
}
function canonPerson(n){
  n = String(n ?? '').trim().replace(/^@/, '');
  if (!n) return null;
  const hit = state.people.find(p => p.toLowerCase() === n.toLowerCase());
  if (hit) return hit;
  n = n[0].toUpperCase() + n.slice(1);
  state.people.push(n);
  return n;
}
const initials = n => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');

export { PR_GONES, canonPerson, childrenOf, cleanAdo, cleanPending, cleanPr, cleanTiers, commit, defaultListId, findTask, inScope, initials, isDoneToday, isFocus, listById, load, migrateTask, normalizeRanks, orderedLists, sanitize, save, saveUi, scopeListIds, scopeName, scopeOpen, setSnap, setState, snap, state, stripStamp, takeSnap, topLists, triageQueue, ui };
