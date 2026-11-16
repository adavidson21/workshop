/* Chat (docs/chat.md): opencode in Workshop, laid out like ChatGPT and working like the opencode TUI (Chat 2.0.0).
   - A sidebar: New chat, search, the list grouped by Today, Yesterday, Previous 7 days and Older, with Rename and
     Remove on each row. Chats shows the chats you started and hub threads; All sessions adds every opencode session
     in the workspace (runs, PR reviews, the terminal), like the TUI's /sessions. The sidebar collapses (kept in
     this browser); on a phone it is a drawer.
   - One chat in view: the turns in a centered column with tool calls, diffs, thinking and to-dos (parts.js), the
     permission prompts and questions to answer right there, and the composer pinned at the bottom.
   - opencode is always on here: Chat works whenever the opencode connector is on and ready (Chat 2.2.0 dropped the
     separate AI switch). Turn the connector off in Settings to stop it.
   - The composer: an agent picker (Tab and Shift+Tab cycle it, like the TUI) and a model picker, / for commands
     (Chat's own and opencode's), @ for workspace files, ! for a shell command, Up for the last message, Esc twice
     to stop. A message sent while opencode is working waits in a queue and goes when it is done.
   - New chat: the same composer. Its agent list starts with Hub, which swaps in the hub's box (hub.js): one box that
     asks Tandem or captures a task, receipt or note. Then Rewrite (Chat 2.2.0), which swaps in Rewrite a draft
     (rewrite.js): the same composer with For and Reader in its bar, your drafts and their rewrites as turns.

   Everything goes through the opencode connector's chat.* actions; a message, a command or a click is the only
   thing that makes opencode act, and opencode's own permission settings decide what an agent may do, exactly as in
   the terminal. Drawn into its own element, so typing survives repaints (keepFocus). */
import { esc, flowCardsHtml, flowRoute } from './hub-model.js';
import { WRITING, groupChats, keepFocus, lastTandem, liveEchoes, matchChat, tandemTurn, youTurn } from './thread.js';
import { BUILTINS, HELP, cycleAgent, filesIn, matchCommands, matchModels, modelFromKey, modelKey, modelLabel, money, parseInput, popupFor, promptHtml, questionAnswers, richRows, splitRevert, tokens } from './parts.js';

const OC = 'opencode';
const LIST_MS = 10000;
const BUSY_MS = 1000;
const SIDE_KEY = 'dispatch.chatSide';
const PICK_KEY = 'chat.pick';
const ALL_KEY = 'chat.all';
const DETAILS_KEY = 'chat.details';
const PHONE = '(max-width: 820px)';
const NEW = '__new';
const HUB = 'hub';
const HUB_AGENT = { name: HUB, description: 'Ask Tandem, or capture a task, receipt or note for your apps' };
const REWRITE = 'rewrite';
const REWRITE_AGENT = { name: REWRITE, description: 'Rewrite a draft in your voice for an audience' };
const MODES = { [HUB]: 'Hub', [REWRITE]: 'Rewrite' }; // New chat's own modes, not opencode agents

const ICON = {
  side: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="9.5" y1="4.5" x2="9.5" y2="19.5" stroke="currentColor" stroke-width="1.6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>',
  pen: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path d="M4 20h4L19 9l-4-4L4 16z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"/></svg>',
  up: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M12 19V6M6 11l6-6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  stop: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/></svg>',
  undo: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false"><path d="M9 14L4 9l5-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 9h10a6 6 0 010 12h-3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  redo: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false"><path d="M15 14l5-5-5-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 9H10a6 6 0 000 12h3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  compact: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false"><path d="M8 4l4 4 4-4M8 20l4-4 4 4M4 12h16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  term: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false"><rect x="3" y="4.5" width="18" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 10l3 2.5L7 15M12.5 15H17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  caret: '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

function readJson(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; } }
function writeJson(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* blocked */ } }
function loadSide() { try { return localStorage.getItem(SIDE_KEY) === 'closed'; } catch (e) { return false; } }
function saveSide(closed) { try { localStorage.setItem(SIDE_KEY, closed ? 'closed' : 'open'); } catch (e) { /* blocked */ } }
const phone = () => typeof matchMedia === 'function' && matchMedia(PHONE).matches;

