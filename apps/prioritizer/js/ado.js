import { ADO_SYNC_MAX, ADO_SYNC_MIN, COLORS, VALUE } from './constants.js';
import { flushText } from './drawer.js';
import { hideTip, placeTip, tipFor } from './events.js';
import { closeMenu, closeModal, popMenu, showModal, toast } from './overlays.js';
import { setScope, setView } from './render.js';
import { PR_GONES, canonPerson, cleanAdo, cleanPending, cleanPr, commit, listById, normalizeRanks, saveUi, state, topLists, ui } from './state.js';
import { $, esc, fmtDay, fmtLong, fmtMD, isDate, plural, todayStr, uid } from './util.js';
import { ready } from './ws.js';
/* Prioritizer: Azure DevOps sync, through Workshop's ADO connector or the local helper (ado-helper/ado_helper.py). */
/* ---------- Azure DevOps ----------
   Where the data comes from: the ADO connector, when this page runs on Workshop's agent and the connector is
   turned on (Settings); otherwise the ado_helper.py helper on this computer. Both take the same requests and
   give the same answers (the connector was ported from the helper). How often to sync, whether new work
   items wait for you, and PR tier values are Prioritizer's own data, in state.ado. */
const ADO_DEFAULT_PORT = 4791, ADO_MIN_GAP = 2 * 60 * 1000;
const ADO_GONE = {closed: 'Closed in ADO', removed: 'Removed in ADO', reassigned: 'Reassigned in ADO', missing: 'Not found in ADO', filtered: 'No longer matches ADO filter'};
const ADO_VALUE = {1: 4, 2: 3, 3: 2, 4: 1};   // ADO priority 1 (highest) to 4, as a starting value
// Labels and tips per PR tier. The starting value and urgent flag for each are in state.ado.prTiers.
const PR_TIER = {
  blocking: {label: 'Blocking', tip: "You're a required reviewer, so it can't merge without you"},
  asked: {label: 'Asked', tip: 'You were added by name as an optional reviewer'},
  pool: {label: 'Team', tip: 'Your team was added, so any teammate can review it'}
};
const tierOf = k => Object.assign({}, PR_TIER[k] || PR_TIER.pool, state.ado.prTiers[k] || state.ado.prTiers.pool);
const PR_GONE = {reviewed: 'You voted', covered: 'A teammate reviewed it', merged: 'Completed in ADO', abandoned: 'Abandoned in ADO',
  unassigned: 'No longer a reviewer', draft: 'Back to draft', own: 'Your own PR', missing: 'Not found in ADO'};
