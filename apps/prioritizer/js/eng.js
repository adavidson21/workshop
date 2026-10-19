import { renderMainOnly } from './drawer.js';
import { toast } from './overlays.js';
import { esc } from './util.js';
import { ready } from './ws.js';
/* Prioritizer: eng-agents stages on ADO tasks and Start as feature or bug (via shared/eng-client.js). */
/* The eng-agents live dashboard (started with /dashboard in opencode) runs on this computer. Once the
   shell's Dashboard page has connected to it (EngClient.settings().on), ADO tasks here show where their
   work item stands, and a task can start its work item. The connection and the shell API live in
   shared/eng-client.js; the dashboard itself is a page in the shell, not part of Prioritizer. */
const ENG_EVERY = 30 * 1000;
const ENG_STAGE = {start: 'Start', spec: 'Spec', plan: 'Plan', bug: 'Bug analysis', tasks: 'Tasks', build: 'Build', review: 'Review', pr: 'PR', ship: 'Ready to ship'};
const engIdle = () => ({status: 'idle', error: '', data: null, byId: new Map(), starting: new Map(), sig: ''});
let eng = engIdle();
let engTimer = null, engBurst = null;
const engOn = () => EngClient.settings().on;
async function engCheck(){
  if (eng.status === 'checking' || !engOn()) return;
  const first = eng.status !== 'ok';
  if (first) eng.status = 'checking';
  try {
    const d = await EngClient.status();
    const sig = JSON.stringify([d.items, d.starting, d.opencode && d.opencode.connected]);
    const changed = first || sig !== eng.sig;
    eng = {...eng, status: 'ok', error: '', data: d, sig,
      byId: new Map((d.items || []).map(i => [String(i.id), i])), starting: new Map((d.starting || []).map(i => [String(i.id), i]))};
    if (changed) renderMainOnly();
  } catch(e){
    const was = eng.status;
    eng = {...engIdle(), status: 'down', error: EngClient.unreachable(e) ? '' : e.message};
    if (was !== 'down') renderMainOnly();
  }
}
function engSchedule(){
  clearInterval(engTimer); engTimer = null;
  if (engOn()) engTimer = setInterval(() => { if (!document.hidden) engCheck(); }, ENG_EVERY);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && engOn()) engCheck(); });
// Connected or disconnected from the shell's Dashboard page.
EngClient.onChange(s => {
  engSchedule();
  if (s.on) { eng.status = 'idle'; engCheck(); } else { eng = engIdle(); renderMainOnly(); }
});

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
  if (i.paused) return 'Paused in eng-agents. Open the dashboard to resume.';
  if (i.waiting) return 'The agent is waiting for an answer. Open the dashboard.';
  if (engAuto(i, 'waiting')) return `Autopilot needs you: ${i.autopilot.message || 'see the dashboard'}`;
  if (engAuto(i, 'running')) return `Autopilot is building it. Now: ${engStep(n) || 'working'}`;
  if (n.needsYou) return `Needs you: ${engStep(n) || 'see the dashboard'}`;
  if (i.agent === 'busy') return 'The agent is working on it';
  return engStep(n) ? `Next: ${engStep(n)}` : 'Open in the dashboard';
}
function engChip(adoId){
  const i = engItem(adoId);
  if (!i){
    const st = eng.status === 'ok' && eng.starting.get(String(adoId));
    if (!st) return '';
    return st.waiting || st.error || st.agent === 'idle'
      ? `<button class="chip eng gate" data-act="eng" data-ado="${esc(adoId)}" data-tip="${esc(st.error || (st.waiting ? '/start is asking you something. Open the dashboard.' : 'Finishing /start'))}">Starting</button>`
      : `<button class="chip eng" data-act="eng" data-ado="${esc(adoId)}" data-tip="Running /start in opencode"><i class="live"></i>Starting</button>`;
  }
  const gate = i.paused || i.waiting || engAuto(i, 'waiting') || (i.next && i.next.needsYou && !engAuto(i, 'running')) || i.blocked;
  const live = i.agent === 'busy' || engAuto(i, 'running');
  return `<button class="chip eng${gate ? ' gate' : ''}" data-act="eng" data-ado="${esc(adoId)}" data-tip="${esc(engTip(i))}">${live ? '<i class="live"></i>' : ''}${esc(engLabel(i))}</button>`;
}
function engDrawer(t){
  if (!engOn()) return '';
  if (eng.status !== 'ok') return `<div class="deng"><span>Live dashboard not reachable.</span><span class="grow"></span><button class="lnk" data-d="eng-open">Open Dashboard</button></div>`;
  const i = engItem(t.ado.id), n = i && i.next || {};
  if (i){
    const step = engStep(n);
    const what = engAuto(i, 'waiting') ? ` · <b>Autopilot needs you</b>${i.autopilot.message ? `: ${esc(i.autopilot.message)}` : ''}`
      : engAuto(i, 'running') ? ` · autopilot is on it${step ? `: ${esc(step)}` : ''}`
      : step ? ` · next: ${esc(step)}` : '';
    return `<div class="deng"><span>eng-agents <b>${esc(engLabel(i))}</b>${what}</span><span class="grow"></span><button class="btn" data-d="eng-open">Open in Dashboard</button></div>`;
  }
  const st = eng.starting.get(String(t.ado.id));
  if (st) return `<div class="deng"><span><b>Starting</b> in opencode${st.error ? `: ${esc(st.error)}` : '...'}</span><span class="grow"></span><button class="lnk" data-d="eng-open">Watch it</button></div>`;
  if (t.done) return '';
  const bug = /bug/i.test(t.ado.type || '');
  const oc = eng.data && eng.data.opencode && eng.data.opencode.connected;
  return `<div class="deng col"><span>Not started in eng-agents.</span>${oc
    ? `<div class="acts"><button class="btn${bug ? '' : ' primary'}" data-d="eng-start" data-lane="feature">Start as feature</button><button class="btn${bug ? ' primary' : ''}" data-d="eng-start" data-lane="bug">Start as bug</button></div>`
    : '<span class="hint">opencode is not connected to the dashboard.</span>'}</div>`;
}
async function engStart(t, lane, btn){
  if (btn) btn.disabled = true;
  try {
    await EngClient.start(t.ado.id, lane);
    toast(`Starting #${t.ado.id} as a ${lane} in opencode`, 'Watch it', () => engOpen(t.ado.id));
    clearInterval(engBurst);
    const until = Date.now() + 60 * 1000, id = String(t.ado.id);
    engBurst = setInterval(() => { if (Date.now() > until || eng.byId.has(id)){ clearInterval(engBurst); return; } engCheck(); }, 3000);
  } catch(e){
    toast(EngClient.unreachable(e) ? "Can't reach the live dashboard." : e.message);
  }
  engCheck();
}

/* Open the work item in the shell's Dashboard page. The SDK routes this to the shell when embedded,
   or navigates to the shell URL when Prioritizer runs on its own. */
function engOpen(adoId){
  const id = adoId ? String(adoId) : '';
  ready.then(ws => { if (ws) ws.open({app: 'dashboard', path: id}); });
}

export { eng, engCheck, engChip, engDrawer, engOpen, engSchedule, engStart };
