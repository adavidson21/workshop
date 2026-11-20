import { adoIsOn } from '../../../shared/ado.js';
import { TRACKERS, prMatchKey, reachNote, shouldAutoConnect, trackerName, trackersNote } from './tracker-status.js';
import { focusNow, heldNow, holdCount } from './focus-hours.js';
import { PAIR_KEY } from '../../../shared/pair.js';
import { TRACKER_SYNC_MAX, TRACKER_SYNC_MIN, COLORS, VALUE } from './constants.js';
import { flushText } from './drawer.js';
import { hideTip, placeTip, tipFor } from './events.js';
import { closeMenu, closeModal, popMenu, showModal, toast } from './overlays.js';
import { setScope, setView } from './render.js';
import { PR_GONES, cleanItem, cleanPending, cleanPr, cleanSlots, commit, prGroup, isWaiting, listById, normalizeRanks, saveUi, state, topLists, ui } from './state.js';
import { $, esc, fmtDay, fmtLong, fmtMD, isDate, plural, todayStr, uid } from './util.js';
import { embedded, ready } from './ws.js';
import { assign } from './directory.js';
import { followDate } from './delegate.js';
import { PR_HOLD_MAX, PR_HOLD_MIN, commitOf, holdsNew } from './pr-ai-model.js';
import { prAiActive, prAiAfterSync, prAiOnSync } from './pr-ai.js';
import { slateFor, slateLabel } from './slate-link.js';
import { dp, planPr } from './dayplan.js';
/* Prioritizer: work item sync from Azure DevOps and GitHub, through Workshop's tracker connectors. */
/* ---------- Trackers ----------
   Where the data comes from: Workshop's ADO and GitHub connectors, reached through the SDK (ws.connectors) when
   this page uses Workshop on this computer: inside Workshop, or on Docket's own site once paired. Nothing else
   talks to them. Each turned-on connector is synced in turn; a task's t.item.system says which one it came from,
   and an item's key is "<system>:<id>" (ADO ids are numbers, GitHub ids are "owner/repo#12"). When no connector
   can be reached, the sync button and its Settings say what to do (js/tracker-status.js). How often to sync,
   whether new work items wait for you, and PR tier values are Docket's own data, in state.tracker. */
const SYNC_MIN_GAP = 2 * 60 * 1000;
const TRACKER_GONE = {closed: 'Closed in {s}', removed: 'Removed in {s}', reassigned: 'Reassigned in {s}', missing: 'Not found in {s}', filtered: 'No longer matches the {s} filter'};
const inSys = (text, system) => text.replace('{s}', trackerName(system));
/** Why a synced item left: "Closed in GitHub" and the like. */
export const goneText = (reason, system) => TRACKER_GONE[reason] ? inSys(TRACKER_GONE[reason], system) : '';
/** An item's key across trackers: "ado:123" or "github:owner/repo#12". */
export const itemKey = l => `${l.system || 'ado'}:${l.id}`;
const PRIORITY_VALUE = {1: 4, 2: 3, 3: 2, 4: 1};   // priority 1 (highest) to 4 (ADO's field, GitHub's P1 to P4 labels), as a starting value
// Labels and tips per PR tier. The starting value and urgent flag for each are in state.tracker.prTiers.
// Groups: Blocking (blocking) and Pending (asked, pool). PRs that don't need you never get here: Workshop's tracker
// connectors leave them out (Settings, Pull requests), and a known one comes back gone as "notneeded".
const PR_TIER = {
  blocking: {label: 'Blocking', tip: "You're a required reviewer, so it can't merge without you"},
  asked: {label: 'Pending', tip: 'You were added by name as an optional reviewer'},
  pool: {label: 'Pending, team', tip: 'Your team was added, so any teammate can review it'}
};
const PR_GROUP = {blocking: 'Blocking', pending: 'Pending'};
const tierOf = k => Object.assign({}, PR_TIER[k] || PR_TIER.pool, state.tracker.prTiers[k] || state.tracker.prTiers.pool);
const PR_GONE = {reviewed: 'You voted', covered: 'A teammate reviewed it', notneeded: "Doesn't need you", merged: 'Merged', abandoned: 'Closed without merging',
  unassigned: 'No longer a reviewer', draft: 'Back to draft', own: 'Your own PR', missing: 'Not found'};
const prTip = p => `PR ${p.id} in ${p.repo}${p.author ? ' by ' + p.author : ''}${p.via.length && p.tier === 'pool' ? ', via ' + p.via.join(', ') : ''}${p.lastBlocker ? '. Everyone else required has approved' : ''}`;
const trackerShort = type => ({'User Story': 'Story', 'Product Backlog Item': 'PBI'})[type] || type || 'Item';
// "#123" for ADO, "owner/repo#12" for GitHub.
export const itemRef = l => l && l.system === 'github' ? String(l.id) : `#${l ? l.id : ''}`;
// Per-device sync state. Called by main.js once every module has loaded (modules import each other in a cycle).
function trackerInit(){ ui.tracker = Object.assign({on: false, offByUser: false, last: 0, error: '', noteErr: false}, ui.tracker || {}); delete ui.tracker.port;
  if (/ADO helper|Helper answered/.test(ui.tracker.error)) ui.tracker.error = '';   // left by the retired helper
}
let trackerBusy = false, trackerTimer = null;