const prTip = p => `PR ${p.id} in ${p.repo}${p.author ? ' by ' + p.author : ''}${p.via.length && p.tier === 'pool' ? ', via ' + p.via.join(', ') : ''}${p.lastBlocker ? '. Everyone else required has approved' : ''}`;
const adoShort = type => ({'User Story': 'Story', 'Product Backlog Item': 'PBI'})[type] || type || 'ADO';
// Per-device ADO state. Called by main.js once every module has loaded (modules import each other in a cycle).
function adoInit(){ ui.ado = Object.assign({on: false, port: ADO_DEFAULT_PORT, last: 0, error: ''}, ui.ado || {}); }
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
    done: false, doneAt: null, wontDo: false, createdAt: todayStr(), ageFrom: todayStr(), waiting: false, nudgeOn: null, focusOn: null, people: []};
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
function adoReview(){
  const P = state.ado.pending;
  if (!P.length){ toast('No new ADO work items to review.'); return; }
  setAdo();
  const item = p => `<li><label><input type="checkbox" value="${p.id}" checked><span class="ptx">${esc(p.title || 'ADO #' + p.id)}
      <span class="pmeta">${esc(adoShort(p.type))} ${p.id} · ${esc(p.state)}${p.priority ? ' · P' + p.priority : ''}${p.due ? ' · due ' + fmtDay(p.due) : ''}${p.project ? ' · ' + esc(p.project) : ''}</span></span></label>
      ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">Open</a>` : ''}</li>`;
  const sorted = [...P].sort((a, b) => (a.priority || 9) - (b.priority || 9) || (a.due || '9').localeCompare(b.due || '9') || b.id - a.id);
  showModal(`<div class="sheet" role="dialog" aria-modal="true" aria-label="New ADO work items"><h3>New ADO work items</h3>
    <p class="hint">Assigned to you and not on your board yet. Checked items become tasks. Skipped items won't be offered again.</p>
    <div class="drow" style="margin-top:.5rem;gap:.8rem"><button class="lnk" data-all="1">Check all</button><button class="lnk" data-all="0">Uncheck all</button></div>
    <ul class="pick">${sorted.map(item).join('')}</ul>
    <footer><button class="btn" data-skip>Skip unchecked</button><span class="grow"></span><button class="btn" data-close>Later</button><button class="btn primary" data-add>Add checked</button></footer></div>`,
    sh => {
      const boxes = () => [...sh.querySelectorAll('.pick input')];
      const sync = () => { const k = boxes().filter(b => b.checked).length; const a = sh.querySelector('[data-add]'); a.textContent = k ? `Add ${k}` : 'Add checked'; a.disabled = !k; };
      sh.addEventListener('change', sync); sync();
      sh.addEventListener('click', e => {
        const all = e.target.closest('[data-all]'); if (all){ boxes().forEach(b => b.checked = all.dataset.all === '1'); sync(); return; }
        const isAdd = e.target.closest('[data-add]'), isSkip = e.target.closest('[data-skip]');
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

// Pure merge of a helper response into state; returns counts. Exposed on the test hook.
function adoApply(res){
  const n = {added: 0, updated: 0, closed: 0, removed: 0, reopened: 0, pending: 0, pendingChanged: false, prAdded: 0, prBlocking: 0, prBack: 0, prDone: 0};
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
  if (res.prs) prApply(res.prs, n);
  for (const g of res.gone || []){
    const t = byId.get(g.id); if (!t) continue;
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
function prApply(prs, n){
  const byKey = new Map(state.tasks.filter(t => t.pr).map(t => [t.pr.key, t]));
  const skip = new Set(state.ado.skipPr);
  const on = fmtLong(todayStr());
  let maxRank = state.tasks.reduce((m, t) => Math.max(m, t.rank), 0);
  for (const it of prs.items || []){
    const link = cleanPr(it); if (!link) continue;
    const tier = tierOf(link.tier), title = `Review: ${it.title || 'PR ' + link.id}`;
    const t = byKey.get(link.key);
    if (!t){
      if (skip.has(link.key)) continue;
      const nt = {id: uid(), title, notes: '', color: COLORS[state.colorIdx++ % COLORS.length], rank: ++maxRank,
        value: tier.value, effort: 'S', due: null, urgentFlag: tier.urgent, listId: prList().id,
        done: false, doneAt: null, wontDo: false, createdAt: todayStr(), ageFrom: isDate(it.created) ? it.created : todayStr(),
        waiting: link.waiting, nudgeOn: null, focusOn: null, people: link.waiting && link.author ? [canonPerson(link.author)] : []};
      nt.pr = link;
      state.tasks.push(nt); n.added++; n.prAdded++; if (link.tier === 'blocking' && !link.waiting) n.prBlocking++;
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
      if (link.author) t.people = [...new Set([...t.people, canonPerson(link.author)])];
      adoNote(t, `You voted Waiting for author on ${on}.`);
    } else if (!link.waiting && t.pr.waiting && !t.done){
      t.waiting = false; t.nudgeOn = null;
      adoNote(t, `Back to you for review on ${on}.`); n.prBack++;
    }
    t.title = title;
    t.pr = link;
    if (before !== JSON.stringify([t.title, t.pr, t.value, t.urgentFlag, t.waiting, t.done])) n.updated++;
  }
  for (const g of prs.gone || []){
    const t = byKey.get(g.key); if (!t) continue;
    t.pr.gone = PR_GONES.includes(g.reason) ? g.reason : 'missing';
    if (t.done) continue;
    t.done = true; t.doneAt = todayStr(); t.waiting = false; t.nudgeOn = null; n.prDone++;
    if (['unassigned', 'draft', 'own', 'missing'].includes(t.pr.gone)) t.wontDo = true;
    adoNote(t, `${PR_GONE[t.pr.gone]} on ${on}.`);
  }
}

/* Where ADO data comes from: 'connector' or 'helper'. Decided at start and again when settings change. */
let adoVia = 'helper';
async function adoDetect(){
  const ws = await ready;
  adoVia = 'helper';
  if (ws && ws.backend === 'agent'){
    try { const c = (await ws.connectors.list()).find(x => x.id === 'ado'); if (c && c.enabled) adoVia = 'connector'; } catch(e){ /* keep the helper */ }
  }
  return adoVia;
}
// One ADO request: name is sync, dataset or health. Same answers from either source.
async function adoCall(name, args){
  if (adoVia === 'connector'){
    const ws = await ready;
    if (name === 'health'){
      const c = (await ws.connectors.list()).find(x => x.id === 'ado');
      if (!c || !c.enabled) throw new Error('The ADO connector is turned off. Turn it on in Settings.');
      if (c.status.state !== 'ready') throw new Error(c.status.message || `The ADO connector is ${c.status.state}.`);
      return {collections: [], reports: true};
    }
    return ws.connectors.call('ado', name, args);
  }
  return adoFetch('/' + name, name === 'health' ? undefined : args);
}
async function adoFetch(path, body){
  const r = await fetch(`http://127.0.0.1:${ui.ado.port}${path}`, {
    method: body ? 'POST' : 'GET', cache: 'no-store', targetAddressSpace: 'loopback',
    headers: body ? {'Content-Type': 'application/json'} : undefined, body: body ? JSON.stringify(body) : undefined
  });
  let data = null; try { data = await r.json(); } catch(e) {}
  if (!r.ok) throw new Error((data && data.error) || `Helper answered HTTP ${r.status}`);
  return data;
}
const adoUnreachable = e => e instanceof TypeError || /fetch/i.test(e.message);
const ADO_DOWN = "Can't reach the ADO helper. Is it running on this computer?";

