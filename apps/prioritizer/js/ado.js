import { connectorNote, prMatchKey, reachNote, shouldAutoConnect } from './ado-status.js';
import { focusNow, heldNow, holdCount } from './focus-hours.js';
import { PAIR_KEY } from '../shared/pair.js';
import { ADO_SYNC_MAX, ADO_SYNC_MIN, COLORS, VALUE } from './constants.js';
import { flushText } from './drawer.js';
import { hideTip, placeTip, tipFor } from './events.js';
import { closeMenu, closeModal, popMenu, showModal, toast } from './overlays.js';
import { setScope, setView } from './render.js';
import { PR_GONES, cleanAdo, cleanPending, cleanPr, cleanSlots, commit, prGroup, isWaiting, listById, normalizeRanks, saveUi, state, topLists, ui } from './state.js';
import { $, esc, fmtDay, fmtLong, fmtMD, isDate, plural, todayStr, uid } from './util.js';
import { embedded, ready } from './ws.js';
import { assign } from './directory.js';
import { followDate } from './delegate.js';
import { PR_HOLD_MAX, PR_HOLD_MIN, commitOf, holdsNew } from './pr-ai-model.js';
import { prAiActive, prAiAfterSync, prAiOnSync } from './pr-ai.js';
import { slateFor, slateLabel } from './slate-link.js';
import { dp, planPr } from './dayplan.js';
/* Prioritizer: Azure DevOps sync, through Workshop's ADO connector. */
/* ---------- Azure DevOps ----------
   Where the data comes from: Workshop's ADO connector, reached through the SDK (ws.connectors) when this page
   uses Workshop on this computer: inside Workshop, or on Docket's own site once paired. Nothing else talks to
   ADO. When the connector can't be reached, the ADO button and its Settings say what to do (js/ado-status.js).
   How often to sync, whether new work items wait for you, and PR tier values are Prioritizer's own data, in
   state.ado. */
const ADO_MIN_GAP = 2 * 60 * 1000;
const ADO_GONE = {closed: 'Closed in ADO', removed: 'Removed in ADO', reassigned: 'Reassigned in ADO', missing: 'Not found in ADO', filtered: 'No longer matches ADO filter'};
const ADO_VALUE = {1: 4, 2: 3, 3: 2, 4: 1};   // ADO priority 1 (highest) to 4, as a starting value
// Labels and tips per PR tier. The starting value and urgent flag for each are in state.ado.prTiers.
// Groups: Blocking (blocking) and Pending (asked, pool). PRs that don't need you never get here: Workshop's ADO
// connector leaves them out (Settings, Pull requests), and a known one comes back gone as "notneeded".
const PR_TIER = {
  blocking: {label: 'Blocking', tip: "You're a required reviewer, so it can't merge without you"},
  asked: {label: 'Pending', tip: 'You were added by name as an optional reviewer'},
  pool: {label: 'Pending, team', tip: 'Your team was added, so any teammate can review it'}
};
const PR_GROUP = {blocking: 'Blocking', pending: 'Pending'};
const tierOf = k => Object.assign({}, PR_TIER[k] || PR_TIER.pool, state.ado.prTiers[k] || state.ado.prTiers.pool);
const PR_GONE = {reviewed: 'You voted', covered: 'A teammate reviewed it', notneeded: "Doesn't need you", merged: 'Completed in ADO', abandoned: 'Abandoned in ADO',
  unassigned: 'No longer a reviewer', draft: 'Back to draft', own: 'Your own PR', missing: 'Not found in ADO'};
const prTip = p => `PR ${p.id} in ${p.repo}${p.author ? ' by ' + p.author : ''}${p.via.length && p.tier === 'pool' ? ', via ' + p.via.join(', ') : ''}${p.lastBlocker ? '. Everyone else required has approved' : ''}`;
const adoShort = type => ({'User Story': 'Story', 'Product Backlog Item': 'PBI'})[type] || type || 'ADO';
// Per-device ADO state. Called by main.js once every module has loaded (modules import each other in a cycle).
function adoInit(){ ui.ado = Object.assign({on: false, offByUser: false, last: 0, error: '', noteErr: false}, ui.ado || {}); delete ui.ado.port;
  if (/ADO helper|Helper answered/.test(ui.ado.error)) ui.ado.error = '';   // left by the retired helper
}
let adoBusy = false, adoTimer = null;

