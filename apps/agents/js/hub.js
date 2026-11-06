/* Dispatch: the hub (docs/hub.md). One input at the top of Dispatch for everything: captures, questions about your
   repos and work, places to go, and suggested actions. Each message goes to Tandem's /hub through the opencode
   connector (hub.run, write: true, Enter is the click) and the result is read back with hub.result.

   Drawn once into #hub and never repainted by main.js, so typing is never lost.

   - capture: proposal rows to review. Enter (or Accept all) accepts them; each row can be accepted, edited,
     changed (Tab) or dismissed. Accepted captures go to Dispatch's own `handoffs` collection with accepted: true
     (shared/capture-box.js); Docket, Rapport and Notes add them when they load. Nothing else is written.
   - ask: the answer, with sources. Buttons: Make it a spike (with a confirm), Save as note.
   - go: opens the app. act: a button with its own confirm, only for the actions in hub-model.js ACTS.
   - clarify: chips that send the message again with the choice.
   Nothing here assigns, creates or changes anything in Azure DevOps or git by itself.

   When the hub cannot reach Tandem (browser mode, the connector or its Hub setting off, no /hub command), the box
   still captures with the same rules as Home's quick capture, and questions say how to turn the hub on.

   The AI button at the end of the input shows the Hub setting: lit when on, slashed when off, dimmed when the hub
   cannot run here. In Workshop on this computer a click flips the setting (putConfig, which restarts the
   connector). On a hosted page it cannot (connector settings are local only, docs/security.md), so a click shows
   why under the input for a few seconds. */
import { createCaptureStore } from '../../../shared/capture-box.js';
import { TARGET_NAMES, describe, isCapture, nextKind, parseCapture, retarget } from '../../../shared/capture.js';
import { HUB_GIVE_UP_MS, actAllowed, answerHtml, checkRoute, esc, hubContext, hubId, isLow, repairRoute, toProposal } from './hub-model.js';

const OC = 'opencode';
/* A sparkle. The slash shows only when AI is off (agents.css, .hub-ai). */
const AI_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path class="spark" d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z"/><path class="spark" d="M19 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/><line class="slash" x1="4" y1="20" x2="20" y2="4"/></svg>';
const POLL_MS = 1500;
const KEEP_CARDS = 12;

