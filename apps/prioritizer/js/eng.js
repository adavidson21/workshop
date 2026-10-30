import { renderMainOnly } from './drawer.js';
import { toast } from './overlays.js';
import { esc } from './util.js';
import { ready } from './ws.js';
/* Prioritizer: eng-agents stages on ADO tasks, and Start as feature or bug, through the opencode connector.
   When Workshop runs the opencode connector (turned on in Settings), ADO tasks here show where their work
   item stands (connectors.call('opencode', 'status')), and a task can start its work item (`start`, a
   write action, sent with confirm: true from the button's click). The stages are read again after the
   connector's events, so there is no polling. The Agents app shows the items themselves. */
const ENG_STAGE = {start: 'Start', spec: 'Spec', plan: 'Plan', bug: 'Bug analysis', tasks: 'Tasks', build: 'Build', review: 'Review', pr: 'PR', ship: 'Ready to ship'};
const OC = 'opencode';
// status: off (no connector: browser mode, not installed or turned off) | down (on but not ready) | checking | ok
const engIdle = () => ({status: 'off', error: '', data: null, byId: new Map(), starting: new Map(), sig: ''});
let eng = engIdle();
let ws = null, connector = null; // connector: its status from the agent, {state, message}
let engBurst = null, soon = null, checking = false, againAfter = false;

const engOn = () => !!connector && connector.state !== 'disabled' && connector.state !== 'missing';
const engReady = () => !!connector && connector.state === 'ready';

async function engCheck(){
  if (!ws) return;
  if (!engReady()){
    const was = eng.status;
    eng = {...engIdle(), status: engOn() ? 'down' : 'off', error: engOn() ? (connector.message || '') : ''};
    if (was !== eng.status) renderMainOnly();
    return;
  }
  if (checking){ againAfter = true; return; }
  checking = true;
  const first = eng.status !== 'ok';
  if (first) eng.status = 'checking';
  try {
    const d = await ws.connectors.call(OC, 'status');
    const sig = JSON.stringify([d.items, d.starting, d.opencode && d.opencode.connected]);
    const changed = first || sig !== eng.sig;
    eng = {...eng, status: 'ok', error: '', data: d, sig,
      byId: new Map((d.items || []).map(i => [String(i.id), i])), starting: new Map((d.starting || []).map(i => [String(i.id), i]))};
    if (changed) renderMainOnly();
  } catch(e){
    const was = eng.status;
    eng = {...engIdle(), status: 'down', error: e.message || ''};
    if (was !== 'down') renderMainOnly();
  } finally {
    checking = false;
    if (againAfter){ againAfter = false; engCheckSoon(); }
  }
}
function engCheckSoon(){ clearTimeout(soon); soon = setTimeout(engCheck, 150); }

// Connects once: the connector's status, then its events and status changes.
async function engSchedule(){
  const w = await ready;
  if (!w || w.backend !== 'agent' || ws) return;
  ws = w;
  try {
    const c = (await ws.connectors.list()).find(x => x.id === OC);
    connector = c ? c.status : {state: 'missing', message: null};
  } catch(e){ connector = null; }
  ws.connectors.onStatus(OC, st => { connector = st; engCheckSoon(); });
  ws.connectors.on(OC, '*', engCheckSoon);
  ws.on('online', ({online}) => { if (online) engCheckSoon(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && engOn()) engCheckSoon(); });
  engCheck();
}