function adoList(){
  let L = state.ado.listId && listById(state.ado.listId);
  if (!L) L = topLists().find(l => l.name.toLowerCase() === 'ado');
  if (!L){ L = {id: uid(), name: 'ADO', parentId: null}; state.lists.push(L); }
  state.ado.listId = L.id;
  return L;
}
function prList(){
  const parent = adoList();
  let L = state.ado.prListId && listById(state.ado.prListId);
  if (!L) L = state.lists.find(l => l.parentId === parent.id && l.name.toLowerCase() === 'pull requests');
  if (!L){ L = {id: uid(), name: 'Pull requests', parentId: parent.id}; state.lists.push(L); }
  state.ado.prListId = L.id;
  return L;
}
function adoAddItem(it, rank){
  const link = {id: it.id, type: it.type, state: it.state, url: it.url, project: it.project, due: isDate(it.due) ? it.due : undefined};
  const nt = {id: uid(), title: it.title || `ADO #${it.id}`, notes: '', color: COLORS[state.colorIdx++ % COLORS.length], rank,
    value: ADO_VALUE[it.priority] || null, effort: null, due: link.due || null, urgentFlag: false, listId: adoList().id,
    done: false, doneAt: null, wontDo: false, createdAt: todayStr(), ageFrom: todayStr(), waiting: false, nudgeOn: null, focusOn: null, who: []};
  nt.ado = cleanAdo(link);
  state.tasks.push(nt);
  return nt;
}
// Add or skip picked pending items. Skipped ones go on the skip list so they don't come back.
function adoPick(addIds, skipIds){
  const add = new Set(addIds), skip = new Set(skipIds);
  let maxRank = state.tasks.reduce((m, t) => Math.max(m, t.rank), 0), added = 0;
  for (const p of state.ado.pending){
    if (add.has(p.id) && !state.tasks.some(t => t.ado && t.ado.id === p.id)){ adoAddItem(p, ++maxRank); added++; }
    else if (skip.has(p.id)) state.ado.skip.push(p.id);
  }
  state.ado.pending = state.ado.pending.filter(p => !add.has(p.id) && !skip.has(p.id));
  return added;
}
// Already on Slate's board (slate-link.js): say where, so it can be skipped knowingly. Inside Workshop only.
const inSlate = id => { const sl = embedded ? slateFor(id) : null; return sl ? ` · <span class="chip">${esc(slateLabel(sl))}</span>` : ''; };
function adoReview(){
  const P = state.ado.pending;
  if (!P.length){ toast('No new ADO work items to review.'); return; }
  setAdo();
  const item = p => `<li><label><input type="checkbox" value="${p.id}" checked><span class="ptx">${esc(p.title || 'ADO #' + p.id)}
      <span class="pmeta">${esc(adoShort(p.type))} ${p.id} · ${esc(p.state)}${p.priority ? ' · P' + p.priority : ''}${p.due ? ' · due ' + fmtDay(p.due) : ''}${p.project ? ' · ' + esc(p.project) : ''}${inSlate(p.id)}</span></span></label>
      ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">Open</a>` : ''}</li>`;
  const sorted = [...P].sort((a, b) => (a.priority || 9) - (b.priority || 9) || (a.due || '9').localeCompare(b.due || '9') || b.id - a.id);
  showModal(`<div class="sheet" role="dialog" aria-modal="true" aria-label="New ADO work items"><h3>New ADO work items${globalThis.WorkshopTheme?.hints ? globalThis.WorkshopTheme?.hints.html('docket.ado-new', "Assigned to you, not on your board yet. Skipped items won't come back.", 'About new ADO work items') : ''}</h3>
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
        const on = boxes().filter(b => b.checked).map(b => +b.value), off = boxes().filter(b => !b.checked).map(b => +b.value);
        // Add: add checked, leave unchecked for later. Skip unchecked: add checked too, and skip the rest for good.
        const added = adoPick(on, isSkip ? off : []);
        normalizeRanks(state); commit(); setAdo(); closeModal();
        const bits = [added && `Added ${plural(added, 'task')}`, isSkip && off.length && `skipped ${off.length}`].filter(Boolean);
        if (bits.length) toast(bits.join(', ').replace(/^s/, 'S'), added ? 'Show' : null, () => setScope(state.ado.listId));
      });
    });
}
function adoNote(t, line){ t.notes = (t.notes ? t.notes + '\n' : '') + line; }