export function startHub(ws, root) {
  const store = createCaptureStore(ws, { sender: 'agents' });
  const cards = [];             // newest first: {id, text, state, route, answer, error, session, rows, at}
  let src = {}, status = { ready: false, why: 'Checking the hub...' };
  /* The AI button at the end of the input. state: checking | on | off | na (the hub cannot run here).
     canFlip: this page may change the Hub setting (Workshop on this computer, connector ready). */
  let ai = { state: 'checking', canFlip: false, config: null, busy: false };
  let noteTimer = 0;

  root.classList.add('hub');
  root.innerHTML = `
    <label class="cap-line hub-line"><span class="cap-prompt" aria-hidden="true">&gt;</span>
      <input class="cap-in" type="text" autocomplete="off" aria-label="Hub: ask Tandem or capture" placeholder="Ask about your repos and work, or capture a task, receipt or note">
      <button type="button" class="hub-ai" data-state="checking" aria-pressed="false">${AI_ICON}</button></label>
    <p class="hub-status" aria-live="polite" hidden></p>
    <div class="hub-cards"></div>`;
  const input = root.querySelector('.cap-in');
  const statusEl = root.querySelector('.hub-status');
  const aiBtn = root.querySelector('.hub-ai');
  const list = root.querySelector('.hub-cards');

  /* ---------- what is available ---------- */
  async function check() {
    ai = { ...ai, state: 'na', canFlip: false, config: null };
    if (ws.backend !== 'agent') { status = { ready: false, why: 'The hub needs Workshop on this computer. Captures still work here, with simple rules.' }; return draw(); }
    try {
      const c = (await ws.connectors.list()).find(x => x.id === OC);
      if (!c || c.status.state === 'disabled') status = { ready: false, why: 'Turn on the opencode connector in Settings to ask Tandem. Captures still work here, with simple rules.' };
      else if (c.status.state !== 'ready') status = { ready: false, why: c.status.message || 'The opencode connector is not ready yet.' };
      else {
        let on = false, config = null;
        try { const cfg = await ws.connectors.getConfig(OC); config = cfg && cfg.config; on = !!(config && config.hub === true); } catch (e) { on = false; }
        const local = ws.mode === 'local';
        ai = { ...ai, state: on ? 'on' : 'off', canFlip: local && !!config, config };
        status = on ? { ready: true, why: '' } : { ready: false, why: local
          ? 'AI is off. Captures still work here, with simple rules.'
          : 'AI is off. Turn it on from Dispatch in Workshop on this computer (hosted pages cannot change it). Captures still work here, with simple rules.' };
      }
    } catch (e) { status = { ready: false, why: "Couldn't reach Workshop on this computer." }; }
    draw();
  }
  async function readContext() {
    const get = (c, app) => ws.data.get(c, { app }).catch(() => null);
    const [dir, summary, teams] = await Promise.all([ws.people.get().catch(() => null), get('summary', 'prioritizer'), get('teams', 'settings')]);
    src = { dir, summary, teams };
  }
  const rulesCtx = () => {
    const c = hubContext(src), d = new Date();
    return { today: new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10), people: c.items, lists: c.lists };
  };

  /* ---------- sending ---------- */
  async function send(text) {
    text = String(text || '').trim();
    if (!text) return;
    if (!status.ready) return rulesOnly(text);
    const card = { id: hubId(), text, state: 'running', at: Date.now(), rows: [] };
    cards.unshift(card); cards.length = Math.min(cards.length, KEEP_CARDS);
    draw();
    try {
      const r = await ws.connectors.call(OC, 'hub.run', { id: card.id, text, context: (({ people, lists, areas }) => ({ people, lists, areas }))(hubContext(src)) }, { confirm: true });
      card.session = r && r.session;
      poll(card);
    } catch (e) {
      card.state = 'failed';
      card.error = /no \/hub command/.test(e.message || '') ? 'Tandem has no /hub yet. Run the Tandem install command again (eng-agents Core 2.9.0), then restart opencode.' : (e.message || 'The hub could not start.');
      draw();
    }
  }
  function poll(card) {
    const tick = async () => {
      if (card.state !== 'running') return;
      try {
        const r = await ws.connectors.call(OC, 'hub.result', { id: card.id });
        if (r.said) card.said = r.said;
        if (r.answer != null) card.answer = r.answer;
        // A route that still does not fit after repair is not acted on, but the answer and reply still show.
        const route = r.route ? checkRoute(repairRoute(r.route)) : null;
        if (r.route && !route) card.badRoute = true;
        if (route && !card.route) arrive(card, route);
        if (r.state === 'running') { /* keep polling */ }
        else if (r.state === 'done') card.state = 'done';
        else if (r.state === 'routed') card.state = card.route && card.route.intent === 'ask' ? 'noanswer' : card.route ? 'done' : 'noanswer';
        else if (r.state === 'failed') { card.state = card.answer != null ? 'done' : 'failed'; card.error = r.error; }
        else if (r.state === 'none') { card.state = 'failed'; card.error = 'Workshop restarted before the hub finished. Send it again.'; }
      } catch (e) { /* try again */ }
      draw();
      if (card.state === 'running') {
        if (Date.now() - card.at > HUB_GIVE_UP_MS) { card.state = 'failed'; card.error = 'Still running after 10 minutes. It shows under Investigations and repo guides, where you can stop it or reply.'; draw(); }
        else setTimeout(tick, POLL_MS);
      }
    };
    setTimeout(tick, 400);
  }
  // A route arrived: captures become review rows, go opens the app.
  function arrive(card, route) {
    card.route = route;
    if (route.intent === 'capture') card.rows = route.proposals.map(p => ({ p: toProposal(p, src.dir || undefined), state: 'open' }));
    if (route.intent === 'go') ws.open(route.go.path ? { app: route.go.app, path: route.go.path } : { app: route.go.app });
  }
  // No Tandem: the same rules as Home's quick capture.
  function rulesOnly(text) {
    const p = parseCapture(text, rulesCtx());
    if (!p) return;
    if (p.kind === 'go') { ws.open(p.path ? { app: p.app, path: p.path } : { app: p.app }); return; }
    const card = { id: hubId(), text, at: Date.now(), state: 'rules', rows: [] };
    if (p.kind === 'ask') { card.state = 'failed'; card.error = status.why || 'Turn on the hub to ask Tandem.'; }
    else card.rows = [{ p, state: 'open' }];
    cards.unshift(card); cards.length = Math.min(cards.length, KEEP_CARDS);
    draw();
  }

  /* ---------- review ---------- */
  async function accept(card, idxs) {
    const rows = idxs.map(i => card.rows[i]).filter(r => r && r.state === 'open' && isCapture(r.p));
    if (!rows.length) return;
    try {
      const sent = await store.send(rows.map(r => r.p));
      rows.forEach((r, i) => { r.state = 'sent'; r.hid = sent[i] && sent[i].id; });
      ws.toast(rows.length === 1 ? `Sent to ${describe(rows[0].p).split(' · ')[0]}` : `${rows.length} captures sent`, { kind: 'success' });
    } catch (e) { ws.toast(e && e.code === 'unavailable' ? 'Allow Workshop to use your folder first.' : "Couldn't save that. Try again.", { kind: 'error' }); }
    draw();
  }
  async function undo(card, i) {
    const r = card.rows[i];
    if (!r || r.state !== 'sent' || !r.hid) return;
    try { await store.withdraw(r.hid); r.state = 'open'; r.hid = null; ws.toast('Withdrawn. If the app already added it, remove it there too.'); }
    catch (e) { ws.toast("Couldn't undo that.", { kind: 'error' }); }
    draw();
  }
  async function runAct(card) {
    const a = card.route && card.route.act;
    if (!actAllowed(a)) return;
    if (!window.confirm(`${a.label}?\n\nThis starts work in Tandem.`)) return;
    try { await ws.connectors.call(a.connector, a.action, a.args, { confirm: true }); ws.toast('Started. It shows below.', { kind: 'success' }); card.acted = true; }
    catch (e) { ws.toast(e.message || 'Could not start that.', { kind: 'error' }); }
    draw();
  }
  async function spike(card) {
    if (!window.confirm(`Start a spike on "${card.text}"?\n\nThe investigator reads code and writes findings in .work. It changes no code.`)) return;
    try { await ws.connectors.call(OC, 'spike', { topic: card.text.slice(0, 500) }, { confirm: true }); ws.toast('Spike started. It shows below.', { kind: 'success' }); }
    catch (e) { ws.toast(e.message || 'Could not start the spike.', { kind: 'error' }); }
  }
  async function saveNote(card) {
    const body = `${card.text}\n\n${card.answer || card.said || ''}`.trim();
    const p = { kind: 'note', to: 'notes', text: body.slice(0, 2000), title: card.text.slice(0, 120), payload: { kind: 'note', title: card.text.slice(0, 120) } };
    try { await store.send([p]); ws.toast('Saved to Notes (inbox).', { kind: 'success' }); } catch (e) { ws.toast("Couldn't save that.", { kind: 'error' }); }
  }

  /* ---------- drawing ---------- */
  function rowHtml(card, r, i) {
    const low = isLow(r.p) ? ' <span class="hub-low" title="The hub was not sure. Check it.">check this</span>' : '';
    const why = r.p.reason ? `<span class="hub-why">${esc(r.p.reason)}</span>` : '';
    const btns = r.state === 'sent'
      ? `<span class="hub-sent">Sent</span><button class="btn ghost" type="button" data-hub-undo="${i}">Undo</button>`
      : r.state === 'dismissed' ? '<span class="hub-sent">Dismissed</span>'
      : r.state === 'edit' ? `<input class="hub-edit" value="${esc(r.p.text)}" data-hub-editbox="${i}" aria-label="Edit the capture"><button class="btn" type="button" data-hub-save="${i}">Save</button>`
      : `<button class="btn primary" type="button" data-hub-accept="${i}">Accept</button><button class="btn ghost" type="button" data-hub-edit="${i}" title="Edit (e)">Edit</button><button class="btn ghost" type="button" data-hub-kind="${i}" title="Change what it is">Change</button><button class="btn ghost" type="button" data-hub-dismiss="${i}">Dismiss</button>`;
    return `<li class="hub-row ${r.state}"><span class="cap-tag">${esc(describe(r.p))}</span><span class="cap-text">${esc(r.p.title || r.p.text)}${low}</span>${why}<span class="hub-btns">${btns}</span></li>`;
  }
  function cardHtml(card, ci) {
    const head = `<header><span class="hub-q">${esc(card.text)}</span><span class="hub-state">${card.state === 'running' ? (card.route && card.route.intent === 'ask' ? 'Answering...' : 'Thinking...') : card.state === 'rules' ? 'Captured with rules' : ''}</span></header>`;
    let body = '';
    const route = card.route;
    if (card.rows.length) {
      const open = card.rows.filter(r => r.state === 'open').length;
      body += `<ul class="hub-rows">${card.rows.map((r, i) => rowHtml(card, r, i)).join('')}</ul>` +
        (open > 1 ? `<p class="hub-actions"><button class="btn primary" type="button" data-hub-all>Accept all ${open}</button></p>` : '');
    }
    const asked = !route || route.intent === 'ask';
    if (asked && card.answer != null) body += `<div class="hub-answer">${answerHtml(card.answer)}</div>`;
    if (route && route.intent === 'ask' && route.ask.repos.length) body += `<p class="hub-meta">Looked in ${route.ask.repos.map(esc).join(', ')}</p>`;
    // No answer file: show what the session said, so a reply is never lost behind an error.
    if (card.answer == null && card.said && card.state !== 'running' && (asked || card.badRoute)) body += `<p class="hub-meta">Tandem said:</p><div class="hub-answer">${answerHtml(card.said)}</div>`;
    if (asked && card.state !== 'running' && (card.answer != null || card.said)) body += `<p class="hub-actions"><button class="btn" type="button" data-hub-spike>Make it a spike</button><button class="btn ghost" type="button" data-hub-note>Save as note</button></p>`;
    if (card.state === 'noanswer' && !card.said) body += '<p class="hub-meta">The hub ended without an answer. Ask again, or rephrase.</p>';
    if (card.badRoute) body += '<p class="hub-meta">Tandem\'s routing did not match what Dispatch expects, so nothing was captured or opened. Its reply is shown as is.</p>';
    if (route && route.intent === 'go') body += `<p class="hub-meta">Opened ${esc(TARGET_NAMES[route.go.app] || route.go.app)}.</p>`;
    if (route && route.intent === 'act') {
      body += actAllowed(route.act)
        ? `<p class="hub-actions"><button class="btn primary" type="button" data-hub-act ${card.acted ? 'disabled' : ''}>${esc(route.act.label)}</button></p>`
        : `<p class="hub-meta">Suggested: ${esc(route.act.label)}. Dispatch does not run that from the hub.</p>`;
    }
    if (route && route.intent === 'clarify') {
      body += `<p class="hub-ask">${esc(route.clarify.question)}</p><p class="hub-actions">${route.clarify.choices.map((c, i) => `<button class="btn" type="button" data-hub-choice="${i}">${esc(c)}</button>`).join('')}</p>`;
    }
    if (card.error && card.answer == null) body += `<p class="hub-error">${esc(card.error)}</p>`;
    return `<article class="hub-card" data-card="${ci}">${head}${body}</article>`;
  }
  function draw() {
    drawAi();
    list.innerHTML = cards.map(cardHtml).join('');
  }

  /* ---------- the AI button ---------- */
  function aiTip() {
    if (ai.busy) return 'Saving...';
    if (ai.state === 'checking') return 'Checking the hub...';
    if (ai.state === 'on') return 'AI is on: Enter sends to Tandem. Captures wait for you to accept them; nothing changes in Azure DevOps or git.' + (ai.canFlip ? ' Click to turn AI off.' : '');
    if (ai.state === 'off' && ai.canFlip) return 'AI is off. Captures still work here, with simple rules. Click to turn AI on.';
    return status.why;
  }
  function drawAi() {
    const tip = aiTip();
    aiBtn.dataset.state = ai.busy ? 'checking' : ai.state;
    aiBtn.setAttribute('aria-pressed', ai.state === 'on' ? 'true' : 'false');
    aiBtn.setAttribute('aria-label', tip);
    aiBtn.title = tip;
    aiBtn.classList.toggle('locked', !ai.canFlip);
  }
  /* A short note under the input, then gone. Used when the button cannot flip the setting here. */
  function note(text) {
    clearTimeout(noteTimer);
    statusEl.textContent = text;
    statusEl.hidden = false;
    noteTimer = setTimeout(() => { statusEl.hidden = true; }, 7000);
  }
  async function flipAi() {
    if (ai.busy || ai.state === 'checking') return;
    if (!ai.canFlip) return note(status.why || aiTip());
    const turnOn = ai.state !== 'on';
    ai.busy = true; drawAi();
    try {
      await ws.connectors.putConfig(OC, { ...ai.config, hub: turnOn });
      ws.toast(turnOn ? 'AI is on. The opencode connector restarts.' : 'AI is off. Captures still work, with simple rules.', { kind: 'success' });
    } catch (e) {
      ws.toast(e && e.code === 'local_only' ? 'Change this from Dispatch in Workshop on this computer.' : "Couldn't change the AI setting. Try again.", { kind: 'error' });
    }
    ai.busy = false;
    await check();
  }
  aiBtn.addEventListener('click', e => { e.preventDefault(); flipAi(); });

  /* ---------- input ---------- */
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const t = input.value; input.value = ''; send(t); return; }
    if (e.key === 'Escape' && input.value) { e.preventDefault(); input.value = ''; }
  });
  root.addEventListener('click', e => {
    const el = e.target.closest('button,[data-hub-editbox]');
    if (!el || el.tagName !== 'BUTTON') return;
    const card = cards[+(el.closest('[data-card]') || {}).dataset?.card];
    if (!card) return;
    const d = el.dataset;
    if (d.hubAccept != null) accept(card, [+d.hubAccept]);
    else if (d.hubAll != null) accept(card, card.rows.map((_, i) => i));
    else if (d.hubUndo != null) undo(card, +d.hubUndo);
    else if (d.hubDismiss != null) { card.rows[+d.hubDismiss].state = 'dismissed'; draw(); }
    else if (d.hubEdit != null) { card.rows[+d.hubEdit].state = 'edit'; draw(); const b = root.querySelector(`[data-card="${cards.indexOf(card)}"] [data-hub-editbox]`); if (b) b.focus(); }
    else if (d.hubSave != null) saveEdit(card, +d.hubSave);
    else if (d.hubKind != null) { const r = card.rows[+d.hubKind]; r.p = { ...retarget(r.p, nextKind(r.p.kind), rulesCtx()), confidence: r.p.confidence, reason: r.p.reason }; draw(); }
    else if (d.hubAct != null) runAct(card);
    else if (d.hubSpike != null) spike(card);
    else if (d.hubNote != null) saveNote(card);
    else if (d.hubChoice != null) send(`${card.text} (${card.route.clarify.choices[+d.hubChoice]})`);
  });
  function saveEdit(card, i) {
    const box = root.querySelector(`[data-card="${cards.indexOf(card)}"] [data-hub-editbox="${i}"]`);
    const r = card.rows[i];
    if (!box || !r) return;
    const text = box.value.trim();
    if (text) {
      const prefix = { task: 't ', waiting: 'w ', receipt: 'r ', note: 'n ', idea: 'p ' }[r.p.kind] || '';
      const again = parseCapture(prefix + text, rulesCtx());
      // Keep what Tandem filled in that the words do not change (people, value, about), then the new text.
      if (again) r.p = { ...again, payload: { ...r.p.payload, ...again.payload, title: again.payload.title || again.title }, confidence: r.p.confidence, reason: r.p.reason };
    }
    r.state = 'open';
    draw();
  }
  root.addEventListener('keydown', e => {
    const box = e.target.closest && e.target.closest('[data-hub-editbox]');
    if (box && e.key === 'Enter') { e.preventDefault(); const card = cards[+box.closest('[data-card]').dataset.card]; saveEdit(card, +box.dataset.hubEditbox); }
  });

  readContext();
  ws.people.subscribe(readContext);
  ws.data.subscribe('summary', readContext, { app: 'prioritizer' });
  ws.data.subscribe('teams', readContext, { app: 'settings' });
  if (ws.backend === 'agent') { ws.connectors.onStatus(OC, check); ws.on('online', p => { if (p && p.online) check(); }); }
  store.load().catch(() => {});
  check();

  return {
    focus: () => input.focus(),
    /* From Home (#/agents/hub/<text>): Enter was pressed there, so the message is sent. */
    async ask(text) { await check(); input.value = ''; send(text); input.focus(); },
    check
  };
}