async function adoSync(manual){
  if (adoBusy || !ui.ado.on) return;
  if (!manual && Date.now() - ui.ado.last < ADO_MIN_GAP) return;
  adoBusy = true; setAdo();
  try {
    const known = state.tasks.filter(t => t.ado && !t.done).map(t => t.ado.id);
    const knownPrs = state.tasks.filter(t => t.pr && !t.done).map(t => t.pr.key);
    const res = await adoCall('sync', {known, knownPrs});
    flushText();
    const n = adoApply(res);
    ui.ado.last = Date.now(); ui.ado.error = res.prError ? `Pull requests: ${res.prError}` : ''; saveUi();
    const changed = n.added + n.updated + n.closed + n.removed + n.reopened + n.prDone + (n.pendingChanged ? 1 : 0);
    if (changed){ normalizeRanks(state); commit(); }
    const bits = [n.prBlocking && `${n.prBlocking} PR${n.prBlocking > 1 ? 's' : ''} blocked on you`, n.prBack && `${n.prBack} PR${n.prBack > 1 ? 's' : ''} back to you`,
      n.added && `${n.added} new`, n.closed && `${n.closed} closed`, n.removed && `${n.removed} reassigned or removed`, n.reopened && `${n.reopened} reopened`].filter(Boolean);
    if (n.pending) toast(`ADO: ${plural(n.pending, 'new work item')} to review${bits.length ? ', ' + bits.join(', ') : ''}`, 'Review', adoReview);
    else if (bits.length) toast(`ADO: ${bits.join(', ')}`, n.added ? 'Show' : null, () => setScope(n.prAdded && n.prAdded === n.added ? state.ado.prListId : state.ado.listId));
    else if (manual) toast(res.prError ? `Work items synced, but pull requests failed: ${res.prError}`
      : `ADO is up to date. ${plural((res.items || []).length, 'open item')}${res.prs ? `, ${plural(res.prs.items.length, 'PR')} to review` : ''}.`);
  } catch(e){
    ui.ado.error = adoUnreachable(e) ? ADO_DOWN : e.message; saveUi();
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
  b.dataset.ado = adoBusy ? 'busy' : !ui.ado.on ? 'off' : ui.ado.error ? 'error' : 'on';
  b.dataset.tip = !ui.ado.on ? 'Connect Azure DevOps' : adoBusy ? 'Syncing with ADO' : ui.ado.error ? `ADO: ${ui.ado.error}`
    : ago == null ? 'ADO sync on' : `ADO synced ${ago < 1 ? 'just now' : plural(ago, 'minute') + ' ago'}`;
  if (tipFor === b) placeTip(b);
}
async function adoSetup(){
  await adoDetect();
  const viaConnector = adoVia === 'connector';
  const valueOpts = cur => [4, 3, 2, 1].map(v => `<option value="${v}"${v === cur ? ' selected' : ''}>${VALUE[v]}</option>`).join('');
  const tiers = Object.entries(PR_TIER).map(([k, d]) => { const t = state.ado.prTiers[k]; return `<tr><th scope="row" title="${esc(d.tip)}">${d.label}</th>
      <td><select data-tier-value="${k}" aria-label="${d.label}: starting value">${valueOpts(t.value)}</select></td>
      <td><label class="chk"><input type="checkbox" data-tier-urgent="${k}"${t.urgent ? ' checked' : ''}> Urgent</label></td></tr>`; }).join('');
  showModal(`<div class="sheet" role="dialog" aria-modal="true" aria-label="Connect Azure DevOps"><h3>Connect Azure DevOps</h3>
    <p>Your Issues, Bugs and User Stories, plus pull requests waiting on your review, show up as tasks in an <b>ADO</b> list. New work items wait for you to pick them, unless you choose to add them automatically below. ${viaConnector
      ? 'Workshop on this computer talks to ADO with your PAT, so the PAT never touches this page. Its connections are in <b>Settings</b>.'
      : 'A small helper on this computer talks to ADO with your PAT, so the PAT never touches this page or leaves your computer.'}</p>
    ${viaConnector ? '' : `<ol class="steps">
      <li>Download <a class="lnk" href="ado-helper/ado_helper.py" download>ado_helper.py</a> to a folder you keep, like Documents.</li>
      <li>In that folder, run <code>py ado_helper.py</code>. The first time, it asks for your ADO collection URL and the name of the environment variable holding your PAT.</li>
      <li>For pull requests, run <code>py ado_helper.py --add-pr-source</code> and enter each collection and project to watch. Your PAT also needs Code (Read).</li>
      <li>Leave it running, or run <code>py ado_helper.py --startup</code> once so it starts when you log in.</li>
      <li>Click Connect. If the browser asks to allow access to apps on this device, choose Allow.</li>
    </ol>
    <div class="fld"><label for="adoPort">Helper port</label><input type="number" id="adoPort" class="mono" min="1024" max="65535" value="${ui.ado.port}"></div>`}
    <div class="opts" role="radiogroup" aria-label="New work items"><span class="lbl">New work items assigned to you</span>
      <label><input type="radio" name="adoChoose" value="1"${state.ado.choose ? ' checked' : ''}> Let me choose which to add</label>
      <label><input type="radio" name="adoChoose" value="0"${state.ado.choose ? '' : ' checked'}> Add them automatically</label></div>
    <div class="fld"><label for="adoEvery">Sync every</label><input type="number" id="adoEvery" class="mono" min="${ADO_SYNC_MIN}" max="${ADO_SYNC_MAX}" value="${state.ado.syncMinutes}"> <span class="hint">minutes</span></div>
    <table class="tiers"><caption>New pull request reviews start at</caption><tbody>${tiers}</tbody></table>
    <p class="hint" id="adoMsg" aria-live="polite" style="margin-top:.6rem">${ui.ado.on && ui.ado.error ? esc(ui.ado.error) : ''}</p>
    <footer>${ui.ado.on ? '<button class="btn text-danger" data-ado-off>Disconnect</button>' : ''}<span class="grow"></span><button class="btn" data-close>Cancel</button><button class="btn primary" data-ado-go>${ui.ado.on ? 'Save' : 'Connect'}</button></footer></div>`,
    sh => sh.addEventListener('click', async e => {
      if (e.target.closest('[data-ado-off]')){ ui.ado.on = false; ui.ado.error = ''; saveUi(); adoSchedule(); setAdo(); closeModal(); toast('ADO disconnected. Synced tasks stay in your board.'); return; }
      const go = e.target.closest('[data-ado-go]'); if (!go) return;
      const msg = sh.querySelector('#adoMsg');
      const portEl = sh.querySelector('#adoPort'), port = portEl ? Math.round(+portEl.value) : ui.ado.port;
      if (!(port >= 1024 && port <= 65535)){ msg.textContent = 'Use a port between 1024 and 65535.'; return; }
      const every = Math.round(+sh.querySelector('#adoEvery').value);
      if (!(every >= ADO_SYNC_MIN && every <= ADO_SYNC_MAX)){ msg.textContent = `Sync every ${ADO_SYNC_MIN} to ${ADO_SYNC_MAX} minutes.`; return; }
      const prTiers = {};
      for (const k of Object.keys(PR_TIER)) prTiers[k] = {value: +sh.querySelector(`[data-tier-value=${k}]`).value, urgent: sh.querySelector(`[data-tier-urgent=${k}]`).checked};
      const choose = sh.querySelector('[name=adoChoose]:checked').value === '1';
      if (choose !== state.ado.choose || every !== state.ado.syncMinutes || JSON.stringify(prTiers) !== JSON.stringify(state.ado.prTiers)){
        state.ado.syncMinutes = every; state.ado.prTiers = prTiers;
        if (choose !== state.ado.choose){ state.ado.choose = choose; if (!choose){ adoPick(state.ado.pending.map(p => p.id), []); normalizeRanks(state); } }
        commit();
      }
      ui.ado.port = port; go.disabled = true; msg.textContent = viaConnector ? 'Checking the ADO connector...' : 'Checking the helper...';
      try {
        await adoCall('health');
        ui.ado.on = true; ui.ado.error = ''; ui.ado.last = 0; saveUi();
        closeModal(); adoSchedule(); adoSync(true);
      } catch(err){
        msg.textContent = adoUnreachable(err) ? `${ADO_DOWN} Expected it at 127.0.0.1:${port}.` : err.message;
        go.disabled = false;
      }
    }));
}
function onAdoClick(btn){
  hideTip();
  if (!ui.ado.on) return adoSetup();
  const ago = ui.ado.last ? fmtMD(new Date(ui.ado.last)) + ' ' + new Date(ui.ado.last).toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'}) : 'never';
  popMenu(`<div class="who"><b>Azure DevOps</b>${ui.ado.error ? esc(ui.ado.error) : `Last sync ${esc(ago)}`}</div>
    ${state.ado.pending.length ? `<button data-a="review">Review ${plural(state.ado.pending.length, 'new item')}</button>` : ''}
    <button data-a="now">Sync now</button><button data-a="show">Show ADO list</button><button data-a="reports">Team reports</button><button data-a="setup">Settings</button>`, btn)
    .addEventListener('click', e => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      closeMenu();
      if (b.dataset.a === 'review') adoReview();
      if (b.dataset.a === 'now') adoSync(true);
      if (b.dataset.a === 'show'){ adoList(); setScope(state.ado.listId); }
      if (b.dataset.a === 'setup') adoSetup();
      if (b.dataset.a === 'reports') setView('reports');
    });
}

export { ADO_DOWN, ADO_GONE, PR_GONE, PR_TIER, adoApply, adoCall, adoDetect, adoInit, adoPick, adoReview, adoSchedule, adoSetup, adoShort, adoSync, adoUnreachable, onAdoClick, prTip, setAdo };