export function startChat(ws, { hub = null, hubEl = null, rewrite = null, asksHtml = () => '', noteOf = async () => {}, aiReady = () => ({ ready: false, why: '' }) } = {}) {
  const el = document.createElement('section');
  el.className = 'chat';
  el.setAttribute('aria-label', 'Chat');
  let items = [], sel = null, conv = null, err = '', listErr = '', sending = false, visible = false;
  let query = '', renaming = null, renameText = '', closed = loadSide(), drawer = false;
  let all = !!readJson(ALL_KEY, false), details = !!readJson(DETAILS_KEY, false);
  let options = null, optErr = '';
  let pick = { agent: '', model: '', ...readJson(PICK_KEY, {}) };
  let pop = null; // {kind: 'slash' | 'file' | 'agent' | 'model', items, i, q}
  let help = false, escAt = 0, note = '';
  const sessPick = {}; // session -> {agent, model}
  const drafts = {};
  const picked = {}; // draft key -> Set of @files picked from the popup
  const queue = {}; // session -> [{parsed, agent, model, files, text}]
  const echo = {}; // session (or NEW while starting) -> [{text, files, agent, base, at}]: sent, not stored by opencode yet
  const open = new Set(); // tool and thinking blocks flipped from their default
  const answers = {}, custom = {}; // question id -> per question: picked labels, typed answer
  const history = [];
  const pending = new Map(); // session -> item, for a chat just started that the connector has not listed yet
  let listTimer = 0, convTimer = 0, fileTimer = 0, noteTimer = 0;

  /* ---------- data ---------- */
  const key = () => sel || NEW;
  const listed = () => {
    const out = items.slice();
    for (const [sid, it] of pending) if (!out.some(c => c.session === sid)) out.push(it);
    return out;
  };
  const itemOf = sid => listed().find(c => c.session === sid) || null;
  const agents = () => (options && options.agents) || [];
  const echoing = sid => !!(echo[sid] && echo[sid].length);
  const echoTurns = sid => (echo[sid] || []).map(e => ({ id: '', role: 'you', text: e.text, agent: e.agent, parts: e.files.map(f => ({ type: 'file', name: f })) }));
  /* Working: opencode says so, or a message is on its way to it. */
  const working = () => !!(sel && ((conv && conv.busy) || echoing(sel)));
  /** The agents the picker offers here: New chat adds Hub and, with Rewrite a draft on hand, Rewrite at the top. */
  const agentChoices = () => (sel ? agents() : [HUB_AGENT, ...(rewrite ? [REWRITE_AGENT] : []), ...agents()]);
  function agentNow() {
    const want = sel ? (sessPick[sel] || {}).agent : pick.agent;
    const names = agentChoices().map(a => a.name);
    if (want && (names.includes(want) || !options)) return want;
    if (!sel && pick.agent === HUB) return HUB;
    if (!sel && rewrite && pick.agent === REWRITE) return REWRITE;
    return names.includes('build') ? 'build' : names.find(n => !MODES[n]) || (sel ? '' : HUB);
  }
  const modelNow = () => (sel ? ((sessPick[sel] || {}).model ?? pick.model) : pick.model) || '';
  function setPick(kind, value) {
    if (sel) sessPick[sel] = { agent: agentNow(), model: modelNow(), ...(sessPick[sel] || {}), [kind]: value };
    if (!(kind === 'agent' && MODES[value] && sel)) { pick = { ...pick, [kind]: value }; writeJson(PICK_KEY, pick); }
  }
  const hubMode = () => !sel && agentNow() === HUB;
  const rewriteMode = () => !sel && !!rewrite && agentNow() === REWRITE;
  /* New chat is for chatting: Rewrite stays picked only until you ask for a New chat. */
  function leaveRewrite() { if (pick.agent === REWRITE) { pick = { ...pick, agent: '' }; writeJson(PICK_KEY, pick); } }

  async function loadOptions() {
    if (!aiReady().ready) return;
    try { options = await ws.connectors.call(OC, 'chat.options', {}); optErr = ''; }
    catch (e) { optErr = e.message || "Couldn't read opencode's agents and models."; }
    draw();
  }
  async function loadList() {
    clearTimeout(listTimer);
    if (!aiReady().ready) { items = []; listErr = ''; draw(); return; }
    try {
      items = (await ws.connectors.call(OC, 'chat.list', all ? { all: true } : {})).items || [];
      listErr = '';
      for (const c of items) pending.delete(c.session);
    } catch (e) { listErr = e.message || "Couldn't list your chats."; }
    if (sel && hub) { const it = itemOf(sel); if (it && it.hub) hub.ensure(it); }
    if (!options && !optErr) loadOptions();
    draw();
    if (visible) listTimer = setTimeout(loadList, LIST_MS);
  }
  async function loadConv() {
    clearTimeout(convTimer);
    if (!sel) return;
    const want = sel;
    try {
      const r = await ws.connectors.call(OC, 'chat.messages', { session: want });
      if (sel !== want) return;
      conv = r; err = r.error || '';
      if (echo[want]) echo[want] = liveEchoes(echo[want], r.turns, { busy: !!r.busy });
      const row = itemOf(want); // keep the sidebar's spinner and dot in step without waiting for the list
      if (row) { row.busy = !!r.busy; row.waiting = !!r.waiting; }
      if (!sessPick[want]) sessPick[want] = { agent: r.agent || (r.from === 'hub' ? 'chat' : pick.agent === HUB ? '' : pick.agent), model: r.model ? modelKey(r.model) : pick.model };
    } catch (e) { if (sel === want) err = e.message || "Couldn't read this chat."; }
    draw();
    if (sel !== want) return;
    if (conv && !conv.busy && !conv.waiting && (queue[want] || []).length) { flush(want); return; }
    if (conv && (conv.busy || conv.waiting || (queue[want] || []).length || echoing(want)) && visible) convTimer = setTimeout(loadConv, BUSY_MS);
  }
  function select(session) {
    if (!session && hub) hub.clearDone();
    sel = session || null; conv = null; err = ''; renaming = null; pop = null; help = false; afterOpen = false;
    if (phone()) drawer = false;
    if (sel && hub) { const it = itemOf(sel); if (it && it.hub) hub.ensure(it); }
    draw();
    if (sel) loadConv();
    focusBox();
  }
  function focusBox() {
    if (rewriteMode()) { rewrite.focus(); return; }
    const box = hubMode() ? hubEl && hubEl.querySelector('.cap-in') : el.querySelector(`[data-keep="chat:${key()}"]`);
    if (box && !box.disabled) box.focus();
  }
  function flash(text) {
    note = text; draw();
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { note = ''; draw(); }, 2600);
  }

  /* ---------- doing things ---------- */
  const confirm = { confirm: true };
  function pickArgs() {
    const a = agentNow(), m = modelFromKey(modelNow());
    return { ...(a && !MODES[a] ? { agent: a } : {}), ...(m ? { model: m } : {}) };
  }
  async function send() {
    const k = key();
    const text = String(drafts[k] || '');
    const parsed = parseInput(text);
    if (parsed.kind === 'empty' || sending) return;
    pop = null;
    if (parsed.kind === 'builtin') { drafts[k] = ''; draw(); return builtin(parsed.name, parsed.args); }
    const files = parsed.kind === 'text' ? filesIn(text, picked[k]) : [];
    const job = { parsed, files, text: text.trim(), ...pickArgs() };
    history.push(text.trim());
    if (history.length > 50) history.shift();
    drafts[k] = ''; picked[k] = new Set();
    if (sel && ((conv && (conv.busy || conv.waiting)) || echoing(sel))) { (queue[sel] = queue[sel] || []).push(job); draw(); return; }
    await run(sel, job);
  }
  async function run(session, job) {
    const { parsed, files, agent, model } = job;
    const pickOf = { ...(agent ? { agent } : {}), ...(model ? { model } : {}) };
    const ek = session || NEW;
    const mine = { text: parsed.kind === 'text' ? parsed.text : job.text, files, agent: agent || null, base: !session ? 0 : conv ? (conv.turns || []).length : null, at: Date.now() };
    echo[ek] = [...(echo[ek] || []), mine];
    sending = true; err = ''; draw();
    try {
      let r = null;
      if (parsed.kind === 'shell') r = await ws.connectors.call(OC, 'chat.shell', { ...(session ? { session } : {}), command: parsed.command, ...pickOf }, confirm);
      else if (parsed.kind === 'command') r = await ws.connectors.call(OC, 'chat.command', { ...(session ? { session } : {}), name: parsed.name, args: parsed.args, ...pickOf }, confirm);
      else if (session) await ws.connectors.call(OC, 'chat.send', { session, text: parsed.text, ...pickOf, ...(files.length ? { files } : {}) }, confirm);
      else r = await ws.connectors.call(OC, 'chat.start', { text: parsed.text, ...pickOf, ...(files.length ? { files } : {}) }, confirm);
      const sid = session || (r && r.session);
      if (!session && sid) {
        sessPick[sid] = { agent: agent || '', model: model ? modelKey(model) : '' };
        pending.set(sid, { session: sid, from: 'you', title: job.text.replace(/\s+/g, ' ').slice(0, 80), at: Date.now(), last: Date.now(), busy: true });
        echo[sid] = (echo[NEW] || []).filter(e => e === mine); echo[NEW] = (echo[NEW] || []).filter(e => e !== mine);
        sending = false;
        select(sid);
        loadList();
        return;
      }
      if (sel === session && conv) conv = { ...conv, revert: null };
      setTimeout(loadConv, 400);
    } catch (e) {
      echo[ek] = (echo[ek] || []).filter(x => x !== mine);
      const msg = e.message || "Couldn't send that.";
      if (session && /still working/.test(msg)) { (queue[session] = queue[session] || []).unshift(job); setTimeout(loadConv, BUSY_MS); }
      else { err = msg; if (!drafts[key()]) drafts[key()] = job.text; }
    }
    sending = false; draw();
    focusBox();
  }
  function flush(session) {
    const job = (queue[session] || []).shift();
    if (job) run(session, job);
  }
  async function builtin(name, args) {
    const needChat = () => { if (!sel) { err = 'Open a chat first.'; draw(); return false; } return true; };
    err = '';
    if (name === 'new') return select(null);
    if (name === 'help') { help = !help; return draw(); }
    if (name === 'details') { details = !details; writeJson(DETAILS_KEY, details); open.clear(); return draw(); }
    if (name === 'models') return openPop('model');
    if (name === 'agents') return openPop('agent');
    if (name === 'sessions') { all = true; writeJson(ALL_KEY, all); if (closed) { closed = false; saveSide(false); } if (phone()) drawer = true; draw(); return loadList(); }
    if (name === 'terminal') {
      try { await ws.connectors.call(OC, 'terminal', sel ? { session: sel } : {}); flash('Opened in a terminal window.'); }
      catch (e) { ws.toast(e.message || "Couldn't open a terminal.", { kind: 'error' }); }
      return;
    }
    if (!needChat()) return;
    if (name === 'export') return noteOf(titleOf(sel), lastTandem((conv && conv.turns) || []) || ((hub && hub.intro(sel)) || {}).answer || '');
    try {
      if (name === 'undo') {
        const r = await ws.connectors.call(OC, 'chat.undo', { session: sel }, confirm);
        if (r && r.text && !drafts[sel]) drafts[sel] = r.text;
      } else if (name === 'redo') await ws.connectors.call(OC, 'chat.redo', { session: sel }, confirm);
      else if (name === 'compact') { const m = modelFromKey(modelNow()); await ws.connectors.call(OC, 'chat.compact', { session: sel, ...(m ? { model: m } : {}) }, confirm); }
    } catch (e) { err = e.message || `Couldn't ${name}.`; }
    draw();
    loadConv();
    focusBox();
  }
  async function stop() {
    if (!sel) return;
    if (queue[sel]) queue[sel] = [];
    try { await ws.connectors.call(OC, 'abort', { session: sel }, confirm); } catch (e) { ws.toast(e.message || "Couldn't stop it.", { kind: 'error' }); }
    loadConv();
  }
  async function answer(args) {
    try { await ws.connectors.call(OC, 'answer', args, confirm); }
    catch (e) { ws.toast(e.message || "Couldn't answer that.", { kind: 'error' }); }
    loadConv();
  }
  async function remove(session) {
    try { await ws.connectors.call(OC, 'chat.remove', { session }); } catch (e) { ws.toast(e.message || "Couldn't remove that.", { kind: 'error' }); return; }
    pending.delete(session);
    items = items.filter(c => c.session !== session);
    if (sel === session) select(null); else draw();
    loadList();
  }
  async function rename() {
    const session = renaming, title = renameText.replace(/\s+/g, ' ').trim();
    renaming = null;
    const it = itemOf(session);
    if (!session || !title || !it || title === it.title) { draw(); return; }
    it.title = title.slice(0, 80);
    draw();
    try { await ws.connectors.call(OC, 'chat.rename', { session, title: it.title }); }
    catch (e) { ws.toast(e.message || "Couldn't rename that.", { kind: 'error' }); }
    loadList();
  }
  function titleOf(sid) { const c = itemOf(sid) || conv || {}; return c.title || 'Chat'; }
  /** A flow card under the answer (Loom flow cards v1): Loom's Start work on that flow, filled in with the chat's ask. */
  function openFlow(id) { ws.open({ app: 'slate', path: flowRoute(id, titleOf(sel)) }).catch(() => ws.toast('Turn Loom on in Settings, Apps.', { kind: 'warn' })); }
  function toggleSide() {
    if (phone()) drawer = !drawer;
    else { closed = !closed; saveSide(closed); }
    draw();
    if (!closed || drawer) { const s = el.querySelector('[data-chat-search]'); if (s && drawer) s.focus(); }
  }

  /* ---------- the popups: / commands, @ files, agents, models ---------- */
  function openPop(kind) {
    if (kind === 'agent') {
      const list = agentChoices();
      pop = { kind, items: list.map(a => ({ value: a.name, label: MODES[a.name] || a.name, desc: a.description || '' })), i: Math.max(0, list.findIndex(a => a.name === agentNow())), q: '' };
    } else if (kind === 'model') pop = { kind, items: modelItems(''), i: 0, q: '' };
    draw();
    const q = el.querySelector('[data-pop-q]');
    if (q) q.focus(); else { const b = el.querySelector('[data-pop-i].on') || el.querySelector('[data-pop-i]'); if (b) b.focus(); }
  }
  function modelItems(q) {
    const list = matchModels(q, (options && options.models) || []);
    const out = q ? [] : [{ value: '', label: 'Default model', desc: "The agent's or opencode's own choice" }];
    return out.concat(list.slice(0, 200).map(m => ({ value: modelKey(m), label: m.name, desc: m.providerName })));
  }
  function popFromInput(t) {
    const p = popupFor(t.value, t.selectionStart);
    if (!p) { if (pop && (pop.kind === 'slash' || pop.kind === 'file')) { pop = null; draw(); } return; }
    if (p.kind === 'slash') {
      const list = matchCommands(p.q, (options && options.commands) || []);
      pop = list.length ? { kind: 'slash', items: list.map(c => ({ value: c.name, label: '/' + c.name, desc: c.description || '' })), i: 0, q: p.q } : null;
      draw();
      return;
    }
    clearTimeout(fileTimer);
    const want = p.q;
    fileTimer = setTimeout(async () => {
      try {
        const r = await ws.connectors.call(OC, 'chat.files', { query: want });
        const box = el.querySelector(`[data-keep="chat:${key()}"]`);
        const now = box && popupFor(box.value, box.selectionStart);
        if (!now || now.kind !== 'file' || now.q !== want) return;
        const files = (r && r.files) || [];
        pop = files.length ? { kind: 'file', items: files.map(f => ({ value: f, label: f, desc: '' })), i: 0, q: want, start: now.start } : null;
      } catch (e) { pop = null; }
      draw();
    }, 140);
  }
  function choose(i) {
    if (!pop) return;
    const it = pop.items[i];
    const kind = pop.kind;
    pop = null;
    if (!it) return draw();
    const k = key();
    if (kind === 'agent') { setPick('agent', it.value); draw(); return focusBox(); }
    if (kind === 'model') { setPick('model', it.value); draw(); return focusBox(); }
    if (kind === 'slash') {
      if (BUILTINS.some(b => b.name === it.value)) { drafts[k] = ''; draw(); return builtin(it.value, ''); }
      drafts[k] = `/${it.value} `;
    } else if (kind === 'file') {
      const box = el.querySelector(`[data-keep="chat:${k}"]`);
      const t = String(drafts[k] || ''), caret = box ? box.selectionStart : t.length;
      const p = popupFor(t, caret);
      if (p && p.kind === 'file') drafts[k] = `${t.slice(0, p.start)}@${it.value} ${t.slice(caret)}`;
      (picked[k] = picked[k] || new Set()).add(it.value);
    }
    draw();
    const box = el.querySelector(`[data-keep="chat:${k}"]`);
    if (box) { box.value = drafts[k]; box.focus(); const end = kind === 'file' ? drafts[k].length : box.value.length; try { box.setSelectionRange(end, end); } catch (e) { /* not a text field */ } }
  }
  function popHtml() {
    if (!pop) return '';
    const title = { slash: 'Commands', file: 'Files', agent: 'Agent', model: 'Model' }[pop.kind];
    const search = pop.kind === 'model' ? `<input class="pop-q" data-keep="chat-pop-q" data-pop-q placeholder="Search models" aria-label="Search models" value="${esc(pop.q)}">` : '';
    const cur = pop.kind === 'agent' ? agentNow() : pop.kind === 'model' ? modelNow() : null;
    const rows = pop.items.map((it, i) => `<li><button type="button" class="pop-it${i === pop.i ? ' on' : ''}${cur != null && it.value === cur ? ' cur' : ''}" data-pop-i="${i}" role="option" aria-selected="${i === pop.i}"><span class="pop-l">${esc(it.label)}</span>${it.desc ? `<span class="pop-d">${esc(it.desc)}</span>` : ''}</button></li>`).join('');
    const empty = !pop.items.length ? '<p class="pop-none">Nothing matches.</p>' : '';
    return `<div class="pop" data-pop><p class="pop-t">${title}</p>${search}<ul role="listbox" aria-label="${title}">${rows}</ul>${empty}</div>`;
  }

  /* ---------- drawing ---------- */
  function rowHtml(c) {
    if (renaming === c.session) {
      return `<li class="chat-row renaming"><input class="chat-rename" data-keep="chat-rename" data-chat-rename-box value="${esc(renameText)}" aria-label="Name this chat" maxlength="80"></li>`;
    }
    const outside = c.from === 'opencode';
    return `<li class="chat-row${c.session === sel ? ' on' : ''}${outside ? ' outside' : ''}"><button type="button" class="chat-item${c.session === sel ? ' on' : ''}" data-chat-open="${esc(c.session)}"${c.session === sel ? ' aria-current="true"' : ''}>` +
      `<span class="chat-t">${c.busy ? '<span class="spin" aria-hidden="true"></span>' : ''}${esc(c.title)}</span>` +
      (c.waiting ? '<span class="chat-dot" title="opencode is asking you something"><span class="sr">Needs you</span></span>' : '') + '</button>' +
      `<span class="chat-acts"><button type="button" class="chat-act" data-chat-rename="${esc(c.session)}" title="Rename" aria-label="Rename ${esc(c.title)}">${ICON.pen}</button>` +
      (outside ? '' : `<button type="button" class="chat-act" data-chat-remove="${esc(c.session)}" title="Remove from this list. The opencode session is kept." aria-label="Remove ${esc(c.title)}">${ICON.x}</button>`) + '</span></li>';
  }
  function sideHtml() {
    const every = listed();
    const shown = every.filter(c => matchChat(c, query));
    const groups = groupChats(shown);
    const list = groups.map(g => `<h3 class="chat-h">${esc(g.label)}</h3><ul>${g.items.map(rowHtml).join('')}</ul>`).join('');
    const empty = !every.length
      ? (aiReady().ready ? '<p class="chat-empty">Your chats show here. Send a message to start one.</p>' : `<p class="chat-empty">${esc(aiReady().why || 'Turn on the opencode connector in Settings to talk to opencode.')}</p>`)
      : !shown.length ? `<p class="chat-empty">No chats match "${esc(query)}".</p>` : '';
    return `<aside class="chat-side" aria-label="Chats">` +
      `<div class="chat-side-top"><button type="button" class="chat-newbtn${sel ? '' : ' on'}" data-chat-new>${ICON.plus}<span>New chat</span></button>` +
      `<button type="button" class="chat-icon" data-chat-side title="Close sidebar" aria-label="Close sidebar">${ICON.side}</button></div>` +
      `<div class="chat-find"><input type="search" class="chat-search" data-keep="chat-search" data-chat-search placeholder="${all ? 'Search all sessions' : 'Search chats'}" aria-label="Search chats" value="${esc(query)}">` +
      `<button type="button" class="chat-all${all ? ' on' : ''}" data-chat-all="${all ? '0' : '1'}" aria-pressed="${all}" title="${all ? 'Showing every opencode session (runs, PR reviews, the terminal). Click for just your chats.' : 'Show every opencode session in the workspace: runs, PR reviews and the terminal'}">All</button></div>` +
      (listErr ? `<p class="hub-error">${esc(listErr)}</p>` : '') +
      `<nav class="chat-list">${list}${empty}</nav></aside>`;
  }
  function topHtml(title, extra = '') {
    const sideBtn = closed || phone()
      ? `<button type="button" class="chat-icon" data-chat-side title="Open sidebar" aria-label="Open sidebar">${ICON.side}</button>` +
        (sel ? `<button type="button" class="chat-icon" data-chat-new title="New chat" aria-label="New chat">${ICON.plus}</button>` : '')
      : '';
    return `<header class="chat-top">${sideBtn}<h2>${esc(title)}</h2>${extra}</header>`;
  }
  function picksHtml() {
    const a = agentNow();
    const models = (options && options.models) || [];
    return `<button type="button" class="pick pick-agent${MODES[a] ? ' hub' : ''}" data-pick="agent" title="Agent (Tab switches)" aria-haspopup="listbox"><span>${esc(MODES[a] || a || 'Default agent')}</span>${ICON.caret}</button>` +
      (MODES[a] ? '' : `<button type="button" class="pick" data-pick="model" title="Model" aria-haspopup="listbox"><span>${esc(modelLabel(modelNow(), models))}</span>${ICON.caret}</button>`);
  }
  function composeHtml() {
    const k = key();
    const off = !aiReady().ready;
    const busy = working();
    const draft = drafts[k] || '';
    const shell = /^\s*!/.test(draft);
    const q = sel ? (queue[sel] || []).length : 0;
    const ctx = sel && conv && conv.totals ? [conv.totals.context ? `${tokens(conv.totals.context)} context` : '', money(conv.totals.cost)].filter(Boolean).join(' · ') : '';
    const hint = off ? esc(aiReady().why || 'opencode is not connected.')
      : note ? esc(note)
      : escAt && busy && Date.now() - escAt < 1500 ? 'Press Esc again to stop.'
      : shell ? 'Shell: runs in the workspace through opencode.'
      : q ? `${q} message${q === 1 ? '' : 's'} queued. ${q === 1 ? 'It goes' : 'They go'} when opencode is done.`
      : sel ? '' : 'Enter sends · Tab agent · / commands · @ files · ! shell';
    const action = busy && !draft.trim()
      ? `<button type="button" class="chat-send stop" data-chat-stop title="Stop (Esc twice)" aria-label="Stop">${ICON.stop}</button>`
      : `<button type="button" class="chat-send" data-chat-send title="${busy ? 'Queue' : 'Send'}" aria-label="${busy ? 'Queue' : 'Send'}"${off || sending ? ' disabled' : ''}>${ICON.up}</button>`;
    return `<div class="chat-compose"><div class="chat-col pop-anchor">${popHtml()}<div class="chat-box${shell ? ' shell' : ''}">` +
      `<textarea rows="1" data-keep="chat:${esc(k)}" placeholder="${off ? 'opencode is not connected' : sel ? 'Message opencode' : 'Ask anything, or / for commands'}" aria-label="Message to opencode"${off ? ' disabled' : ''}>${esc(draft)}</textarea>` +
      `<div class="chat-bar">${picksHtml()}<span class="grow"></span>${ctx ? `<span class="chat-ctx">${esc(ctx)}</span>` : ''}${action}</div></div>` +
      `<p class="chat-hint" aria-live="polite">${hint}</p></div></div>`;
  }
  function helpHtml() {
    if (!help) return '';
    const cmds = matchCommands('', (options && options.commands) || []);
    return `<div class="chat-help"><h3>Keys</h3><dl>${HELP.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` +
      `<h3>Commands</h3><dl>${cmds.map(c => `<dt>/${esc(c.name)}</dt><dd>${esc(c.description || '')}</dd>`).join('')}</dl>` +
      '<p class="hub-meta">opencode\'s own permission settings decide what an agent may do without asking, as in the terminal.</p></div>';
  }
  function headBtns(busy) {
    const icon = (b, name, title) => `<button type="button" class="chat-icon" data-builtin="${name}" title="${title}" aria-label="${title}">${b}</button>`;
    return `<span class="row">` + icon(ICON.undo, 'undo', 'Undo the last message (/undo)') +
      (conv && conv.revert ? icon(ICON.redo, 'redo', 'Redo (/redo)') : '') +
      icon(ICON.compact, 'compact', 'Compact this chat (/compact)') + icon(ICON.term, 'terminal', 'Open in the opencode terminal') +
      (busy ? '<button type="button" class="btn ghost" data-chat-stop>Stop</button>' : '') + '</span>';
  }
  /* Under the last answer: one quiet Start work... button; its menu has the flow cards and Save as note (Chat 2.3.0). */
  let afterOpen = false;
  function afterHtml() {
    const menu = afterOpen ? `<div class="chat-after-menu" role="menu">${flowCardsHtml(titleOf(sel), 'data-chat-flow')}<button class="btn ghost" type="button" data-builtin="export">Save as note</button></div>` : '';
    return `<div class="chat-after"><button type="button" class="btn ghost chat-after-btn${afterOpen ? ' on' : ''}" data-chat-after aria-expanded="${afterOpen}">Start work...</button>${menu}</div>`;
  }
  function paneHtml() {
    if (!sel && rewriteMode()) return `<div class="chat-pane chat-home is-rw">${topHtml('Rewrite a draft')}<div class="chat-rw" data-rw-home></div></div>`;
    if (!sel && echoing(NEW)) {
      return `<div class="chat-pane">${topHtml('New chat')}<div class="chat-scroll" data-chat-follow><div class="chat-col"><div class="turns">` +
        richRows(echoTurns(NEW), { busy: true, activity: 'Starting' }) + '</div></div></div>' + composeHtml() + '</div>';
    }
    if (!sel) {
      const hubOn = hubMode();
      const errs = (optErr ? `<p class="hub-error">${esc(optErr)}</p>` : '') + (err ? `<p class="hub-error">${esc(err)}</p>` : '');
      // Hub sits in the same composer at the bottom as every agent (Chat 2.3.0); its captures show just above it.
      const hubCompose = `<div class="chat-compose"><div class="chat-col pop-anchor hub-anchor">${popHtml()}<div class="chat-box hub-box">` +
        `<div class="chat-hub" data-hub-home></div><div class="chat-bar">${picksHtml()}<span class="grow"></span></div></div>` +
        `<p class="chat-hint" aria-live="polite">Enter sends · Tab agent</p></div></div>`;
      return `<div class="chat-pane chat-home${hubOn ? ' is-hub' : ''}">${topHtml('New chat')}<div class="chat-scroll"><div class="chat-col chat-start">` +
        `<h3 class="chat-hello">${hubOn ? 'What do you want to ask or capture?' : 'What are we working on?'}</h3>` +
        helpHtml() + errs + '</div></div>' + (hubOn ? hubCompose : '<div class="chat-hub" data-hub-home hidden></div>' + composeHtml()) + '</div>';
    }
    const busy = working();
    const c = itemOf(sel) || conv || {};
    const fromHub = c.from === 'hub' || (conv && conv.from === 'hub') || !!c.hub;
    const head = topHtml(c.title || (conv && conv.title) || 'Chat', headBtns(busy));
    const later = (conv && conv.turns) || [];
    const first = fromHub && hub ? hub.intro(sel, { actions: !later.length }) : null;
    let rows = '';
    if (first) {
      rows += youTurn(first.text);
      rows += first.running ? WRITING : tandemTurn(first.html);
    } else if (fromHub) {
      rows += youTurn(c.title || '');
      rows += '<p class="hub-meta">Loading the answer...</p>';
    }
    const { shown, undone } = splitRevert(later, conv && conv.revert);
    rows += richRows(shown.concat(echoTurns(sel)), { open, details, busy: busy && !(first && first.running), activity: (conv && conv.activity) || (echoing(sel) ? 'Sending' : '') });
    if (undone) rows += `<p class="divider undo"><span>Undid ${undone} message${undone === 1 ? '' : 's'} and ${undone === 1 ? 'its' : 'their'} changes. <button type="button" class="lnk" data-builtin="redo">Redo</button> brings ${undone === 1 ? 'it' : 'them'} back; your next message drops ${undone === 1 ? 'it' : 'them'}.</span></p>`;
    for (const job of queue[sel] || []) rows += `<div class="turn you queued"><span class="who">You, queued</span><div class="tx">${esc(job.text)}</div><span class="you-agent">Queued</span></div>`;
    if (!conv && !first && !fromHub && !echoing(sel)) rows += '<p class="hub-meta">Loading...</p>';
    if (conv && Array.isArray(conv.prompts)) rows += conv.prompts.map(p => promptHtml(p, { answers, custom })).join('');
    else if (conv && conv.waiting) rows += asksHtml(sel) || '<p class="hub-meta">opencode is asking you something. Answer it in Loom\'s Inbox.</p>';
    if (conv && !busy && later.length && lastTandem(later)) rows += afterHtml();
    if (err) rows += `<p class="hub-error">${esc(err)}</p>`;
    return `<div class="chat-pane">${head}<div class="chat-scroll" data-chat-follow><div class="chat-col">${helpHtml()}<div class="turns">${rows}</div></div></div>${composeHtml()}</div>`;
  }
  /* Put Rewrite a draft's element in its pane, redrawing it when the picker it shows changed. `force`: it was just
     moved, so draw it now and put focus back where it was. */
  let rwBar = null, rwSeen = false;
  function mountRewrite(force = false, focus = null) {
    if (!rewrite || !el.isConnected) return;
    const home = el.querySelector('[data-rw-home]');
    if (!home) { rwBar = null; return; }
    const moved = !home.contains(rewrite.el);
    if (moved) home.appendChild(rewrite.el);
    const now = picksHtml() + popHtml();
    if (!rwSeen) { rwSeen = true; rwBar = now; rewrite.shown(); }
    else if (moved || force || now !== rwBar) { rwBar = now; rewrite.paint(); }
    if (focus) {
      const box = rewrite.el.querySelector(`[data-keep="${focus.key}"]`);
      if (box) { box.focus(); if (focus.range) try { box.setSelectionRange(focus.range[0], focus.range[1]); } catch (e) { /* not a text field */ } }
    }
  }
  /* Put the hub's element in the New chat pane, keeping focus and the caret if it was being typed in. */
  function mountHub() {
    mountRewrite();
    if (!hubEl || !el.isConnected) return;
    const home = el.querySelector('[data-hub-home]');
    if (!home || home.contains(hubEl)) return;
    const a = document.activeElement, mine = a && hubEl.contains(a) ? a : null;
    const range = mine && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
    home.appendChild(hubEl);
    if (mine) { mine.focus(); if (range) try { mine.setSelectionRange(range[0], range[1]); } catch (e) { /* not a text field */ } }
  }
  /* The chat fills the window under the page's header (chat.css, .chat). */
  function fit() {
    if (!el.isConnected) return;
    const top = Math.max(0, Math.round(el.getBoundingClientRect().top + (window.scrollY || 0)));
    el.style.setProperty('--chat-top', (top + 20) + 'px');
  }
  if (typeof window !== 'undefined') window.addEventListener('resize', () => { if (visible) fit(); });
  function grow(t) { if (!t) return; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 260) + 'px'; }
  let lastHtml = null, lastFirst = null;
  function draw() {
    el.classList.toggle('side-closed', closed);
    el.classList.toggle('drawer-open', drawer);
    const html = sideHtml() + paneHtml() + (drawer ? '<div class="chat-scrim" data-chat-side></div>' : '');
    if (html === lastHtml && el.firstChild === lastFirst && el.firstChild) { mountHub(); return; }
    const scroller = el.querySelector('[data-chat-follow]');
    const atEnd = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    const keepTop = scroller && !atEnd ? scroller.scrollTop : null;
    const a = document.activeElement, inHub = hubEl && a && hubEl.contains(a) ? a : null;
    const range = inHub && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
    const popFocus = a && el.contains(a) && a.hasAttribute && a.hasAttribute('data-pop-i') ? a.getAttribute('data-pop-i') : null;
    const inRw = rewrite && a && rewrite.el.contains(a) && a.getAttribute('data-keep') ? { key: a.getAttribute('data-keep'), range: typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null } : null;
    const back = keepFocus(el);
    if (hubEl && el.contains(hubEl)) hubEl.remove();
    if (rewrite && el.contains(rewrite.el)) rewrite.el.remove();
    el.innerHTML = html;
    lastHtml = html; lastFirst = el.firstChild;
    back();
    mountRewrite(true, inRw);
    if (popFocus != null) { const b = el.querySelector(`[data-pop-i="${popFocus}"]`); if (b) b.focus(); }
    mountHub();
    if (inHub && hubEl.contains(inHub)) { inHub.focus(); if (range) try { inHub.setSelectionRange(range[0], range[1]); } catch (e) { /* not a text field */ } }
    grow(el.querySelector(`[data-keep="chat:${key()}"]`));
    const s = el.querySelector('[data-chat-follow]');
    if (s) s.scrollTop = atEnd ? s.scrollHeight : keepTop;
    const on = el.querySelector('.pop-it.on');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  }

  /* ---------- input ---------- */
  el.addEventListener('input', e => {
    const t = e.target;
    const k = t.getAttribute && t.getAttribute('data-keep');
    if (k && k.startsWith('chat:')) {
      const was = /^\s*!/.test(drafts[k.slice(5)] || '');
      drafts[k.slice(5)] = t.value; grow(t);
      popFromInput(t);
      if (was !== /^\s*!/.test(t.value)) draw();
    } else if (k === 'chat-search') { query = t.value; draw(); }
    else if (k === 'chat-rename') renameText = t.value;
    else if (k === 'chat-pop-q' && pop) { pop.q = t.value; pop.items = modelItems(t.value); pop.i = 0; draw(); }
    else if (t.hasAttribute && t.hasAttribute('data-q-custom')) { const id = t.getAttribute('data-q-custom'); (custom[id] = custom[id] || {})[+t.getAttribute('data-qi')] = t.value; }
  });
  function popKeys(e) {
    if (!pop) return false;
    const n = pop.items.length;
    if (e.key === 'ArrowDown' && n) { pop.i = (pop.i + 1) % n; draw(); return true; }
    if (e.key === 'ArrowUp' && n) { pop.i = (pop.i - 1 + n) % n; draw(); return true; }
    if ((e.key === 'Enter' || e.key === 'Tab') && n) { choose(pop.i); return true; }
    if (e.key === 'Escape') { pop = null; draw(); focusBox(); return true; }
    return false;
  }
  el.addEventListener('keydown', e => {
    const t = e.target;
    if (!t.matches) return;
    if (t.matches('[data-keep^="chat:"]')) {
      if (e.isComposing) return;
      if ((pop && (pop.kind === 'slash' || pop.kind === 'file')) && popKeys(e)) { e.preventDefault(); return; }
      if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setPick('agent', cycleAgent(agentChoices(), agentNow(), e.shiftKey));
        draw(); focusBox(); return;
      }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); return; }
      if (e.key === 'ArrowUp' && !t.value && history.length) { e.preventDefault(); drafts[key()] = history[history.length - 1]; draw(); return; }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (sel && conv && conv.busy) {
          if (Date.now() - escAt < 1500) { escAt = 0; stop(); } else { escAt = Date.now(); draw(); setTimeout(draw, 1600); }
        } else t.blur();
        return;
      }
    } else if (hubEl && t.matches('.cap-in') && hubEl.contains(t)) {
      if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing) {
        e.preventDefault();
        setPick('agent', cycleAgent(agentChoices(), agentNow(), e.shiftKey));
        draw(); focusBox();
      } else if (e.key === 'Escape' && pop) { e.preventDefault(); pop = null; draw(); focusBox(); }
    } else if (t.matches('[data-rw-input]')) {
      if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing) {
        e.preventDefault();
        setPick('agent', cycleAgent(agentChoices(), agentNow(), e.shiftKey));
        draw(); focusBox();
      } else if (e.key === 'Escape' && pop) { e.preventDefault(); pop = null; draw(); focusBox(); }
    } else if (t.matches('[data-pop-q]') || t.matches('[data-pop-i]')) {
      if (popKeys(e)) { e.preventDefault(); if (t.matches('[data-pop-i]')) { const b = el.querySelector('.pop-it.on'); if (b) b.focus(); } }
    } else if (t.matches('[data-chat-rename-box]')) {
      if (e.key === 'Enter') { e.preventDefault(); rename(); }
      else if (e.key === 'Escape') { e.preventDefault(); renaming = null; draw(); }
    } else if (t.matches('[data-chat-search]') && e.key === 'Escape' && query) { e.preventDefault(); query = ''; draw(); }
  });
  el.addEventListener('focusout', e => {
    if (e.target.matches && e.target.matches('[data-chat-rename-box]') && renaming) setTimeout(() => { if (renaming) rename(); }, 0);
    // A picker closes when focus leaves it.
    if (pop && (pop.kind === 'agent' || pop.kind === 'model')) setTimeout(() => { const a = document.activeElement; if (pop && !(a && a.closest && a.closest('[data-pop]'))) { pop = null; draw(); } }, 0);
  });
  el.addEventListener('mousedown', e => { if (e.target.closest && e.target.closest('[data-pop-i]')) e.preventDefault(); });
  el.addEventListener('click', e => {
    const b = e.target.closest('button,[data-chat-side]');
    if (!b || (hubEl && hubEl.contains(b))) return;
    // A button in a hub chat's first answer (a flow card, Save as note, a suggested action, a choice).
    if (hub && b.closest('.hub-intro') && hub.click(b)) return;
    const d = b.dataset;
    if (d.chatOpen != null) select(d.chatOpen);
    else if (d.chatNew != null) { leaveRewrite(); select(null); loadOptions(); }
    else if (d.chatSide != null) toggleSide();
    else if (d.chatSend != null) send();
    else if (d.chatStop != null) stop();
    else if (d.chatRemove != null) remove(d.chatRemove);
    else if (d.chatAll != null) { all = d.chatAll === '1'; writeJson(ALL_KEY, all); draw(); loadList(); }
    else if (d.chatRename != null) {
      renaming = d.chatRename; renameText = (itemOf(renaming) || {}).title || '';
      draw();
      const box = el.querySelector('[data-chat-rename-box]');
      if (box) { box.focus(); box.select(); }
    }
    else if (d.chatAfter != null) { afterOpen = !afterOpen; draw(); }
    else if (d.chatFlow != null) { afterOpen = false; openFlow(d.chatFlow); }
    else if (d.builtin != null) { if (d.builtin === 'export') afterOpen = false; builtin(d.builtin, ''); }
    else if (d.pick != null) { if (pop && pop.kind === d.pick) { pop = null; draw(); } else openPop(d.pick); }
    else if (d.popI != null) choose(+d.popI);
    else if (d.tool != null) { if (open.has(d.tool)) open.delete(d.tool); else open.add(d.tool); draw(); }
    else if (d.copy != null) {
      const code = b.parentElement && b.parentElement.querySelector('code');
      if (code && navigator.clipboard) navigator.clipboard.writeText(code.textContent).then(() => ws.toast('Copied.', { kind: 'success' }), () => {});
    }
    else if (d.perm != null) answer({ kind: 'permission', id: d.id, reply: d.perm });
    else if (d.qPick != null) {
      const p = ((conv && conv.prompts) || []).find(x => x.id === d.qPick);
      const qi = +d.qi, q = p && p.questions[qi];
      if (!q) return;
      const mine = ((answers[p.id] = answers[p.id] || [])[qi] = answers[p.id][qi] || []);
      const i = mine.indexOf(d.label);
      if (q.multiple) { if (i >= 0) mine.splice(i, 1); else mine.push(d.label); }
      else answers[p.id][qi] = i >= 0 ? [] : [d.label];
      draw();
    }
    else if (d.qSend != null) {
      const p = ((conv && conv.prompts) || []).find(x => x.id === d.qSend);
      if (p) answer({ kind: 'question', id: p.id, answers: questionAnswers(p, answers, custom) });
    }
    else if (d.qReject != null) answer({ kind: 'question', id: d.qReject, reject: true });
  });

  if (rewrite) rewrite.setBar({ picks: picksHtml, pop: popHtml });
  draw();
  return {
    el,
    /* main.js calls this when Chat comes into view or leaves it. */
    show(on) {
      if (on) { mountHub(); fit(); }
      if (on === visible) return;
      visible = on;
      clearTimeout(listTimer); clearTimeout(convTimer);
      if (on) { loadList(); loadOptions(); if (sel) loadConv(); }
    },
    mountHub,
    /* Open one chat (#/chat/<session>, an Inbox Open); null: New chat. `hub`: New chat with the hub's box. */
    open(session, { hub: wantHub = false, rewrite: wantRewrite = false } = {}) {
      if (!session && (wantHub || wantRewrite)) { pick = { ...pick, agent: wantRewrite && rewrite ? REWRITE : HUB }; writeJson(PICK_KEY, pick); }
      else if (!session) leaveRewrite();
      select(session); loadList();
    },
    /* The hub turned a message into a chat: list it now and open it. */
    opened(card) {
      if (!card || !card.session) return;
      if (!items.some(c => c.session === card.session)) pending.set(card.session, { session: card.session, from: 'hub', hub: card.id, title: String(card.text || 'Chat').replace(/\s+/g, ' ').trim().slice(0, 80), at: card.at, last: card.at, busy: card.state === 'running' });
      select(card.session);
      loadList();
    },
    /* A hub card changed, or AI was turned on or off (main.js, hub.js): redraw. */
    redraw() { draw(); },
    refresh() { loadList(); loadOptions(); }
  };
}
