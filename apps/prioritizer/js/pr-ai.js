import { prRelease } from './ado.js';
import { holdCount } from './focus-hours.js';
import { renderMainOnly } from './drawer.js';
import { toast } from './overlays.js';
import { commit, state } from './state.js';
import { esc, plural } from './util.js';
import { ready } from './ws.js';
import { aiLabel, aiTip, aiTone, applyStatuses } from './pr-ai-model.js';
/* Docket: Tandem's first-pass PR reviews, through the opencode connector (the rules are in pr-ai-model.js).
   Docket only calls the connector's read actions: pr.inbox.save hands it the PRs waiting on you after each
   sync, and the connector's own setting (prReviews.onSync) decides whether to review them. pr.reviews says
   where each review stands. Results are read again after the connector's prQueue event, and once a minute
   while PRs are held, so the hold limit is kept even between syncs. */
const OC = 'opencode';
const GONE_STATES = ['disabled', 'missing', 'stopped', 'error'];   // the connector cannot review: let held PRs land
let ws = null, connector = null, onSync = null, busy = false, again = false, soon = null;

const connReady = () => !!connector && connector.state === 'ready';
const holdMs = () => state.ado.prHoldMinutes * 60 * 1000;

/** True when Tandem will review new PRs: the connector is ready, opencode is connected and onSync is on. */
async function prAiActive(){
  const w = await ready;
  if (!w || w.backend !== 'agent') return false;
  if (!ws) await prAiInit();
  if (!connReady()) return false;
  try {
    const r = await ws.connectors.call(OC, 'pr.reviews', {ids: []});
    onSync = !!r.onSync;
    return !!(r.onSync && r.ready);
  } catch(e){ return false; }
}

/** After an ADO sync: hand the PRs to the connector (it queues the new ones), then read the results. */
async function prAiAfterSync(res){
  const items = res && res.prs && Array.isArray(res.prs.items) ? res.prs.items : [];
  try {
    await ws.connectors.call(OC, 'pr.inbox.save', {prs: items.slice(0, 200).map(prArg).filter(p => p.url)});
  } catch(e){ /* the next sync tries again; the hold limit still applies */ }
  await prAiRefresh();
}
function prArg(p){
  const o = {url: typeof p.url === 'string' ? p.url.slice(0, 500) : ''};
  if (p.title) o.title = String(p.title).slice(0, 500);
  if (typeof p.commit === 'string' && /^[0-9a-f]{7,40}$/i.test(p.commit)) o.commit = p.commit;
  if (p.waiting) o.waiting = true;
  if (['blocking', 'asked', 'pool'].includes(p.tier)) o.tier = p.tier;
  return o;
}

/** Reads where each review stands and applies it: chips on tasks, held PRs that may now land. */
async function prAiRefresh(){
  if (!ws) return;
  if (busy){ again = true; return; }
  const ids = new Set(state.tasks.filter(t => t.pr && !t.done && t.pr.ai).map(t => String(t.pr.id)));
  for (const h of state.ado.prHeld) ids.add(String(h.item.id ?? h.key.split('|').pop()));
  if (!ids.size) return;
  if (!connReady()){ if (connector && GONE_STATES.includes(connector.state)) landAll(); return; }
  busy = true;
  try {
    const r = await ws.connectors.call(OC, 'pr.reviews', {ids: [...ids].slice(0, 200)});
    onSync = !!r.onSync;
    if (!r.onSync || !r.ready){ landAll(); return; }
    const statuses = new Map((r.prs || []).map(s => [String(s.id), s]));
    const out = applyStatuses({tasks: state.tasks, held: state.ado.prHeld, statuses, now: new Date(), holdMs: holdMs()});
    state.ado.prHeld = out.held;
    const made = prRelease(out.release);
    if (out.changed){ commit(); renderMainOnly(); }
    if (made.length && holdCount(made.length, 'pr')){ /* held during focus or lunch (focus-hours.js) */ }
    else if (made.length){
      const late = out.release.filter(x => x.ai && x.ai.state === 'timeout').length;
      toast(late === made.length ? `${plural(made.length, 'PR')} to review (Tandem had not finished)`
        : `${plural(made.length, 'PR')} reviewed by Tandem and added`, 'Show', () => import('./render.js').then(m => m.setScope(state.ado.prListId)));
    }
  } catch(e){ /* try again on the next event or minute */ }
  finally {
    busy = false;
    if (again){ again = false; prAiRefreshSoon(); }
  }
}
function prAiRefreshSoon(){ clearTimeout(soon); soon = setTimeout(prAiRefresh, 300); }