// Pure merge of a connector sync response into state; returns counts. Exposed on the test hook.
function adoApply(res, opts = {}){
  const n = {added: 0, updated: 0, closed: 0, removed: 0, reopened: 0, pending: 0, pendingChanged: false, prAdded: 0, prBlocking: 0, prBack: 0, prDone: 0, prHeld: 0, heldChanged: false};
  const byId = new Map(state.tasks.filter(t => t.ado).map(t => [t.ado.id, t]));
  const skip = new Set(state.ado.skip);
  let maxRank = state.tasks.reduce((m, t) => Math.max(m, t.rank), 0);
  // res.items is every open item assigned to you, so the pending list is rebuilt each sync:
  // anything closed or reassigned before you picked it just drops off.
  const oldPending = new Map(state.ado.pending.map(p => [p.id, p])), pending = [];
  for (const it of res.items || []){
    const t = byId.get(it.id);
    const link = {id: it.id, type: it.type, state: it.state, url: it.url, project: it.project, due: isDate(it.due) ? it.due : undefined};
    if (!t){
      if (skip.has(it.id)) continue;
      if (state.ado.choose){
        const old = oldPending.get(it.id);
        const p = cleanPending({...it, seen: old ? old.seen : todayStr()});
        if (p){ pending.push(p); if (!old) n.pending++; }
        continue;
      }
      adoAddItem(it, ++maxRank); n.added++;
      continue;
    }
    const before = JSON.stringify([t.title, t.ado, t.due, t.done]);
    if (t.done && t.ado.gone){                       // was closed or reassigned by a sync, now open and yours again
      t.done = false; t.wontDo = false; t.doneAt = null;
      adoNote(t, `Back in ADO as ${it.state || 'open'} on ${fmtLong(todayStr())}.`); n.reopened++;
    }
    if (it.title) t.title = it.title;
    if (t.due === (t.ado.due || null) && link.due) t.due = link.due;   // follow ADO's date unless you changed it here
    t.ado = cleanAdo(link);
    if (before !== JSON.stringify([t.title, t.ado, t.due, t.done])) n.updated++;
  }
  if (Array.isArray(res.items)){ if (pending.length !== oldPending.size || pending.some(p => !oldPending.has(p.id))) n.pendingChanged = true; state.ado.pending = pending; }
  if (res.prs) prApply(res.prs, n, opts);
  for (const g of res.gone || []){
    const t = byId.get(g.id); if (!t || t.ado.pasted) continue;
    if (g.state) t.ado.state = g.state;
    if (t.done){ t.ado.gone = t.ado.gone || g.reason; continue; }
    t.ado.gone = g.reason;
    t.done = true; t.doneAt = todayStr();
    if (g.reason === 'closed'){ n.closed++; }
    else {
      t.wontDo = true; n.removed++;
      adoNote(t, g.reason === 'reassigned' ? `Reassigned in ADO${g.assignedTo ? ' to ' + g.assignedTo : ''} on ${fmtLong(todayStr())}.`
        : `${ADO_GONE[g.reason] || 'Dropped from ADO'} on ${fmtLong(todayStr())}.`);
    }
  }
  return n;
}