function engItem(adoId){ return eng.status === 'ok' ? eng.byId.get(String(adoId)) || null : null; }
const engStep = n => (n && (n.text || n.action || n.command)) || '';
const engAuto = (i, st) => !!i.autopilot && i.autopilot.status === st;
function engLabel(i){
  if (i.paused) return 'Paused';
  if (i.waiting) return 'Agent is asking';
  let l = ENG_STAGE[i.stage] || i.stage || 'Started';
  if (i.stage === 'build' && i.tasks && i.tasks.total) l += ` ${i.tasks.done}/${i.tasks.total}`;
  return l;
}
function engTip(i){
  const n = i.next || {};
  if (i.paused) return 'Paused in Tandem. Open Dispatch to resume.';
  if (i.waiting) return 'The agent is waiting for an answer. Open Dispatch.';
  if (engAuto(i, 'waiting')) return `Autopilot needs you: ${i.autopilot.message || 'see Dispatch'}`;
  if (engAuto(i, 'running')) return `Autopilot is building it. Now: ${engStep(n) || 'working'}`;
  if (n.needsYou) return `Needs you: ${engStep(n) || 'see Dispatch'}`;
  if (i.agent === 'busy') return 'The agent is working on it';
  return engStep(n) ? `Next: ${engStep(n)}` : 'Open in Dispatch';
}
function engChip(adoId){
  const i = engItem(adoId);
  if (!i){
    const st = eng.status === 'ok' && eng.starting.get(String(adoId));
    if (!st) return '';
    return st.waiting || st.error || st.agent === 'idle'
      ? `<button class="chip eng gate" data-act="eng" data-ado="${esc(adoId)}" data-tip="${esc(st.error || (st.waiting ? '/start is asking you something. Open Dispatch.' : 'Finishing /start'))}">Starting</button>`
      : `<button class="chip eng" data-act="eng" data-ado="${esc(adoId)}" data-tip="Running /start in opencode"><i class="live"></i>Starting</button>`;
  }
  const gate = i.paused || i.waiting || engAuto(i, 'waiting') || (i.next && i.next.needsYou && !engAuto(i, 'running')) || i.blocked;
  const live = i.agent === 'busy' || engAuto(i, 'running');
  return `<button class="chip eng${gate ? ' gate' : ''}" data-act="eng" data-ado="${esc(adoId)}" data-tip="${esc(engTip(i))}">${live ? '<i class="live"></i>' : ''}${esc(engLabel(i))}</button>`;
}
function engDrawer(t){
  if (!engOn()) return '';
  if (eng.status !== 'ok') return `<div class="deng"><span>The opencode connector is not ready${eng.error ? `: ${esc(eng.error)}` : '.'}</span><span class="grow"></span><button class="lnk" data-d="eng-open">Open Dispatch</button></div>`;
  const i = engItem(t.ado.id), n = i && i.next || {};
  if (i){
    const step = engStep(n);
    const what = engAuto(i, 'waiting') ? ` · <b>Autopilot needs you</b>${i.autopilot.message ? `: ${esc(i.autopilot.message)}` : ''}`
      : engAuto(i, 'running') ? ` · autopilot is on it${step ? `: ${esc(step)}` : ''}`
      : step ? ` · next: ${esc(step)}` : '';
    return `<div class="deng"><span>Tandem <b>${esc(engLabel(i))}</b>${what}</span><span class="grow"></span><button class="btn" data-d="eng-open">Open in Dispatch</button></div>`;
  }
  const st = eng.starting.get(String(t.ado.id));
  if (st) return `<div class="deng"><span><b>Starting</b> in opencode${st.error ? `: ${esc(st.error)}` : '...'}</span><span class="grow"></span><button class="lnk" data-d="eng-open">Watch it</button></div>`;
  if (t.done) return '';
  const bug = /bug/i.test(t.ado.type || '');
  const oc = eng.data && eng.data.opencode && eng.data.opencode.connected;
  return `<div class="deng col"><span>Not started in Tandem.</span>${oc
    ? `<div class="acts"><button class="btn${bug ? '' : ' primary'}" data-d="eng-start" data-lane="feature" title="Runs /start ${esc(t.ado.id)} feature in opencode">Start as feature</button><button class="btn${bug ? ' primary' : ''}" data-d="eng-start" data-lane="bug" title="Runs /start ${esc(t.ado.id)} bug in opencode">Start as bug</button></div>`
    : '<span class="hint">opencode is not connected to Workshop.</span>'}</div>`;
}
// The click on Start as feature or bug is the approval for this write action.
async function engStart(t, lane, btn){
  if (btn) btn.disabled = true;
  try {
    await ws.connectors.call(OC, 'start', {id: String(t.ado.id), lane}, {confirm: true});
    toast(`Starting #${t.ado.id} as a ${lane} in opencode`, 'Watch it', () => engOpen(t.ado.id));
    // Until the folder appears, check now and then too, in case an event is missed.
    clearInterval(engBurst);
    const until = Date.now() + 60 * 1000, id = String(t.ado.id);
    engBurst = setInterval(() => { if (Date.now() > until || eng.byId.has(id)){ clearInterval(engBurst); return; } engCheck(); }, 3000);
  } catch(e){
    toast(e.message || "Couldn't start it.");
    if (btn) btn.disabled = false;
  }
  engCheck();
}

/* Open the work item in the Agents app. The SDK routes this to the shell when embedded, or navigates to
   the shell URL when Prioritizer runs on its own. */
function engOpen(adoId){
  const id = adoId ? String(adoId) : '';
  ready.then(w => { if (w) w.open({app: 'agents', path: id}); });
}

export { eng, engCheck, engChip, engDrawer, engOpen, engSchedule, engStart };