function trackerList(){
  let L = state.tracker.listId && listById(state.tracker.listId);
  if (!L) L = topLists().find(l => ['work items', 'ado'].includes(l.name.toLowerCase()));
  if (!L){ L = {id: uid(), name: 'Work items', parentId: null}; state.lists.push(L); }
  state.tracker.listId = L.id;
  return L;
}
function prList(){
  const parent = trackerList();
  let L = state.tracker.prListId && listById(state.tracker.prListId);
  if (!L) L = state.lists.find(l => l.parentId === parent.id && l.name.toLowerCase() === 'pull requests');
  if (!L){ L = {id: uid(), name: 'Pull requests', parentId: parent.id}; state.lists.push(L); }
  state.tracker.prListId = L.id;
  return L;
}
const linkOf = (it, system) => ({system: system || it.system || 'ado', id: it.id, type: it.type, state: it.state, url: it.url, project: it.project, due: isDate(it.due) ? it.due : undefined});
function trackerAddItem(it, rank, system){
  const link = linkOf(it, system);
  const nt = {id: uid(), title: it.title || `${trackerName(link.system)} ${itemRef(link)}`, notes: '', color: COLORS[state.colorIdx++ % COLORS.length], rank,
    value: PRIORITY_VALUE[it.priority] || null, effort: null, due: link.due || null, urgentFlag: false, listId: trackerList().id,
    done: false, doneAt: null, wontDo: false, createdAt: todayStr(), ageFrom: todayStr(), waiting: false, nudgeOn: null, focusOn: null, who: []};
  nt.item = cleanItem(link);
  state.tasks.push(nt);
  return nt;
}
// Add or skip picked pending items. Skipped ones go on the skip list so they don't come back.
// addKeys and skipKeys are item keys (itemKey). Plain numbers are ADO ids (older callers and tests).
function trackerPick(addKeys, skipKeys){
  const asKey = k => typeof k === 'number' ? `ado:${k}` : String(k);
  const add = new Set(addKeys.map(asKey)), skip = new Set(skipKeys.map(asKey));
  let maxRank = state.tasks.reduce((m, t) => Math.max(m, t.rank), 0), added = 0;
  for (const p of state.tracker.pending){
    const k = itemKey(p);
    if (add.has(k) && !state.tasks.some(t => t.item && itemKey(t.item) === k)){ trackerAddItem(p, ++maxRank); added++; }
    else if (skip.has(k)) state.tracker.skip.push(k);
  }
  state.tracker.pending = state.tracker.pending.filter(p => !add.has(itemKey(p)) && !skip.has(itemKey(p)));
  return added;
}
// Already on Slate's board (slate-link.js): say where, so it can be skipped knowingly. Inside Workshop only.
const inSlate = p => { const sl = embedded && p.system !== 'github' ? slateFor(p.id) : null; return sl ? ` · <span class="chip">${esc(slateLabel(sl))}</span>` : ''; };
function trackerReview(){
  const P = state.tracker.pending;
  if (!P.length){ toast('No new work items to review.'); return; }
  setTracker();
  const both = new Set(P.map(p => p.system)).size > 1;
  const item = p => `<li><label><input type="checkbox" value="${esc(itemKey(p))}" checked><span class="ptx">${esc(p.title || trackerName(p.system) + ' ' + itemRef(p))}
      <span class="pmeta">${both ? esc(trackerName(p.system)) + ' · ' : ''}${esc(trackerShort(p.type))} ${esc(itemRef(p))} · ${esc(p.state)}${p.priority ? ' · P' + p.priority : ''}${p.due ? ' · due ' + fmtDay(p.due) : ''}${p.project && p.system !== 'github' ? ' · ' + esc(p.project) : ''}${inSlate(p)}</span></span></label>
      ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">Open</a>` : ''}</li>`;
  const sorted = [...P].sort((a, b) => (a.priority || 9) - (b.priority || 9) || (a.due || '9').localeCompare(b.due || '9') || itemKey(a).localeCompare(itemKey(b), undefined, {numeric: true}));
  showModal(`<div class="sheet" role="dialog" aria-modal="true" aria-label="New work items"><h3>New work items${globalThis.WorkshopTheme?.hints ? globalThis.WorkshopTheme?.hints.html('docket.ado-new', "Assigned to you, not on your board yet. Skipped items won't come back.", 'About new work items') : ''}</h3>
    <div class="drow" style="margin-top:.5rem;gap:.8rem"><button class="lnk" data-all="1">Check all</button><button class="lnk" data-all="0">Uncheck all</button></div>
    <ul class="pick">${sorted.map(item).join('')}</ul>
    <footer><button class="btn" data-skip>Skip unchecked</button><span class="grow"></span><button class="btn" data-close>Later</button><button class="btn primary" data-ado-add>Add checked</button></footer></div>`,
    sh => {
      const boxes = () => [...sh.querySelectorAll('.pick input')];
      const sync = () => { const k = boxes().filter(b => b.checked).length; const a = sh.querySelector('[data-ado-add]'); a.textContent = k ? `Add ${k}` : 'Add checked'; a.disabled = !k; };
      sh.addEventListener('change', sync); sync();
      sh.addEventListener('click', e => {
        const all = e.target.closest('[data-all]'); if (all){ boxes().forEach(b => b.checked = all.dataset.all === '1'); sync(); return; }
        const isAdd = e.target.closest('[data-ado-add]'), isSkip = e.target.closest('[data-skip]');
        if (!isAdd && !isSkip) return;
        const on = boxes().filter(b => b.checked).map(b => b.value), off = boxes().filter(b => !b.checked).map(b => b.value);
        // Add: add checked, leave unchecked for later. Skip unchecked: add checked too, and skip the rest for good.
        const added = trackerPick(on, isSkip ? off : []);
        normalizeRanks(state); commit(); setTracker(); closeModal();
        const bits = [added && `Added ${plural(added, 'task')}`, isSkip && off.length && `skipped ${off.length}`].filter(Boolean);
        if (bits.length) toast(bits.join(', ').replace(/^s/, 'S'), added ? 'Show' : null, () => setScope(state.tracker.listId));
      });
    });
}
function trackerNote(t, line){ t.notes = (t.notes ? t.notes + '\n' : '') + line; }

// Pure merge of a connector sync response into state; returns counts. Exposed on the test hook.
// opts.system: which tracker res came from ('ado' when not given). Only that tracker's tasks, pending items and
// PRs are touched, so two trackers sync one after the other without undoing each other.
function trackerApply(res, opts = {}){
  const system = opts.system || 'ado', name = trackerName(system), key = id => `${system}:${id}`;
  const n = {added: 0, updated: 0, closed: 0, removed: 0, reopened: 0, pending: 0, pendingChanged: false, prAdded: 0, prBlocking: 0, prBack: 0, prDone: 0, prHeld: 0, heldChanged: false};
  const byId = new Map(state.tasks.filter(t => t.item && t.item.system === system).map(t => [key(t.item.id), t]));
  const skip = new Set(state.tracker.skip);
  let maxRank = state.tasks.reduce((m, t) => Math.max(m, t.rank), 0);
  // res.items is every open item assigned to you, so the pending list is rebuilt each sync:
  // anything closed or reassigned before you picked it just drops off.
  const others = state.tracker.pending.filter(p => p.system !== system);
  const oldPending = new Map(state.tracker.pending.filter(p => p.system === system).map(p => [itemKey(p), p])), pending = [];
  for (const it of res.items || []){
    const t = byId.get(key(it.id));
    const link = linkOf(it, system);
    if (!t){
      if (skip.has(key(it.id))) continue;
      if (state.tracker.choose){
        const old = oldPending.get(key(it.id));
        const p = cleanPending({...it, system, seen: old ? old.seen : todayStr()});
        if (p){ pending.push(p); if (!old) n.pending++; }
        continue;
      }
      trackerAddItem(it, ++maxRank, system); n.added++;
      continue;
    }
    const before = JSON.stringify([t.title, t.item, t.due, t.done]);
    if (t.done && t.item.gone){                       // was closed or reassigned by a sync, now open and yours again
      t.done = false; t.wontDo = false; t.doneAt = null;
      trackerNote(t, `Back in ${name} as ${it.state || 'open'} on ${fmtLong(todayStr())}.`); n.reopened++;
    }
    if (it.title) t.title = it.title;
    if (t.due === (t.item.due || null) && link.due) t.due = link.due;   // follow the tracker's date unless you changed it here
    t.item = cleanItem(link);
    if (before !== JSON.stringify([t.title, t.item, t.due, t.done])) n.updated++;
  }
  if (Array.isArray(res.items)){ if (pending.length !== oldPending.size || pending.some(p => !oldPending.has(itemKey(p)))) n.pendingChanged = true; state.tracker.pending = [...others, ...pending]; }
  if (res.prs) prApply(res.prs, n, {...opts, system});
  for (const g of res.gone || []){
    const t = byId.get(key(g.id)); if (!t || t.item.pasted) continue;
    if (g.state) t.item.state = g.state;
    if (t.done){ t.item.gone = t.item.gone || g.reason; continue; }
    t.item.gone = g.reason;
    t.done = true; t.doneAt = todayStr();
    if (g.reason === 'closed'){ n.closed++; }
    else {
      t.wontDo = true; n.removed++;
      trackerNote(t, g.reason === 'reassigned' ? `Reassigned in ${name}${g.assignedTo ? ' to ' + g.assignedTo : ''} on ${fmtLong(todayStr())}.`
        : `${TRACKER_GONE[g.reason] ? inSys(TRACKER_GONE[g.reason], system) : `Dropped by ${name}`} on ${fmtLong(todayStr())}.`);
    }
  }
  return n;
}

// PRs: tier sets a starting value and urgent flag; later tier changes follow only if you haven't changed them here.
// With Tandem's first-pass reviews on (opts.ai, js/pr-ai.js), asked and team-only PRs wait in state.tracker.prHeld
// until their review ends, and blocking ones land at once marked as being reviewed.
function prNewTask(it, link, rank, ai){
  const tier = tierOf(link.tier);
  const nt = {id: uid(), title: `Review: ${it.title || 'PR ' + link.id}`, notes: '', color: COLORS[state.colorIdx++ % COLORS.length], rank,
    value: tier.value, effort: 'S', due: null, urgentFlag: tier.urgent, listId: prList().id,
    done: false, doneAt: null, wontDo: false, createdAt: todayStr(), ageFrom: isDate(it.created) ? it.created : todayStr(),
    waiting: link.waiting, nudgeOn: link.waiting ? followDate() : null, focusOn: null, who: []};
  if (link.waiting && link.author) assign(nt, [link.author], {ado: link.system !== 'github'});
  if (ai) link.ai = ai;
  nt.pr = link;
  state.tasks.push(nt);
  prPlan(nt);
  return nt;
}
/* Into the Day plan block for its group (state.tracker.prSlots); from: the old group, when it changed. A PR waiting
   for its author is not planned. Lands on Today when the block is today. */
function prPlan(t, from){
  if (t.done || t.waiting || !t.pr) return null;
  const slots = state.tracker.prSlots, at = planPr(t.id, slots[prGroup(t.pr)], from ? slots[from] : '');
  if (at && at.date === todayStr()) t.focusOn = at.date;
  return at;
}
function prApply(prs, n, opts = {}){
  const aiOn = !!opts.ai, now = new Date(), system = opts.system || 'ado';
  const ofSys = h => ((h.item && h.item.system) || 'ado') === system;
  // Matched on prMatchKey, so a PR synced by the retired helper under a differently written collection URL is
  // the same task (its key then takes the connector's form).
  const byKey = new Map(state.tasks.filter(t => t.pr).map(t => [prMatchKey(t.pr.key), t]));
  const skip = new Set(state.tracker.skipPr.map(prMatchKey));
  const mineHeld = state.tracker.prHeld.filter(ofSys), othersHeld = state.tracker.prHeld.filter(h => !ofSys(h));
  const heldBy = new Map(mineHeld.map(h => [prMatchKey(h.key), h])), held = [];
  const on = fmtLong(todayStr());
  let maxRank = state.tasks.reduce((m, t) => Math.max(m, t.rank), 0);
  for (const it of prs.items || []){
    const link = cleanPr({...it, system, commit: commitOf(it) || undefined}); if (!link) continue;
    const tier = tierOf(link.tier), title = `Review: ${it.title || 'PR ' + link.id}`;
    const t = byKey.get(prMatchKey(link.key));
    if (!t){
      if (skip.has(prMatchKey(link.key))) continue;
      const h = heldBy.get(prMatchKey(link.key));
      if (holdsNew(aiOn, link)){                     // waits for Tandem's review (js/pr-ai.js lets it go)
        held.push({key: link.key, since: h ? h.since : now.toISOString(), item: {...it, system, key: link.key}});
        if (!h) n.prHeld++;
        continue;
      }
      prNewTask(it, link, ++maxRank, aiOn && !link.waiting ? {state: 'pending', at: now.toISOString()} : null);
      n.added++; n.prAdded++; if (link.tier === 'blocking' && !link.waiting) n.prBlocking++;
      continue;
    }
    const before = JSON.stringify([t.title, t.pr, t.value, t.urgentFlag, t.waiting, t.done]);
    if (t.done && t.pr.gone){                       // done by a sync, now back on you (e.g. your vote reset after a new push)
      t.done = false; t.wontDo = false; t.doneAt = null;
      trackerNote(t, `Back for your review on ${on}.`); n.reopened++;
    }
    if (t.pr.tier !== link.tier){
      const old = tierOf(t.pr.tier);
      if (t.value === old.value) t.value = tier.value;
      if (t.urgentFlag === old.urgent) t.urgentFlag = tier.urgent;
      trackerNote(t, `Now ${tier.label.toLowerCase()} (${tier.tip.toLowerCase()}) as of ${on}.`);
      if (link.tier === 'blocking' && !t.done) n.prBlocking++;
    }
    if (link.waiting && !t.pr.waiting){
      t.waiting = true;
      if (!t.nudgeOn) t.nudgeOn = followDate();
      if (link.author) assign(t, [link.author], {add: true, ado: system !== 'github'});
      trackerNote(t, system === 'github' ? `You requested changes on ${on}.` : `You voted Waiting for author on ${on}.`);
    } else if (!link.waiting && t.pr.waiting && !t.done){
      t.waiting = false; t.nudgeOn = null; t.cameBack = todayStr();
      trackerNote(t, `Back to you for review on ${on}.`); n.prBack++;
    }
    // Tandem's review: kept across syncs; a new commit starts it over (the connector queues it again).
    if (t.pr.ai) link.ai = t.pr.ai;
    // An open PR task with no review yet (from before Tandem was on) gets one too.
    if (aiOn && !link.waiting && !t.done && (!t.pr.ai || (link.commit && t.pr.commit && link.commit !== t.pr.commit)))
      link.ai = {state: 'pending', at: now.toISOString()};
    else if (!aiOn && link.ai && link.ai.state === 'pending') delete link.ai;
    const was = prGroup(t.pr), back = t.pr.waiting && !link.waiting;
    t.title = title;
    t.pr = link;
    if (was !== prGroup(link)) prPlan(t, was);        // e.g. made required: moves to the Blocking block
    else if (back) prPlan(t);                         // back from the author
    if (before !== JSON.stringify([t.title, t.pr, t.value, t.urgentFlag, t.waiting, t.done])) n.updated++;
  }
  // Held PRs no longer waiting on you (merged, abandoned, you voted, a teammate covered it) just drop off.
  if (held.length !== mineHeld.length || held.some((h, i) => h.key !== mineHeld[i].key)) n.heldChanged = true;
  state.tracker.prHeld = [...othersHeld, ...held];
  for (const g of prs.gone || []){
    const t = byKey.get(prMatchKey(g.key)); if (!t) continue;
    t.pr.gone = PR_GONES.includes(g.reason) ? g.reason : 'missing';
    if (t.done) continue;
    t.done = true; t.doneAt = todayStr(); t.waiting = false; t.nudgeOn = null; n.prDone++;
    if (['notneeded', 'unassigned', 'draft', 'own', 'missing'].includes(t.pr.gone)) t.wontDo = true;
    if (t.pr.ai && t.pr.ai.state === 'pending') delete t.pr.ai;
    trackerNote(t, `${PR_GONE[t.pr.gone]} on ${on}.`);
  }
}

/** Held PRs whose review ended (js/pr-ai.js): each becomes a task carrying Tandem's result. */
function prRelease(list){
  let maxRank = state.tasks.reduce((m, t) => Math.max(m, t.rank), 0);
  const made = [];
  for (const {entry, ai} of list){
    const link = cleanPr(entry.item); if (!link) continue;
    if (state.tasks.some(t => t.pr && prMatchKey(t.pr.key) === prMatchKey(link.key))) continue;
    made.push(prNewTask(entry.item, link, ++maxRank, ai));
  }
  if (made.length) normalizeRanks(state);
  return made;
}

/* Which tracker connectors are reachable, turned on and ready (trackerIds, in TRACKERS order), and whether ADO is
   one of them (adoReady, for Runway's team reports). Decided at start and again when a connector or Workshop's
   connection changes. */
let trackerReady = false, adoReady = false, trackerIds = [];
// What to tell the person ({error, warn}): why the connectors can't be reached (reachNote), or the connectors' own
// words (trackersNote, for example a missing token). Refreshed on every detect. Not saved.
let trackerNoteNow = {error: '', warn: ''};
const pairSaved = () => { try { return !!localStorage.getItem(PAIR_KEY); } catch(e){ return false; } };
const reachNow = ws => reachNote(ws, {pairSaved: pairSaved(), embedded});
// A connector call that failed because Workshop itself did not answer.
const STOPPED = reachNote({backend: 'agent', online: false});
const trackerUnreachable = e => !!e && (e.code === 'unavailable' || e instanceof TypeError);
const namesOf = ids => ids.map(trackerName).join(' and ');
async function trackerDetect(){
  const ws = await ready;
  trackerReady = false; adoReady = false; trackerIds = [];
  const reach = reachNow(ws);
  if (reach) trackerNoteNow = {error: reach, warn: ''};
  else {
    try {
      const list = await ws.connectors.list();
      const note = trackersNote(list);
      trackerNoteNow = {error: note.error, warn: note.warn};
      trackerIds = note.ids;
      trackerReady = list.some(c => Object.hasOwn(TRACKERS, c.id) && c.enabled);
      adoReady = list.some(c => c.id === 'ado' && c.enabled);
      // Set up in Workshop Settings already: no second Connect here. Turning it off in Docket sticks.
      if (shouldAutoConnect(list, ui.tracker)){
        ui.tracker.on = true; ui.tracker.error = ''; ui.tracker.last = 0; saveUi(); trackerSchedule();
        toast(`${namesOf(note.ids)} ${note.ids.length > 1 ? 'are' : 'is'} connected through Workshop. Syncing your work items and reviews now.`);
      }
    } catch(e){ trackerNoteNow = {error: trackerUnreachable(e) ? STOPPED : e.message, warn: ''}; }
  }
  // Fixed since (Workshop started, connector turned on, new token): drop the old message. A failed sync's own error stays.
  if (ui.tracker.noteErr && !trackerNoteNow.error && !trackerBusy){ ui.tracker.error = ''; ui.tracker.noteErr = false; saveUi(); }
  setTracker();
  return trackerReady;
}
// One request through a tracker connector (system: 'ado' or 'github'): name is sync, dataset or health.
async function trackerCall(name, args, system = 'ado'){
  const ws = await ready;
  const reach = reachNow(ws);
  if (reach) throw new Error(reach);
  if (name === 'health'){
    const note = trackersNote((await ws.connectors.list()).filter(x => x.id === system));
    if (note.error) throw new Error(note.error);
    return {collections: [], reports: true};
  }
  return ws.connectors.call(system, name, args);
}

async function trackerSync(manual){
  if (trackerBusy || !ui.tracker.on || isWaiting()) return;
  // Already known why a sync would fail (Workshop not reachable, connector off, no PAT, rejected PAT): show that, skip the request.
  if (trackerNoteNow.error){ ui.tracker.error = trackerNoteNow.error; ui.tracker.noteErr = true; saveUi(); setTracker(); if (manual) toast(ui.tracker.error); return; }
  if (!manual && Date.now() - ui.tracker.last < SYNC_MIN_GAP) return;
  trackerBusy = true; setTracker();
  try {
    const ids = trackerIds.length ? trackerIds : ['ado'];
    const sum = {added: 0, updated: 0, closed: 0, removed: 0, reopened: 0, pending: 0, pendingChanged: false, prAdded: 0, prBlocking: 0, prBack: 0, prDone: 0, prHeld: 0, heldChanged: false};
    const errors = [], prErrors = [], allPrs = [];
    let firstErr = null;
    let items = 0, anyPrs = false, ai = null, synced = 0;
    for (const system of ids){
      const name = trackerName(system);
      let res;
      try {
        const known = state.tasks.filter(t => t.item && t.item.system === system && !t.item.pasted && !t.done).map(t => t.item.id);
        const knownPrs = state.tasks.filter(t => t.pr && (t.pr.system || 'ado') === system && !t.done).map(t => t.pr.key);
        res = await trackerCall('sync', {known, knownPrs}, system);
      } catch(e){
        if (e instanceof TypeError) throw e;   // Workshop itself did not answer
        firstErr = firstErr || e;
        errors.push(ids.length > 1 ? `${name}: ${e.message}` : e.message); continue;
      }
      synced++;
      if (res.prs && ai === null) ai = await prAiActive();   // Tandem reviews new PRs first (js/pr-ai.js)
      flushText();
      const n = trackerApply(res, {ai: !!ai, system});
      for (const k of Object.keys(sum)) sum[k] = typeof sum[k] === 'boolean' ? sum[k] || n[k] : sum[k] + n[k];
      items += (res.items || []).length;
      if (res.prs){ anyPrs = true; allPrs.push(...res.prs.items); }
      if (res.prError) prErrors.push(ids.length > 1 ? `${name} pull requests: ${res.prError}` : `Pull requests: ${res.prError}`);
    }
    if (!synced) throw ids.length === 1 ? firstErr : Object.assign(new Error(errors.join(' ')), {code: firstErr && firstErr.code});
    const n = sum, label = namesOf(ids);
    ui.tracker.last = Date.now(); ui.tracker.error = [...errors, ...prErrors].join(' '); ui.tracker.noteErr = false; saveUi();
    const changed = n.added + n.updated + n.closed + n.removed + n.reopened + n.prDone + (n.pendingChanged || n.heldChanged ? 1 : 0);
    if (changed){ normalizeRanks(state); commit(); }
    if (ai) prAiAfterSync({prs: {items: allPrs}});
    const bits = [n.prBlocking && `${n.prBlocking} PR${n.prBlocking > 1 ? 's' : ''} blocked on you`, n.prHeld && `${plural(n.prHeld, 'PR')} with Tandem for a first pass`, n.prBack && `${n.prBack} PR${n.prBack > 1 ? 's' : ''} back to you`,
      n.added && `${n.added} new`, n.closed && `${n.closed} closed`, n.removed && `${n.removed} reassigned or removed`, n.reopened && `${n.reopened} reopened`].filter(Boolean);
    // Focus hours (Workshop docs/focus.md): a sync on its own (not Sync now) during focus or lunch shows no toast; the
    // items still land, and are counted in Docket's held card. PRs blocked on you still show during focus.
    if (!manual && heldNow() && (n.pending || bits.length)){
      holdCount(n.pending + Math.max(0, n.added - n.prAdded), 'ado');
      holdCount(Math.max(0, n.prAdded - n.prBlocking), 'pr');
      if (n.prBlocking && focusNow().state === 'focus') toast(`${label}: ${n.prBlocking} PR${n.prBlocking > 1 ? 's' : ''} blocked on you`, 'Show', () => setScope(state.tracker.prListId));
      else if (n.prBlocking) holdCount(n.prBlocking, 'pr');
    }
    else if (n.pending) toast(`${label}: ${plural(n.pending, 'new work item')} to review${bits.length ? ', ' + bits.join(', ') : ''}`, 'Review', trackerReview);
    else if (bits.length) toast(`${label}: ${bits.join(', ')}`, n.added ? 'Show' : null, () => setScope(n.prAdded && n.prAdded === n.added ? state.tracker.prListId : state.tracker.listId));
    else if (manual) toast(ui.tracker.error ? `Synced, but: ${ui.tracker.error}`
      : `${label} ${ids.length > 1 ? 'are' : 'is'} up to date. ${plural(items, 'open item')}${anyPrs ? `, ${plural(allPrs.length, 'PR')} to review` : ''}.`);
  } catch(e){
    ui.tracker.error = trackerUnreachable(e) ? STOPPED : e.message; ui.tracker.noteErr = trackerUnreachable(e); saveUi();
    if (manual) toast(ui.tracker.error);
  } finally { trackerBusy = false; setTracker(); }
}
function trackerSchedule(){
  clearInterval(trackerTimer); trackerTimer = null;
  if (ui.tracker.on){ trackerTimer = setInterval(() => { if (!document.hidden) trackerSync(false); }, state.tracker.syncMinutes * 60 * 1000); }
}
function setTracker(){
  const b = $('#adoBtn'); if (!b) return;
  const np = ui.tracker.on ? state.tracker.pending.length : 0;
  if (np) b.dataset.pending = np > 99 ? '99+' : np; else delete b.dataset.pending;
  const ago = ui.tracker.last ? Math.round((Date.now() - ui.tracker.last) / 60000) : null;
  const warn = ui.tracker.on && !ui.tracker.error ? trackerNoteNow.warn : '';
  b.dataset.ado = trackerBusy ? 'busy' : !ui.tracker.on ? 'off' : ui.tracker.error ? 'error' : warn ? 'warn' : 'on';
  const label = trackerIds.length ? namesOf(trackerIds) : 'Work items';
  b.dataset.tip = !ui.tracker.on ? (adoIsOn() ? 'Connect Azure DevOps or GitHub' : 'Connect work items') : trackerBusy ? `Syncing with ${label}` : ui.tracker.error ? `${label}: ${ui.tracker.error}`
    : warn ? `${label}: ${warn}` : ago == null ? `${label} sync on` : `${label} synced ${ago < 1 ? 'just now' : plural(ago, 'minute') + ' ago'}`;
  if (tipFor === b) placeTip(b);
}
// Block kinds in the day plan's templates and the coming days, for the PR slot suggestions.
function dayKinds(){
  const out = new Set();
  for (const t of dp.templates || []) for (const sec of t.sections || []) if (sec.kind) out.add(sec.kind);
  for (const r of Object.values(dp.days || {})) for (const sec of (r && r.sections) || []) if (sec.kind) out.add(sec.kind);
  return [...out].sort();
}
async function trackerSetup(){
  await trackerDetect();
  const valueOpts = cur => [4, 3, 2, 1].map(v => `<option value="${v}"${v === cur ? ' selected' : ''}>${VALUE[v]}</option>`).join('');
  const tiers = Object.entries(PR_TIER).map(([k, d]) => { const t = state.tracker.prTiers[k]; return `<tr><th scope="row" title="${esc(d.tip)}">${d.label}</th>
      <td><select data-tier-value="${k}" aria-label="${d.label}: starting value">${valueOpts(t.value)}</select></td>
      <td><label class="chk"><input type="checkbox" data-tier-urgent="${k}"${t.urgent ? ' checked' : ''}> Urgent</label></td></tr>`; }).join('');
  showModal(`<div class="sheet" role="dialog" aria-modal="true" aria-label="Connect work items"><h3>Connect work items</h3>
    <p>Work items assigned to you and PRs waiting on your review, from ${adoIsOn() ? 'Azure DevOps and GitHub' : 'GitHub'}, become tasks in a <b>Work items</b> list. Sync runs through Workshop's ${adoIsOn() ? 'ADO and GitHub connectors' : 'GitHub connector'} on this computer. Their connections and tokens are in Workshop <b>Settings</b>; your tokens never reach this page.</p>
    <div class="opts" role="radiogroup" aria-label="New work items"><span class="lbl">New work items assigned to you</span>
      <label><input type="radio" name="adoChoose" value="1"${state.tracker.choose ? ' checked' : ''}> Let me choose which to add</label>
      <label><input type="radio" name="adoChoose" value="0"${state.tracker.choose ? '' : ' checked'}> Add them automatically</label></div>
    <div class="fld"><label for="adoEvery">Sync every</label><input type="number" id="adoEvery" class="mono" min="${TRACKER_SYNC_MIN}" max="${TRACKER_SYNC_MAX}" value="${state.tracker.syncMinutes}"> <span class="hint">minutes</span></div>
    <table class="tiers"><caption>New pull request reviews start at</caption><tbody>${tiers}</tbody></table>
    <table class="tiers"><caption>Plan new PR reviews into the Day plan block of kind</caption><tbody>
      ${Object.entries(PR_GROUP).map(([k, l]) => `<tr><th scope="row">${l}</th><td><input type="text" data-slot="${k}" class="mono" maxlength="40" list="adoKinds" value="${esc(state.tracker.prSlots[k])}" placeholder="not planned" autocomplete="off" aria-label="${l}: Day plan block kind"></td></tr>`).join('')}
    </tbody></table><datalist id="adoKinds">${dayKinds().map(k => `<option value="${esc(k)}">`).join('')}</datalist>
    <p class="hint">The next block of that kind that has not ended, today or a coming work day. Empty: not planned. PRs that don't need you are left out in Workshop <b>Settings</b>, Pull requests.</p>
    ${prAiOnSync() == null ? '' : `<div class="fld"><label for="adoHold">Hold asked and team PRs for Tandem's review up to</label><input type="number" id="adoHold" class="mono" min="${PR_HOLD_MIN}" max="${PR_HOLD_MAX}" value="${state.tracker.prHoldMinutes}"> <span class="hint">minutes</span></div>
    <p class="hint">${prAiOnSync() ? 'Tandem reviews new PRs first: blocking ones show right away, the rest once reviewed. Drafts only, nothing is posted. Turn it off in Workshop <b>Settings</b>, opencode, PR reviews.' : 'Tandem is not reviewing new PRs as they are found. Turn it on in Workshop <b>Settings</b>, opencode, PR reviews.'}</p>`}
    <p class="hint" id="adoMsg" aria-live="polite" style="margin-top:.6rem">${esc(trackerNoteNow.error || (ui.tracker.on && ui.tracker.error) || trackerNoteNow.warn)}</p>
    <footer>${ui.tracker.on ? '<button class="btn text-danger" data-ado-off>Disconnect</button>' : ''}<span class="grow"></span><button class="btn" data-close>Cancel</button><button class="btn primary" data-ado-go>${ui.tracker.on ? 'Save' : 'Connect'}</button></footer></div>`,
    sh => sh.addEventListener('click', async e => {
      if (e.target.closest('[data-ado-off]')){ ui.tracker.on = false; ui.tracker.offByUser = true; ui.tracker.error = ''; saveUi(); trackerSchedule(); setTracker(); closeModal(); toast('Work item sync is off. Synced tasks stay on your board.'); return; }
      const go = e.target.closest('[data-ado-go]'); if (!go) return;
      const msg = sh.querySelector('#adoMsg');
      const every = Math.round(+sh.querySelector('#adoEvery').value);
      if (!(every >= TRACKER_SYNC_MIN && every <= TRACKER_SYNC_MAX)){ msg.textContent = `Sync every ${TRACKER_SYNC_MIN} to ${TRACKER_SYNC_MAX} minutes.`; return; }
      const prTiers = {};
      for (const k of Object.keys(PR_TIER)) prTiers[k] = {value: +sh.querySelector(`[data-tier-value=${k}]`).value, urgent: sh.querySelector(`[data-tier-urgent=${k}]`).checked};
      const prSlots = cleanSlots(Object.fromEntries([...sh.querySelectorAll('[data-slot]')].map(el => [el.dataset.slot, el.value])));
      const choose = sh.querySelector('[name=adoChoose]:checked').value === '1';
      const holdEl = sh.querySelector('#adoHold'), hold = holdEl ? Math.round(+holdEl.value) : state.tracker.prHoldMinutes;
      if (!(hold >= PR_HOLD_MIN && hold <= PR_HOLD_MAX)){ msg.textContent = `Hold PRs ${PR_HOLD_MIN} to ${PR_HOLD_MAX} minutes.`; return; }
      if (choose !== state.tracker.choose || every !== state.tracker.syncMinutes || hold !== state.tracker.prHoldMinutes || JSON.stringify(prTiers) !== JSON.stringify(state.tracker.prTiers) || JSON.stringify(prSlots) !== JSON.stringify(state.tracker.prSlots)){
        state.tracker.syncMinutes = every; state.tracker.prTiers = prTiers; state.tracker.prSlots = prSlots; state.tracker.prHoldMinutes = hold;
        if (choose !== state.tracker.choose){ state.tracker.choose = choose; if (!choose){ trackerPick(state.tracker.pending.map(itemKey), []); normalizeRanks(state); } }
        commit();
      }
      go.disabled = true; msg.textContent = adoIsOn() ? 'Checking the ADO and GitHub connectors...' : 'Checking the GitHub connector...';
      try {
        if (!(await trackerDetect()) || trackerNoteNow.error) throw new Error(trackerNoteNow.error || 'Turn on a work item connector in Workshop Settings.');
        ui.tracker.on = true; ui.tracker.offByUser = false; ui.tracker.error = ''; ui.tracker.last = 0; saveUi();
        closeModal(); trackerSchedule(); trackerSync(true);
      } catch(err){
        msg.textContent = trackerUnreachable(err) ? STOPPED : err.message;
        go.disabled = false;
      }
    }));
}
function onAdoClick(btn){
  hideTip();
  if (!ui.tracker.on) return trackerSetup();
  const ago = ui.tracker.last ? fmtMD(new Date(ui.tracker.last)) + ' ' + new Date(ui.tracker.last).toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'}) : 'never';
  popMenu(`<div class="who"><b>${esc(trackerIds.length ? namesOf(trackerIds) : 'Work items')}</b>${ui.tracker.error ? esc(ui.tracker.error) : `Last sync ${esc(ago)}`}</div>
    ${!ui.tracker.error && trackerNoteNow.warn ? `<div class="mnote warn">${esc(trackerNoteNow.warn)}</div>` : ''}
    ${state.tracker.pending.length ? `<button data-a="review">Review ${plural(state.tracker.pending.length, 'new item')}</button>` : ''}
    <button data-a="now">Sync now</button><button data-a="show">Show Work items list</button>${adoReady ? '<button data-a="reports">Team reports in Runway</button>' : ''}<button data-a="setup">Settings</button>`, btn)
    .addEventListener('click', e => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      closeMenu();
      if (b.dataset.a === 'review') trackerReview();
      if (b.dataset.a === 'now') trackerSync(true);
      if (b.dataset.a === 'show'){ trackerList(); setScope(state.tracker.listId); }
      if (b.dataset.a === 'setup') trackerSetup();
      if (b.dataset.a === 'reports') ready.then(w => { if (w) w.open({app: 'runway', path: 'reports'}).catch(() => {}); });
    });
}

export { TRACKER_GONE, PR_GONE, PR_GROUP, PR_TIER, prPlan, trackerApply, prRelease, tierOf, trackerCall, trackerDetect, trackerInit, trackerPick, trackerReview, trackerSchedule, trackerSetup, trackerShort, trackerSync, onAdoClick, prTip, setTracker };