// PRs: tier sets a starting value and urgent flag; later tier changes follow only if you haven't changed them here.
// With Tandem's first-pass reviews on (opts.ai, js/pr-ai.js), asked and team-only PRs wait in state.ado.prHeld
// until their review ends, and blocking ones land at once marked as being reviewed.
function prNewTask(it, link, rank, ai){
  const tier = tierOf(link.tier);
  const nt = {id: uid(), title: `Review: ${it.title || 'PR ' + link.id}`, notes: '', color: COLORS[state.colorIdx++ % COLORS.length], rank,
    value: tier.value, effort: 'S', due: null, urgentFlag: tier.urgent, listId: prList().id,
    done: false, doneAt: null, wontDo: false, createdAt: todayStr(), ageFrom: isDate(it.created) ? it.created : todayStr(),
    waiting: link.waiting, nudgeOn: link.waiting ? followDate() : null, focusOn: null, who: []};
  if (link.waiting && link.author) assign(nt, [link.author], {ado: true});
  if (ai) link.ai = ai;
  nt.pr = link;
  state.tasks.push(nt);
  prPlan(nt);
  return nt;
}
/* Into the Day plan block for its group (state.ado.prSlots); from: the old group, when it changed. A PR waiting
   for its author is not planned. Lands on Today when the block is today. */