/** Tandem can't review now: held PRs become tasks as they are, and "reviewing" chips go away. */
function landAll(){
  let changed = 0;
  for (const t of state.tasks) if (t.pr && t.pr.ai && t.pr.ai.state === 'pending'){ delete t.pr.ai; changed++; }
  const made = prRelease(state.ado.prHeld.map(entry => ({entry, ai: null})));
  if (state.ado.prHeld.length) changed++;
  state.ado.prHeld = [];
  if (changed || made.length){ commit(); renderMainOnly(); }
  if (made.length && !holdCount(made.length, 'pr')) toast(`${plural(made.length, 'PR')} to review added (Tandem is not reviewing right now)`);
}

let inited = null;
function prAiInit(){
  return inited || (inited = (async () => {
    const w = await ready;
    if (!w || w.backend !== 'agent') return;
    ws = w;
    try {
      const c = (await ws.connectors.list()).find(x => x.id === OC);
      connector = c ? (c.enabled === false ? {state: 'disabled'} : c.status) : {state: 'missing', message: null};
    } catch(e){ connector = null; }
    ws.connectors.onStatus(OC, st => { connector = st; prAiRefreshSoon(); });
    ws.connectors.on(OC, 'prQueue', prAiRefreshSoon);
    setInterval(() => { if (state.ado.prHeld.length && !document.hidden) prAiRefresh(); }, 60 * 1000);
    prAiRefreshSoon();
  })());
}

/* ---------- what the page shows ---------- */
function prAiChip(t){
  const ai = t.pr && t.pr.ai; if (!ai || t.done) return '';
  const tone = aiTone(ai);
  return `<button class="chip ai${tone && tone !== 'live' ? ' ' + tone : ''}" data-act="prai" data-tip="${esc(aiTip(ai))}">${tone === 'live' ? '<i class="live"></i>' : ''}${esc(aiLabel(ai))}</button>`;
}
function prAiDrawer(t){
  const ai = t.pr && t.pr.ai; if (!ai) return '';
  const again = ai.state === 'failed' || ai.state === 'timeout';
  return `<div class="deng prai"><span>${esc(aiTip(ai))}</span><span class="grow"></span>${again && !t.done ? '<button class="lnk" data-d="prai-again" title="Runs /pr-review again in opencode (drafts only)">Review again</button>' : ''}<button class="btn" data-d="prai-open">Open in Loom</button></div>`;
}
/* Open the review in Dispatch (its PR review folder is pr-<id>). */
function prAiOpen(t){ ready.then(w => { if (w) w.open({app: 'slate', path: `pr-${t.pr.id}`}); }); }
// The click on Review again is the approval for this write action.
async function prAiAgain(t, btn){
  if (btn) btn.disabled = true;
  try {
    await ws.connectors.call(OC, 'pr.review', {url: t.pr.url, again: true}, {confirm: true});
    t.pr.ai = {state: 'pending', at: new Date().toISOString()};
    commit(); renderMainOnly();
    toast(`Reviewing PR ${t.pr.id} again`, 'Watch it', () => prAiOpen(t));
  } catch(e){
    toast(e.message || "Couldn't start the review.");
    if (btn) btn.disabled = false;
  }
}
/** For the ADO settings sheet: whether Tandem reviews new PRs (null: unknown or no connector). */
const prAiOnSync = () => (connReady() ? onSync : null);

export { prAiActive, prAiAfterSync, prAiAgain, prAiChip, prAiDrawer, prAiInit, prAiOnSync, prAiOpen, prAiRefresh };
