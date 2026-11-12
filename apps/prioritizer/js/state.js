// storage.js comes first: it pulls in events.js and, through it, drawer.js before render.js. drawer.js no longer
// does anything when it loads (its listeners are in drawerInit, called by main.js), but keep this order.
import { cleanLeftOff } from './left-off-model.js';
import { cleanProduct } from './products-link.js';
import { scheduleSave } from './storage.js';
import { ADO_SYNC_MAX, ADO_SYNC_MIN, ADO_SYNC_MINUTES, EFFORTS, LENSES, POINTS, PR_SLOT_DEFAULTS, PR_TIER_DEFAULTS, UI_KEY, VIEWS, initials } from './constants.js';
import { isTriaged } from './model.js';
import { render } from './render.js';
import { MAIN_LIST } from './store-format.js';
import { isDate, todayStr, uid } from './util.js';
import { cleanCrumbs } from './focus-model.js';
import { isRef } from '../../../shared/people.js';
import { PR_HOLD_DEFAULT, cleanAi, cleanHeld, cleanHoldMinutes } from './pr-ai-model.js';
import { cleanRowFields } from './row-fields-model.js';
import { cleanFollow } from './delegate-model.js';
/* Prioritizer: Board state: shape, migration, sanitize, saving (through storage.js), per-window UI state, list and scope helpers. */
/* ---------- state ---------- */
const PR_SHOW = ['all', 'mine', 'none'];   // the PR filter's values (see shown)
function fresh(){
  const main = {id: MAIN_LIST, name: 'Main', parentId: null};
  return {version: 2, lists: [main], scope: 'all', view: 'today', lens: 'rank', prs: 'all', colorIdx: 0, tasks: [], capacity: 20, capacityAt: 0, ado: {skip: [], skipPr: [], choose: true, pending: [], syncMinutes: ADO_SYNC_MINUTES, prTiers: cleanTiers(), prSlots: cleanSlots(), prHeld: [], prHoldMinutes: PR_HOLD_DEFAULT}, rowFields: {hidden: []}, follow: cleanFollow()};
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
  // Came back from someone you waited on (delegate-model.js): shown once on Today until handled.
  if ('cameBack' in t && (!isDate(t.cameBack) || t.done)) delete t.cameBack;
  t.done = t.done === true;
  if (!t.done) t.doneAt = null;
  t.wontDo = t.wontDo === true && t.done;
  t.ado = cleanAdo(t.ado);
  if (!t.ado) delete t.ado;
  t.pr = cleanPr(t.pr);
  if (!t.pr) delete t.pr;
  // Re-entry breadcrumbs (focus.js): an extra field older readers keep as is, so tasks stay at v3.
  if ('crumbs' in t){ t.crumbs = cleanCrumbs(t.crumbs); if (!t.crumbs.length) delete t.crumbs; }
  // Where you left off (left-off.js, focus hours): an extra field too, gone once the task is done.
  if ('leftOff' in t){ const lo = cleanLeftOff(t.leftOff); if (lo && !t.done) t.leftOff = lo; else delete t.leftOff; }
  // The product it is for (products-link.js, Settings' Products): an extra field too, a product id.
  if ('product' in t){ const pr = cleanProduct(t.product); if (pr) t.product = pr; else delete t.product; }
  delete t.urgent; delete t.important;
}
// ADO link on a task: {id, type, state, url, project, due, gone, pasted}. Anything malformed is dropped.
function cleanAdo(a){
  if (!a || typeof a !== 'object') return null;
  const id = parseInt(a.id, 10);
  if (!(id > 0)) return null;
  const str = v => typeof v === 'string' ? v.slice(0, 500) : '';
  const o = {id, type: str(a.type), state: str(a.state), url: /^https?:\/\//.test(a.url) ? str(a.url) : '', project: str(a.project)};
  if (isDate(a.due)) o.due = a.due;
  if (['closed','removed','reassigned','missing','filtered'].includes(a.gone)) o.gone = a.gone;
  if (a.pasted === true) o.pasted = true;   // pasted into Docket (js/paste.js), not from a sync: syncs leave it alone until ADO lists it as yours
  return o;
}
// PR review link on a task: {key, id, repo, project, url, author, tier, via, waiting, lastBlocker, gone, commit, ai}.
// ai is Tandem's first-pass review (js/pr-ai-model.js); commit is the PR's source commit when the sync gives it.
// key is "<collection url>|<project>|<PR id>" so PRs from two collections never collide.
const PR_GONES = ['reviewed','covered','notneeded','merged','abandoned','unassigned','draft','own','missing'];
function cleanPr(a){
  if (!a || typeof a !== 'object' || typeof a.key !== 'string' || !a.key) return null;
  const id = parseInt(a.id ?? a.key.split('|').pop(), 10);
  if (!(id > 0)) return null;
  const str = v => typeof v === 'string' ? v.slice(0, 500) : '';
  const o = {key: a.key.slice(0, 500), id, repo: str(a.repo), project: str(a.project), url: /^https?:\/\//.test(a.url) ? str(a.url) : '',
    author: str(a.author), tier: ['blocking','asked','pool'].includes(a.tier) ? a.tier : 'pool',
    via: Array.isArray(a.via) ? a.via.filter(v => typeof v === 'string').slice(0, 10) : [], waiting: a.waiting === true, lastBlocker: a.lastBlocker === true};
  if (PR_GONES.includes(a.gone)) o.gone = a.gone;
  if (typeof a.commit === 'string' && /^[0-9a-f]{7,40}$/i.test(a.commit)) o.commit = a.commit.toLowerCase();
  const ai = cleanAi(a.ai); if (ai) o.ai = ai;
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
// Day plan block kind per PR group (constants.js PR_SLOT_DEFAULTS). Kinds are lowercase, like a block's kind.
function cleanSlots(t){
  const out = {};
  for (const [k, d] of Object.entries(PR_SLOT_DEFAULTS)){
    const v = t && typeof t === 'object' ? t[k] : undefined;
    out[k] = typeof v === 'string' ? v.trim().toLowerCase().slice(0, 40) : d;
  }
  return out;
}
const prGroup = pr => pr && pr.tier === 'blocking' ? 'blocking' : 'pending';
function sanitize(s){
  if (!s || !Array.isArray(s.lists) || !s.lists.length) return fresh();
  s.version = 2;
  s.tasks = Array.isArray(s.tasks) ? s.tasks : [];
  s.colorIdx = Number.isFinite(s.colorIdx) ? s.colorIdx : 0;
  if (!(s.lens in LENSES)) s.lens = (s.view in LENSES) ? s.view : 'rank';
  // Triage and Prioritize are columns of Today now (Docket 6.0): an old view opens Today.
  if (!VIEWS.includes(s.view)) s.view = 'today';
  s.capacity = Number.isFinite(+s.capacity) && +s.capacity >= 1 ? Math.min(999, Math.round(+s.capacity)) : 20;
  s.capacityAt = Number.isFinite(s.capacityAt) ? s.capacityAt : 0;
  // who: people and group ids from Workshop's people directory (directory-model.js). Names a task still has in
  // `people` (saved before ids, or just imported) stay until directory.js adoptNames turns them into ids.
  delete s.people; delete s.personLinks;
  s.tasks.forEach(t => {
    t.who = [...new Set((Array.isArray(t.who) ? t.who : []).filter(isRef))].slice(0, 20);
    if (Array.isArray(t.people)){ t.people = t.people.map(n => String(n ?? '').trim()).filter(Boolean); if (!t.people.length) delete t.people; }
    else delete t.people;
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
  if (!PR_SHOW.includes(s.prs)) s.prs = 'all';
  delete s.includeSub; delete s.activeListId;
  s.ado = s.ado && typeof s.ado === 'object' ? s.ado : {};
  if (s.ado.listId && !ids.has(s.ado.listId)) delete s.ado.listId;
  s.ado.skip = Array.isArray(s.ado.skip) ? s.ado.skip.filter(n => Number.isInteger(n)).slice(-500) : [];
  s.ado.skipPr = Array.isArray(s.ado.skipPr) ? s.ado.skipPr.filter(k => typeof k === 'string').slice(-500) : [];
  s.ado.choose = s.ado.choose !== false;   // new work items wait for you to pick them (default)
  const mins = Math.round(+s.ado.syncMinutes);
  s.ado.syncMinutes = mins >= ADO_SYNC_MIN && mins <= ADO_SYNC_MAX ? mins : ADO_SYNC_MINUTES;
  s.ado.prTiers = cleanTiers(s.ado.prTiers);
  s.ado.prSlots = cleanSlots(s.ado.prSlots);
  s.ado.pending = Array.isArray(s.ado.pending) ? s.ado.pending.map(cleanPending).filter(Boolean).slice(0, 300) : [];
  if (s.ado.prListId && !ids.has(s.ado.prListId)) delete s.ado.prListId;
  s.ado.prHeld = cleanHeld(s.ado.prHeld, cleanPr);       // PRs waiting for Tandem's review before they become tasks
  s.ado.prHoldMinutes = cleanHoldMinutes(s.ado.prHoldMinutes);
  s.rowFields = cleanRowFields(s.rowFields);   // which optional row fields are hidden (row-fields-model.js)
  s.follow = cleanFollow(s.follow);            // follow-up days for delegated tasks (delegate-model.js)
  normalizeRanks(s);
  return s;
}
/* per-window UI state, kept in this browser (not part of the saved board): sidebar, and which view,
   lens, scope and PR filter this window shows, so two windows can look at different things. */
let ui = {collapsed: false};
try { ui = Object.assign(ui, JSON.parse(localStorage.getItem(UI_KEY) || '{}')); } catch(e) {}
const saveUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch(e) {} };
delete ui.eng; // old eng-agents connection settings; the opencode connector replaced them

// The board starts empty; storage.js loads the saved one before the first render.
let state = Object.assign(fresh(), pickWindow(ui));
function pickWindow(o){
  const w = {};
  for (const k of ['view','lens','scope']) if (typeof o[k] === 'string') w[k] = o[k];
  if (PR_SHOW.includes(o.prs)) w.prs = o.prs;
  if (Number.isFinite(o.colorIdx)) w.colorIdx = o.colorIdx;
  return w;
}
// state is module-private. Other modules replace it through this setter, because an ES module cannot
// assign to a binding it imported from here.
function setState(s){ state = s; }
/* Waiting for the data folder: in browser mode Chrome must be asked again (after a restart, for example) before
   the board can load. Until then the board is not shown and nothing can be added or edited, so no edit is made
   that would be thrown away when the saved board loads. storage.js sets it; render.js shows the empty state. */
let waiting = false;
const isWaiting = () => waiting;
function setWaiting(v){ waiting = !!v; document.body.classList.toggle('waiting', waiting); }

function save(){
  if (waiting) return;
  const w = pickWindow(state);
  if (Object.keys(w).some(k => ui[k] !== w[k])){ Object.assign(ui, w); saveUi(); }
  scheduleSave();
}
function commit(){ save(); render(); }

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
  // With one list there is nothing to choose between, so "All lists" is just that list.
  if (state.scope === 'all') return state.lists.length === 1 ? state.lists[0].name : 'All lists';
  const L = listById(state.scope); if (!L) return 'All lists';
  return L.parentId ? `${listById(L.parentId).name} › ${L.name}` : L.name;
}
const defaultListId = () => state.scope !== 'all' && listById(state.scope) ? state.scope : topLists()[0].id;
/* Which PR review tasks this window shows: 'all', 'mine' (hides Team PRs, the ones any teammate can take) or
   'none'. Per window, like scope. Picking the Pull requests list itself always shows its PRs, so 'none' never
   leaves you looking at an empty list you chose. Work items, your own tasks and done tasks are never hidden. */
function shown(t){
  if (!t.pr || t.done) return true;
  if (state.prs === 'mine') return t.pr.tier !== 'pool';
  if (state.prs === 'none') return state.scope === state.ado.prListId;
  return true;
}
// How many open tasks the PR filter hides in the current scope.
const hiddenCount = () => state.tasks.filter(t => !t.done && scopeListIds().includes(t.listId) && !shown(t)).length;
const inScope = t => scopeListIds().includes(t.listId) && shown(t);
const isDoneToday = t => t.done && !t.wontDo && t.doneAt === todayStr();
const scopeOpen = () => state.tasks.filter(t => !t.done && inScope(t)).sort((a,b) => a.rank - b.rank);
const isFocus = t => t.focusOn === todayStr() && (!t.done || isDoneToday(t));
function triageQueue(){
  return state.tasks.filter(t => !t.done && inScope(t) && !isTriaged(t))
    .sort((a,b) => a.ageFrom.localeCompare(b.ageFrom) || a.rank - b.rank);
}
// Today's Inbox column: what needs a decision. Tasks to sort (no value or effort), then work that came back from
// someone (Got it back), oldest first. Stale tasks stay in Ranked with their mark (Docket 7.0.0); Plan week filters them.
const inInbox = t => !t.done && inScope(t) && (!isTriaged(t) || isDate(t.cameBack));
function inboxQueue(){
  const q = triageQueue(), have = new Set(q.map(t => t.id));
  const back = state.tasks.filter(t => !t.done && inScope(t) && isDate(t.cameBack) && !have.has(t.id)).sort((a,b) => a.cameBack.localeCompare(b.cameBack) || a.rank - b.rank);
  return [...q, ...back];
}
// Today's Ranked column: open tasks in rank order, without the Inbox's, what is waiting on someone, and PR reviews
// (blocking ones are pinned on Today; the rest are Up next's Reviews line).
const rankedOpen = () => scopeOpen().filter(t => !inInbox(t) && !t.waiting && !t.pr);
export { inInbox, inboxQueue, rankedOpen, PR_GONES, PR_SHOW, hiddenCount, shown, isWaiting, setWaiting, childrenOf, cleanAdo, cleanPending, cleanPr, cleanSlots, cleanTiers, commit, prGroup, defaultListId, findTask, fresh, inScope, initials, isDoneToday, isFocus, listById, migrateTask, normalizeRanks, orderedLists, sanitize, save, saveUi, scopeListIds, scopeName, scopeOpen, setState, state, topLists, triageQueue, ui };