function prPlan(t, from){
  if (t.done || t.waiting || !t.pr) return null;
  const slots = state.ado.prSlots, at = planPr(t.id, slots[prGroup(t.pr)], from ? slots[from] : '');
  if (at && at.date === todayStr()) t.focusOn = at.date;
  return at;
}
function prApply(prs, n, opts = {}){
  const aiOn = !!opts.ai, now = new Date();
  // Matched on prMatchKey, so a PR synced by the retired helper under a differently written collection URL is
  // the same task (its key then takes the connector's form).
  const byKey = new Map(state.tasks.filter(t => t.pr).map(t => [prMatchKey(t.pr.key), t]));
  const skip = new Set(state.ado.skipPr.map(prMatchKey));
  const heldBy = new Map(state.ado.prHeld.map(h => [prMatchKey(h.key), h])), held = [];
  const on = fmtLong(todayStr());
  let maxRank = state.tasks.reduce((m, t) => Math.max(m, t.rank), 0);
  for (const it of prs.items || []){
    const link = cleanPr({...it, commit: commitOf(it) || undefined}); if (!link) continue;
    const tier = tierOf(link.tier), title = `Review: ${it.title || 'PR ' + link.id}`;
    const t = byKey.get(prMatchKey(link.key));
    if (!t){
      if (skip.has(prMatchKey(link.key))) continue;
      const h = heldBy.get(prMatchKey(link.key));
      if (holdsNew(aiOn, link)){                     // waits for Tandem's review (js/pr-ai.js lets it go)
        held.push({key: link.key, since: h ? h.since : now.toISOString(), item: {...it, key: link.key}});
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
      adoNote(t, `Back for your review on ${on}.`); n.reopened++;
    }
    if (t.pr.tier !== link.tier){
      const old = tierOf(t.pr.tier);
      if (t.value === old.value) t.value = tier.value;
      if (t.urgentFlag === old.urgent) t.urgentFlag = tier.urgent;
      adoNote(t, `Now ${tier.label.toLowerCase()} (${tier.tip.toLowerCase()}) as of ${on}.`);
      if (link.tier === 'blocking' && !t.done) n.prBlocking++;
    }
    if (link.waiting && !t.pr.waiting){
      t.waiting = true;
      if (!t.nudgeOn) t.nudgeOn = followDate();
      if (link.author) assign(t, [link.author], {add: true, ado: true});
      adoNote(t, `You voted Waiting for author on ${on}.`);
    } else if (!link.waiting && t.pr.waiting && !t.done){
      t.waiting = false; t.nudgeOn = null; t.cameBack = todayStr();
      adoNote(t, `Back to you for review on ${on}.`); n.prBack++;
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
  if (held.length !== state.ado.prHeld.length || held.some((h, i) => h.key !== state.ado.prHeld[i].key)) n.heldChanged = true;
  state.ado.prHeld = held;
  for (const g of prs.gone || []){
    const t = byKey.get(prMatchKey(g.key)); if (!t) continue;
    t.pr.gone = PR_GONES.includes(g.reason) ? g.reason : 'missing';
    if (t.done) continue;
    t.done = true; t.doneAt = todayStr(); t.waiting = false; t.nudgeOn = null; n.prDone++;
    if (['notneeded', 'unassigned', 'draft', 'own', 'missing'].includes(t.pr.gone)) t.wontDo = true;
    if (t.pr.ai && t.pr.ai.state === 'pending') delete t.pr.ai;
    adoNote(t, `${PR_GONE[t.pr.gone]} on ${on}.`);
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

/* Whether Workshop's ADO connector is reachable and turned on. Decided at start and again when the connector or
   Workshop's connection changes. */
let adoReady = false;
// What to tell the person ({error, warn}): why the connector can't be reached (reachNote), or the connector's
// own words (connectorNote, for example a missing PAT). Refreshed on every detect. Not saved.
let adoNoteNow = {error: '', warn: ''};
const pairSaved = () => { try { return !!localStorage.getItem(PAIR_KEY); } catch(e){ return false; } };
const reachNow = ws => reachNote(ws, {pairSaved: pairSaved(), embedded});
// A connector call that failed because Workshop itself did not answer.
const STOPPED = reachNote({backend: 'agent', online: false});
const adoUnreachable = e => !!e && (e.code === 'unavailable' || e instanceof TypeError);
async function adoDetect(){
  const ws = await ready;
  adoReady = false;
  const reach = reachNow(ws);
  if (reach) adoNoteNow = {error: reach, warn: ''};
  else {
    try {
      const c = (await ws.connectors.list()).find(x => x.id === 'ado');
      adoNoteNow = connectorNote(c);
      adoReady = !!(c && c.enabled);
      // Set up in Workshop Settings already: no second Connect here. Turning it off in Docket sticks.
      if (shouldAutoConnect(c, ui.ado)){
        ui.ado.on = true; ui.ado.error = ''; ui.ado.last = 0; saveUi(); adoSchedule();
        toast('Azure DevOps is connected through Workshop. Syncing your work items and reviews now.');
      }
    } catch(e){ adoNoteNow = {error: adoUnreachable(e) ? STOPPED : e.message, warn: ''}; }
  }
  // Fixed since (Workshop started, connector turned on, new PAT): drop the old message. A failed sync's own error stays.
  if (ui.ado.noteErr && !adoNoteNow.error && !adoBusy){ ui.ado.error = ''; ui.ado.noteErr = false; saveUi(); }
  setAdo();
  return adoReady;
}
// One ADO request through the connector: name is sync, dataset or health.
async function adoCall(name, args){
  const ws = await ready;
  const reach = reachNow(ws);
  if (reach) throw new Error(reach);
  if (name === 'health'){
    const note = connectorNote((await ws.connectors.list()).find(x => x.id === 'ado'));
    if (note.error) throw new Error(note.error);
    return {collections: [], reports: true};
  }
  return ws.connectors.call('ado', name, args);
}

async function adoSync(manual){
  if (adoBusy || !ui.ado.on || isWaiting()) return;
  // Already known why a sync would fail (Workshop not reachable, connector off, no PAT, rejected PAT): show that, skip the request.
  if (adoNoteNow.error){ ui.ado.error = adoNoteNow.error; ui.ado.noteErr = true; saveUi(); setAdo(); if (manual) toast(ui.ado.error); return; }
  if (!manual && Date.now() - ui.ado.last < ADO_MIN_GAP) return;
  adoBusy = true; setAdo();
  try {
    const known = state.tasks.filter(t => t.ado && !t.ado.pasted && !t.done).map(t => t.ado.id);
    const knownPrs = state.tasks.filter(t => t.pr && !t.done).map(t => t.pr.key);
    const res = await adoCall('sync', {known, knownPrs});
    const ai = res.prs ? await prAiActive() : false;   // Tandem reviews new PRs first (js/pr-ai.js)
    flushText();
    const n = adoApply(res, {ai});
    ui.ado.last = Date.now(); ui.ado.error = res.prError ? `Pull requests: ${res.prError}` : ''; ui.ado.noteErr = false; saveUi();
    const changed = n.added + n.updated + n.closed + n.removed + n.reopened + n.prDone + (n.pendingChanged || n.heldChanged ? 1 : 0);
    if (changed){ normalizeRanks(state); commit(); }
    if (ai) prAiAfterSync(res);
    const bits = [n.prBlocking && `${n.prBlocking} PR${n.prBlocking > 1 ? 's' : ''} blocked on you`, n.prHeld && `${plural(n.prHeld, 'PR')} with Tandem for a first pass`, n.prBack && `${n.prBack} PR${n.prBack > 1 ? 's' : ''} back to you`,
      n.added && `${n.added} new`, n.closed && `${n.closed} closed`, n.removed && `${n.removed} reassigned or removed`, n.reopened && `${n.reopened} reopened`].filter(Boolean);
    // Focus hours (Workshop docs/focus.md): a sync on its own (not Sync now) during focus or lunch shows no toast; the
    // items still land, and are counted in Docket's held card. PRs blocked on you still show during focus.
    if (!manual && heldNow() && (n.pending || bits.length)){
      holdCount(n.pending + Math.max(0, n.added - n.prAdded), 'ado');
      holdCount(Math.max(0, n.prAdded - n.prBlocking), 'pr');
      if (n.prBlocking && focusNow().state === 'focus') toast(`ADO: ${n.prBlocking} PR${n.prBlocking > 1 ? 's' : ''} blocked on you`, 'Show', () => setScope(state.ado.prListId));
      else if (n.prBlocking) holdCount(n.prBlocking, 'pr');
    }
    else if (n.pending) toast(`ADO: ${plural(n.pending, 'new work item')} to review${bits.length ? ', ' + bits.join(', ') : ''}`, 'Review', adoReview);
    else if (bits.length) toast(`ADO: ${bits.join(', ')}`, n.added ? 'Show' : null, () => setScope(n.prAdded && n.prAdded === n.added ? state.ado.prListId : state.ado.listId));
    else if (manual) toast(res.prError ? `Work items synced, but pull requests failed: ${res.prError}`
      : `ADO is up to date. ${plural((res.items || []).length, 'open item')}${res.prs ? `, ${plural(res.prs.items.length, 'PR')} to review` : ''}.`);
  } catch(e){
    ui.ado.error = adoUnreachable(e) ? STOPPED : e.message; ui.ado.noteErr = adoUnreachable(e); saveUi();
    if (manual) toast(ui.ado.error);
  } finally { adoBusy = false; setAdo(); }
}
function adoSchedule(){
  clearInterval(adoTimer); adoTimer = null;
  if (ui.ado.on){ adoTimer = setInterval(() => { if (!document.hidden) adoSync(false); }, state.ado.syncMinutes * 60 * 1000); }
}
function setAdo(){
  const b = $('#adoBtn'); if (!b) return;
  const np = ui.ado.on ? state.ado.pending.length : 0;
  if (np) b.dataset.pending = np > 99 ? '99+' : np; else delete b.dataset.pending;
  const ago = ui.ado.last ? Math.round((Date.now() - ui.ado.last) / 60000) : null;
  const warn = ui.ado.on && !ui.ado.error ? adoNoteNow.warn : '';
  b.dataset.ado = adoBusy ? 'busy' : !ui.ado.on ? 'off' : ui.ado.error ? 'error' : warn ? 'warn' : 'on';
  b.dataset.tip = !ui.ado.on ? 'Connect Azure DevOps' : adoBusy ? 'Syncing with ADO' : ui.ado.error ? `ADO: ${ui.ado.error}`
    : warn ? `ADO: ${warn}` : ago == null ? 'ADO sync on' : `ADO synced ${ago < 1 ? 'just now' : plural(ago, 'minute') + ' ago'}`;
  if (tipFor === b) placeTip(b);
}
// Block kinds in the day plan's templates and the coming days, for the PR slot suggestions.
function dayKinds(){
  const out = new Set();
  for (const t of dp.templates || []) for (const sec of t.sections || []) if (sec.kind) out.add(sec.kind);
  for (const r of Object.values(dp.days || {})) for (const sec of (r && r.sections) || []) if (sec.kind) out.add(sec.kind);
  return [...out].sort();
}
async function adoSetup(){
  await adoDetect();
  const valueOpts = cur => [4, 3, 2, 1].map(v => `<option value="${v}"${v === cur ? ' selected' : ''}>${VALUE[v]}</option>`).join('');
  const tiers = Object.entries(PR_TIER).map(([k, d]) => { const t = state.ado.prTiers[k]; return `<tr><th scope="row" title="${esc(d.tip)}">${d.label}</th>
      <td><select data-tier-value="${k}" aria-label="${d.label}: starting value">${valueOpts(t.value)}</select></td>
      <td><label class="chk"><input type="checkbox" data-tier-urgent="${k}"${t.urgent ? ' checked' : ''}> Urgent</label></td></tr>`; }).join('');
  showModal(`<div class="sheet" role="dialog" aria-modal="true" aria-label="Connect Azure DevOps"><h3>Connect Azure DevOps</h3>
    <p>Work items assigned to you and PRs waiting on your review become tasks in an <b>ADO</b> list. Sync runs through Workshop's ADO connector on this computer. Its connection and PAT are in Workshop <b>Settings</b>; your PAT never reaches this page.</p>
    <div class="opts" role="radiogroup" aria-label="New work items"><span class="lbl">New work items assigned to you</span>
      <label><input type="radio" name="adoChoose" value="1"${state.ado.choose ? ' checked' : ''}> Let me choose which to add</label>
      <label><input type="radio" name="adoChoose" value="0"${state.ado.choose ? '' : ' checked'}> Add them automatically</label></div>
    <div class="fld"><label for="adoEvery">Sync every</label><input type="number" id="adoEvery" class="mono" min="${ADO_SYNC_MIN}" max="${ADO_SYNC_MAX}" value="${state.ado.syncMinutes}"> <span class="hint">minutes</span></div>
    <table class="tiers"><caption>New pull request reviews start at</caption><tbody>${tiers}</tbody></table>
    <table class="tiers"><caption>Plan new PR reviews into the Day plan block of kind</caption><tbody>
      ${Object.entries(PR_GROUP).map(([k, l]) => `<tr><th scope="row">${l}</th><td><input type="text" data-slot="${k}" class="mono" maxlength="40" list="adoKinds" value="${esc(state.ado.prSlots[k])}" placeholder="not planned" autocomplete="off" aria-label="${l}: Day plan block kind"></td></tr>`).join('')}
    </tbody></table><datalist id="adoKinds">${dayKinds().map(k => `<option value="${esc(k)}">`).join('')}</datalist>
    <p class="hint">The next block of that kind that has not ended, today or a coming work day. Empty: not planned. PRs that don't need you are left out in Workshop <b>Settings</b>, Pull requests.</p>
    ${prAiOnSync() == null ? '' : `<div class="fld"><label for="adoHold">Hold asked and team PRs for Tandem's review up to</label><input type="number" id="adoHold" class="mono" min="${PR_HOLD_MIN}" max="${PR_HOLD_MAX}" value="${state.ado.prHoldMinutes}"> <span class="hint">minutes</span></div>
    <p class="hint">${prAiOnSync() ? 'Tandem reviews new PRs first: blocking ones show right away, the rest once reviewed. Drafts only, nothing is posted. Turn it off in Workshop <b>Settings</b>, opencode, PR reviews.' : 'Tandem is not reviewing new PRs as they are found. Turn it on in Workshop <b>Settings</b>, opencode, PR reviews.'}</p>`}
    <p class="hint" id="adoMsg" aria-live="polite" style="margin-top:.6rem">${esc(adoNoteNow.error || (ui.ado.on && ui.ado.error) || adoNoteNow.warn)}</p>
    <footer>${ui.ado.on ? '<button class="btn text-danger" data-ado-off>Disconnect</button>' : ''}<span class="grow"></span><button class="btn" data-close>Cancel</button><button class="btn primary" data-ado-go>${ui.ado.on ? 'Save' : 'Connect'}</button></footer></div>`,
    sh => sh.addEventListener('click', async e => {
      if (e.target.closest('[data-ado-off]')){ ui.ado.on = false; ui.ado.offByUser = true; ui.ado.error = ''; saveUi(); adoSchedule(); setAdo(); closeModal(); toast('ADO disconnected. Synced tasks stay on your board.'); return; }
      const go = e.target.closest('[data-ado-go]'); if (!go) return;
      const msg = sh.querySelector('#adoMsg');
      const every = Math.round(+sh.querySelector('#adoEvery').value);
      if (!(every >= ADO_SYNC_MIN && every <= ADO_SYNC_MAX)){ msg.textContent = `Sync every ${ADO_SYNC_MIN} to ${ADO_SYNC_MAX} minutes.`; return; }
      const prTiers = {};
      for (const k of Object.keys(PR_TIER)) prTiers[k] = {value: +sh.querySelector(`[data-tier-value=${k}]`).value, urgent: sh.querySelector(`[data-tier-urgent=${k}]`).checked};
      const prSlots = cleanSlots(Object.fromEntries([...sh.querySelectorAll('[data-slot]')].map(el => [el.dataset.slot, el.value])));
      const choose = sh.querySelector('[name=adoChoose]:checked').value === '1';
      const holdEl = sh.querySelector('#adoHold'), hold = holdEl ? Math.round(+holdEl.value) : state.ado.prHoldMinutes;
      if (!(hold >= PR_HOLD_MIN && hold <= PR_HOLD_MAX)){ msg.textContent = `Hold PRs ${PR_HOLD_MIN} to ${PR_HOLD_MAX} minutes.`; return; }
      if (choose !== state.ado.choose || every !== state.ado.syncMinutes || hold !== state.ado.prHoldMinutes || JSON.stringify(prTiers) !== JSON.stringify(state.ado.prTiers) || JSON.stringify(prSlots) !== JSON.stringify(state.ado.prSlots)){
        state.ado.syncMinutes = every; state.ado.prTiers = prTiers; state.ado.prSlots = prSlots; state.ado.prHoldMinutes = hold;
        if (choose !== state.ado.choose){ state.ado.choose = choose; if (!choose){ adoPick(state.ado.pending.map(p => p.id), []); normalizeRanks(state); } }
        commit();
      }
      go.disabled = true; msg.textContent = 'Checking the ADO connector...';
      try {
        await adoCall('health');
        ui.ado.on = true; ui.ado.offByUser = false; ui.ado.error = ''; ui.ado.last = 0; saveUi();
        closeModal(); adoSchedule(); adoSync(true);
      } catch(err){
        msg.textContent = adoUnreachable(err) ? STOPPED : err.message;
        go.disabled = false;
      }
    }));
}
function onAdoClick(btn){
  hideTip();
  if (!ui.ado.on) return adoSetup();
  const ago = ui.ado.last ? fmtMD(new Date(ui.ado.last)) + ' ' + new Date(ui.ado.last).toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'}) : 'never';
  popMenu(`<div class="who"><b>Azure DevOps</b>${ui.ado.error ? esc(ui.ado.error) : `Last sync ${esc(ago)}`}</div>
    ${!ui.ado.error && adoNoteNow.warn ? `<div class="mnote warn">${esc(adoNoteNow.warn)}</div>` : ''}
    ${state.ado.pending.length ? `<button data-a="review">Review ${plural(state.ado.pending.length, 'new item')}</button>` : ''}
    <button data-a="now">Sync now</button><button data-a="show">Show ADO list</button>${adoReady ? '<button data-a="reports">Team reports in Runway</button>' : ''}<button data-a="setup">Settings</button>`, btn)
    .addEventListener('click', e => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      closeMenu();
      if (b.dataset.a === 'review') adoReview();
      if (b.dataset.a === 'now') adoSync(true);
      if (b.dataset.a === 'show'){ adoList(); setScope(state.ado.listId); }
      if (b.dataset.a === 'setup') adoSetup();
      if (b.dataset.a === 'reports') ready.then(w => { if (w) w.open({app: 'runway', path: 'reports'}).catch(() => {}); });
    });
}

export { ADO_GONE, PR_GONE, PR_GROUP, PR_TIER, prPlan, adoApply, prRelease, tierOf, adoCall, adoDetect, adoInit, adoPick, adoReview, adoSchedule, adoSetup, adoShort, adoSync, onAdoClick, prTip, setAdo };
