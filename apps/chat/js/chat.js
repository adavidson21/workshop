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

   - The workbench (Chat 4.0.0, bench.js): a panel beside the chat with a Terminal, Files to browse and edit the
     workspace, and a Side chat for questions that should not land in the chat. Ctrl+` opens the terminal. A file a
     tool read or changed has an Open button that shows it in Files.
   - Pictures (Chat 4.0.0, images.js): paste or drop one into the composer and it goes with the message; pictures in
     the thread are read with chat.image and set after drawing (paint), so the HTML never carries them.

   Everything goes through the opencode connector's chat.*, term.* and files.* actions; a message, a command or a
   click is the only thing that makes opencode act, and opencode's own permission settings decide what an agent may
   do, exactly as in the terminal. The sidebar and the chat are drawn into their own element, so typing survives
   repaints (keepFocus); the workbench is a separate element they never redraw. */
import { placeName } from '../../../shared/sent.js';
import { esc, flowCardsHtml, flowRoute } from './hub-model.js';
import { WRITING, groupChats, keepFocus, lastTandem, liveEchoes, matchChat, tandemTurn, youTurn } from './thread.js';
import { BUILTINS, HELP, transcript, turnText, cycleAgent, filesIn, matchCommands, matchModels, modelFromKey, modelKey, modelLabel, money, parseInput, popupFor, promptClick, promptHtml, richRows, splitRevert, tokens } from './parts.js';
import { startBench } from './bench.js';
import { startTerminal } from './terminal.js';
import { startFiles } from './files.js';
import { startSide } from './side.js';
import { startChanges } from './changes.js';
import { ALERTS_KEY, alertText, alertsState, chatEvents, chatKey, nextNeedy, stepChat } from './alerts.js';
import { startSplit } from './split.js';
import { MAX_DOCS, addPictures, chipsHtml, docsIn, picturesIn, uploadDoc } from './images.js';
import { morph } from './morph.js';
import { withLive, pruneLive } from './live.js';

const OC = 'opencode';
const LIST_MS = 10000;
const BUSY_MS = 1000;
const QUIET_MS = 3000; // the poll while the connector streams the chat to this page (Chat 4.5.0): its events do the work
const cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const SIDE_KEY = 'builds.runs.chatSide';
const PICK_KEY = 'chat.pick';
const ALL_KEY = 'chat.all';
const DETAILS_KEY = 'chat.details';
const PHONE = '(max-width: 820px)';
const NEW = '__new';
const HUB = 'hub';
const HUB_AGENT = { name: HUB, description: 'Ask Tandem, or capture a task, receipt or note for your apps' };
const REWRITE = 'rewrite';
const REWRITE_AGENT = { name: REWRITE, description: 'Rewrite a draft in your voice for an audience' };
// Quick (Chat 4.5.0, the connector's chat.quick): a fast answer from your notes, looked up in code and asked once with
// no tools. Unlike Hub and Rewrite it works in any chat, and its follow ups stay quick until you pick another agent.
const QUICK = 'quick';
const QUICK_AGENT = { name: QUICK, description: 'Fast answer from your notes: one model call, no tools' };
const QUICK_RAN = new Set(['quick', 'plan']); // the agents chat.quick sends with (Tandem's quick, else plan)
const MODES = { [HUB]: 'Hub', [REWRITE]: 'Rewrite', [QUICK]: 'Quick' }; // Chat's own modes, not opencode agents

const ICON = {
  side: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="9.5" y1="4.5" x2="9.5" y2="19.5" stroke="currentColor" stroke-width="1.6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>',
  pen: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path d="M4 20h4L19 9l-4-4L4 16z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"/></svg>',
  // Chat 4.1.0: archive, open beside, Changes, Second chat, attach.
  box: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path d="M4 7h16v3H4zM5.5 10v8.5h13V10M10 13.5h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  beside: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><rect x="3.5" y="5" width="17" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 5v14" stroke="currentColor" stroke-width="1.6"/></svg>',
  changes: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false"><path d="M7 4v10M2 9h10M14 18h8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M15 4l5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  clip: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false"><path d="M20 11.5l-7.8 7.8a5 5 0 01-7-7L13 4.5a3.3 3.3 0 014.7 4.7l-7.6 7.6a1.7 1.7 0 01-2.4-2.4l7-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  up: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M12 19V6M6 11l6-6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  stop: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/></svg>',
  undo: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false"><path d="M9 14L4 9l5-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 9h10a6 6 0 010 12h-3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  redo: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false"><path d="M15 14l5-5-5-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 9H10a6 6 0 000 12h3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  compact: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false"><path d="M8 4l4 4 4-4M8 20l4-4 4 4M4 12h16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  term: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false"><rect x="3" y="4.5" width="18" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 10l3 2.5L7 15M12.5 15H17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  files: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false"><path d="M6 3.5h8l4 4V20a.5.5 0 01-.5.5h-11A.5.5 0 016 20z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 3.5V8h4M9 12.5h6M9 16h6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  side: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false"><path d="M4 5.5h10a2 2 0 012 2V13a2 2 0 01-2 2H9l-3.5 3v-3H4a2 2 0 01-2-2V7.5a2 2 0 012-2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M18.5 9.5H20a2 2 0 012 2V17a2 2 0 01-2 2h-1.5v2.5L15.5 19H12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
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
  // The sidebar and the chat are drawn into `core` (display: contents, so they stay cells of .chat's grid); the
  // workbench beside them is its own element, never redrawn.
  const core = document.createElement('div');
  core.className = 'chat-core';
  el.appendChild(core);
  let items = [], sel = null, conv = null, err = '', listErr = '', sending = false, visible = false;
  let query = '', renaming = null, renameText = '', closed = loadSide(), drawer = false;
  let all = !!readJson(ALL_KEY, false), details = !!readJson(DETAILS_KEY, false);
  let options = null, optErr = '';
  let pick = { agent: '', model: '', ...readJson(PICK_KEY, {}) };
  let pop = null; // {kind: 'slash' | 'file' | 'agent' | 'model', items, i, q}
  let help = false, escAt = 0, note = '';
  let status = null; // /status (Chat 4.6.0): opencode's MCP servers, language servers and formatters, while shown
  const sessPick = {}; // session -> {agent, model}
  const drafts = {};
  const picked = {}; // draft key -> Set of @files picked from the popup
  const queue = {}; // session -> [{parsed, agent, model, files, text}]
  const echo = {}; // session (or NEW while starting) -> [{text, files, agent, base, at}]: sent, not stored by opencode yet
  const open = new Set(); // tool and thinking blocks flipped from their default
  const answers = {}, custom = {}; // question id -> per question: picked labels, typed answer
  const history = [];
  const pending = new Map(); // session -> item, for a chat just started that the connector has not listed yet
  const pics = {}; // draft key -> pictures pasted into the composer (images.js)
  const imgs = new Map(); // picture id or session|message|part -> data URL, for <img> in the thread and composer
  const imgLoading = new Set();
  const wasBusy = {}; // session -> busy at the last read, to tell Files when a turn ends
  const docs = {}; // draft key -> PDFs for the message (Chat 4.1.0): {id, name, size, state: uploading | ready | failed, done, att}
  const suggest = {}; // session -> a suggested next message ('' none), once its last answer is in (Chat 4.1.0)
  // Live answers (Chat 4.5.0, live.js): the text opencode is writing, from the connector's chat.text events, shown
  // before the next read; chat.changed reads the chat at once. streamAt: the last event, so the poll can slow down.
  const live = {}; // session -> Map(part id -> text so far)
  let streamAt = 0, convLoading = false, convAgain = false, changedTimer = 0, frame = 0;
  // Several chats (Chat 4.2.0, alerts.js): the last busy/waiting read of each chat, chats that finished while you were
  // away (a dot until opened), and whether Chat is the app in view.
  let seen = null, inView = true;
  const unread = new Set();
  let archivedCount = 0, showArchived = false, archivedItems = [], hits = null, hitsFor = '', searchTimer = 0;
  let listTimer = 0, convTimer = 0, fileTimer = 0, noteTimer = 0;
  // flash() is defined below; the workbench's tools call it later, never while starting.
  const terminal = startTerminal(ws, { onTui: () => builtin('tui', '') });
  const workFiles = startFiles(ws, { flash: text => flash(text) }); // not `files`: that is a message's @files below
  const side = startSide(ws, { agents: () => (options && options.agents) || [], model: () => modelNow(), paint, keep: p => imgs.set(p.id, p.url), flash: text => flash(text) });
  const changes = startChanges(ws, { send: text => sendFrom(text), busy: () => working(), flash: text => flash(text), onCount: () => draw(), model: () => modelNow(), canReview: () => !options || !options.can || options.can.review !== false });
  const split = startSplit(ws, { chats: () => listed(), current: () => sel, onMain: sid => select(sid), paint, flash: text => flash(text) });
  const bench = startBench({ tools: { terminal, files: workFiles, changes, side, split }, onChange: st => { el.classList.toggle('bench-open', st.open); el.style.setProperty('--bench-w', st.width + 'px'); if (lastHtml != null) { lastHtml = null; draw(); } } });
  el.appendChild(bench.el);

  /* ---------- data ---------- */
  const key = () => sel || NEW;
  const listed = () => {
    const out = items.slice();
    for (const [sid, it] of pending) if (!out.some(c => c.session === sid)) out.push(it);
    return out;
  };
  const itemOf = sid => listed().find(c => c.session === sid) || null;
  const agents = () => ((options && options.agents) || []).filter(a => a.name !== QUICK); // Quick is Chat's own mode
  const canQuick = () => !!(options && options.can && options.can.quick);
  const echoing = sid => !!(echo[sid] && echo[sid].length);
  const echoTurns = sid => (echo[sid] || []).map(e => ({ id: '', role: 'you', text: e.text, agent: e.agent, parts: e.files.map(f => ({ type: 'file', name: f })).concat((e.pics || []).map(id => ({ type: 'file', name: 'picture', image: true, local: id }))) }));
  /* Working: opencode says so, or a message is on its way to it. */
  const working = () => !!(sel && ((conv && conv.busy) || echoing(sel)));
  /** The agents the picker offers here: New chat adds Hub and, with Rewrite a draft on hand, Rewrite at the top. */
  const agentChoices = () => {
    const quick = canQuick() ? [QUICK_AGENT] : [];
    return sel ? [...quick, ...agents()] : [HUB_AGENT, ...quick, ...(rewrite ? [REWRITE_AGENT] : []), ...agents()];
  };
  function agentNow() {
    const want = sel ? (sessPick[sel] || {}).agent : pick.agent;
    const names = agentChoices().map(a => a.name);
    if (want && (names.includes(want) || !options)) return want;
    if (!sel && pick.agent === HUB) return HUB;
    if (!sel && rewrite && pick.agent === REWRITE) return REWRITE;
    return names.includes('build') ? 'build' : names.find(n => !MODES[n]) || (sel ? '' : HUB);
  }
  const modelNow = () => (sel ? ((sessPick[sel] || {}).model ?? pick.model) : pick.model) || '';
  /* Reasoning effort (Chat 4.6.0): the variants of the model in use (the picked one, else the chat's last), like
     opencode's variant cycle. Empty when the model has none, and then no picker shows. */
  function effortModel() {
    const k = modelNow();
    if (k) return k;
    const t = ((conv && sel && conv.session === sel && conv.turns) || []).filter(x => x.role !== 'you' && x.model).pop();
    return t ? `${t.model.provider}/${t.model.id}` : '';
  }
  function efforts() {
    const m = modelFromKey(effortModel());
    const found = m && ((options && options.models) || []).find(x => x.provider === m.provider && x.id === m.id);
    return (found && found.variants) || [];
  }
  function effortNow() {
    const want = (sel ? ((sessPick[sel] || {}).effort ?? pick.effort) : pick.effort) || '';
    return efforts().includes(want) ? want : '';
  }
  function setPick(kind, value) {
    if (sel) sessPick[sel] = { agent: agentNow(), model: modelNow(), ...(sessPick[sel] || {}), [kind]: value };
    if (!(kind === 'agent' && MODES[value] && value !== QUICK && sel)) { pick = { ...pick, [kind]: value }; writeJson(PICK_KEY, pick); }
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
      const r = await ws.connectors.call(OC, 'chat.list', all ? { all: true } : {});
      items = r.items || [];
      archivedCount = r.archived || 0;
      if (showArchived) archivedItems = (await ws.connectors.call(OC, 'chat.list', { archived: true })).items || [];
      listErr = '';
      for (const c of items) pending.delete(c.session);
      watch(items);
    } catch (e) { listErr = e.message || "Couldn't list your chats."; }
    if (sel && hub) { const it = itemOf(sel); if (it && it.hub) hub.ensure(it); }
    if (!options && !optErr) loadOptions();
    split.refresh();
    draw();
    if (visible) listTimer = setTimeout(loadList, LIST_MS);
  }
  async function loadConv() {
    clearTimeout(convTimer);
    if (!sel) return;
    if (convLoading) { convAgain = true; return; } // one read at a time; the newest event reads again after it
    convLoading = true; convAgain = false;
    const want = sel;
    try {
      const r = await ws.connectors.call(OC, 'chat.messages', { session: want });
      if (sel !== want) return;
      conv = r; err = r.error || '';
      if (live[want]) live[want] = pruneLive(live[want], r.turns, !!r.busy);
      if (echo[want]) echo[want] = liveEchoes(echo[want], r.turns, { busy: !!r.busy });
      if (wasBusy[want] && !r.busy) { workFiles.changed(); changes.changed(); }
      wasBusy[want] = !!r.busy;
      side.setSession(want, r);
      changes.setSession(want);
      if (!r.busy && !r.waiting && suggest[want] === undefined && lastTandem(r.turns || []) && options && options.can && options.can.suggest) askSuggestion(want);
      const row = itemOf(want); // keep the sidebar's spinner and dot in step without waiting for the list
      if (row) { row.busy = !!r.busy; row.waiting = !!r.waiting; watch([row]); }
      if (!sessPick[want]) sessPick[want] = { agent: r.quick && (!r.agent || QUICK_RAN.has(r.agent)) ? QUICK : r.agent || (r.from === 'hub' ? 'chat' : pick.agent === HUB ? '' : pick.agent), model: r.model ? modelKey(r.model) : pick.model };
    } catch (e) { if (sel === want) err = e.message || "Couldn't read this chat."; }
    finally { convLoading = false; }
    if (convAgain && sel === want) { convAgain = false; draw(); return loadConv(); }
    draw();
    if (sel !== want) return;
    if (conv && !conv.busy && !conv.waiting && (queue[want] || []).length) { flush(want); return; }
    if (conv && (conv.busy || conv.waiting || (queue[want] || []).length || echoing(want)) && visible) convTimer = setTimeout(loadConv, Date.now() - streamAt < 5000 ? QUIET_MS : BUSY_MS);
  }
  /* The connector's stream for the chat in view (Chat 4.5.0, connectors/opencode/lib/chat-live.mjs). */
  function drawSoon() {
    if (frame) return;
    const go = () => { frame = 0; draw(); };
    frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(go) : setTimeout(go, 16);
  }
  ws.connectors.on(OC, 'chat.text', p => {
    const d = p && p.payload;
    if (!d || !d.session || !d.part) return;
    streamAt = Date.now();
    if (d.session !== sel) return;
    (live[d.session] = live[d.session] || new Map()).set(d.part, String(d.text || ''));
    drawSoon();
  });
  ws.connectors.on(OC, 'chat.changed', p => {
    const d = p && p.payload;
    if (!d || d.session !== sel) return;
    streamAt = Date.now();
    clearTimeout(changedTimer);
    changedTimer = setTimeout(loadConv, 60);
  });
  /* Several chats (Chat 4.2.0): a notification when a chat finishes or needs you while you look elsewhere. */
  const outOfSight = () => !inView || (typeof document !== 'undefined' && (document.hidden || !document.hasFocus()));
  function watch(list) {
    const r = chatEvents(seen, list);
    const first = seen === null;
    seen = r.next;
    if (first) return;
    for (const ev of r.events) {
      const away = ev.session !== sel || outOfSight();
      if (ev.kind === 'done' && away) unread.add(ev.session);
      if (!away) continue;
      const st = alertsState(typeof localStorage !== 'undefined' ? localStorage : null, typeof Notification === 'function' ? Notification : null);
      if (st.on && outOfSight()) ws.notify({ ...alertText(ev), route: `chat/${ev.session}` }).catch(() => {});
    }
  }
  async function toggleAlerts() {
    const st = alertsState(localStorage, typeof Notification === 'function' ? Notification : null);
    if (st.perm === 'default') { try { await Notification.requestPermission(); } catch (e) { /* closed */ } try { localStorage.removeItem(ALERTS_KEY); } catch (e) { /* blocked */ } }
    else if (st.perm === 'granted') { try { st.off ? localStorage.removeItem(ALERTS_KEY) : localStorage.setItem(ALERTS_KEY, 'off'); } catch (e) { /* blocked */ } }
    draw();
  }
  function alertsBtn() {
    const st = alertsState(typeof localStorage !== 'undefined' ? localStorage : null, typeof Notification === 'function' ? Notification : null);
    if (st.perm === 'unsupported') return '';
    if (st.perm === 'denied') return '<button type="button" class="chat-archived" disabled title="Notifications are blocked for this site in your browser settings">Browser notifications are blocked</button>';
    const label = st.perm === 'default' ? 'Turn on alerts' : st.off ? 'Alerts off' : 'Alerts on';
    const tip = st.perm === 'default' ? 'A notification when a chat finishes or needs you while you look elsewhere' : st.off ? 'Click to get a notification when a chat finishes or needs you' : 'You get a notification when a chat finishes or needs you while you look elsewhere. Click to stop.';
    return `<button type="button" class="chat-archived" data-chat-alerts title="${esc(tip)}" aria-pressed="${st.on}">${label}</button>`;
  }
  /** The chats in the sidebar's order, for Alt+Up, Alt+Down and Alt+J. */
  const order = () => [...el.querySelectorAll('.chat-list [data-chat-open]')].map(b => b.dataset.chatOpen).filter((v, i, a) => a.indexOf(v) === i);
  const needsYou = sid => { const c = itemOf(sid); return !!(c && (c.waiting || (unread.has(sid) && !c.busy))); };
  function select(session) {
    if (!session && hub) hub.clearDone();
    sel = session || null; conv = null; err = ''; renaming = null; pop = null; help = false; status = null; afterOpen = false;
    if (sel) unread.delete(sel);
    if (phone()) drawer = false;
    side.setSession(sel, itemOf(sel));
    changes.setSession(sel);
    if (sel && hub) { const it = itemOf(sel); if (it && it.hub) hub.ensure(it); }
    draw();
    if (sel) loadConv();
    focusBox();
  }
  /* A suggested next message (Chat 4.1.0): asked once per answer, shown above the box, taken with Right arrow. */
  async function askSuggestion(sid) {
    suggest[sid] = '';
    try { const r = await ws.connectors.call(OC, 'chat.suggest', { session: sid }); suggest[sid] = (r && r.text) || ''; }
    catch (e) { suggest[sid] = ''; }
    if (sel === sid) draw();
  }
  function takeSuggestion() {
    const s = sel && suggest[sel];
    if (!s) return false;
    drafts[sel] = s;
    draw();
    const box = el.querySelector(`[data-keep="chat:${sel}"]`);
    if (box) { box.focus(); box.setSelectionRange(s.length, s.length); }
    return true;
  }
  /* Changes' comments (Chat 4.1.0) go to the chat in view as one message, queued while it works. */
  async function sendFrom(text) {
    if (!sel) { flash('Open a chat first.'); return false; }
    const job = { parsed: { kind: 'text', text }, files: [], pics: [], docs: [], text, ...pickArgs() };
    if ((conv && (conv.busy || conv.waiting)) || echoing(sel)) { (queue[sel] = queue[sel] || []).push(job); draw(); return true; }
    await run(sel, job);
    return true;
  }
  /* Archive (Chat 4.1.0): out of the list with the thread kept; back with Unarchive or its next message. */
  async function archive(session, archived = true) {
    try { await ws.connectors.call(OC, 'chat.archive', { session, archived }); }
    catch (e) { ws.toast(e.message || "Couldn't archive that.", { kind: 'error' }); return; }
    if (archived) { items = items.filter(c => c.session !== session); archivedCount++; if (sel === session) select(null); }
    else { archivedItems = archivedItems.filter(c => c.session !== session); archivedCount = Math.max(0, archivedCount - 1); }
    draw();
    loadList();
  }
  /* Search in messages (Chat 4.1.0): the connector reads each chat's words; titles still filter as you type. */
  function searchSoon() {
    clearTimeout(searchTimer);
    const q = query.trim();
    if (q.length < 3) { hits = null; hitsFor = ''; return; }
    searchTimer = setTimeout(async () => {
      try {
        const r = await ws.connectors.call(OC, 'chat.search', { query: q, ...(all ? { all: true } : {}) });
        if (query.trim() !== q) return;
        hits = r.items || []; hitsFor = q;
      } catch (e) { hits = []; hitsFor = q; }
      draw();
    }, 350);
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
    const v = a === QUICK ? '' : effortNow();
    return { ...(a && !MODES[a] ? { agent: a } : {}), ...(m ? { model: m } : {}), ...(v ? { variant: v } : {}), ...(a === QUICK ? { quick: true } : {}) };
  }
  async function send() {
    const k = key();
    const text = String(drafts[k] || '');
    const parsed = parseInput(text);
    if (parsed.kind === 'empty' || sending) return;
    pop = null;
    if (parsed.kind === 'builtin') { drafts[k] = ''; draw(); return builtin(parsed.name, parsed.args); }
    const files = parsed.kind === 'text' ? filesIn(text, picked[k]) : [];
    const list = pics[k] || [];
    const dl = docs[k] || [];
    if ((list.length || dl.length) && parsed.kind !== 'text') { err = 'Pictures and PDFs go with a message, not with a / command or ! shell command.'; draw(); return; }
    if ((list.length || dl.length || files.length) && parsed.kind === 'text' && agentNow() === QUICK) { err = 'Quick answers take words only. Pick another agent (Tab) to send pictures, PDFs or @ files.'; draw(); return; }
    if (dl.some(d => d.state === 'uploading')) { err = 'Wait for the PDF to finish attaching.'; draw(); return; }
    const ready = dl.filter(d => d.state === 'ready');
    const job = { parsed, files, pics: list, docs: ready, text: text.trim(), ...pickArgs() };
    pics[k] = [];
    docs[k] = [];
    history.push(text.trim());
    if (history.length > 50) history.shift();
    drafts[k] = ''; picked[k] = new Set();
    if (sel && ((conv && (conv.busy || conv.waiting)) || echoing(sel))) { (queue[sel] = queue[sel] || []).push(job); draw(); return; }
    await run(sel, job);
  }
  async function run(session, job) {
    const { parsed, files, agent, model, variant } = job;
    const list = job.pics || [];
    const pickOf = { ...(agent ? { agent } : {}), ...(model ? { model } : {}) };
    const effort = variant ? { variant } : {}; // a message's reasoning effort (Chat 4.6.0); commands and !shell have none
    const images = list.length ? { images: list.map(({ name, mime, data }) => ({ name, mime, data })) } : {};
    const dl = job.docs || [];
    if (dl.length) images.attachments = dl.map(d => ({ id: d.att }));
    for (const p of list) imgs.set(p.id, p.url);
    const ek = session || NEW;
    if (session) delete suggest[session];
    const mine = { text: parsed.kind === 'text' ? parsed.text : job.text, files: files.concat(dl.map(d => d.name)), pics: list.map(p => p.id), agent: agent || null, base: !session ? 0 : conv ? (conv.turns || []).length : null, at: Date.now() };
    echo[ek] = [...(echo[ek] || []), mine];
    sending = true; err = ''; draw();
    try {
      let r = null;
      if (parsed.kind === 'shell') r = await ws.connectors.call(OC, 'chat.shell', { ...(session ? { session } : {}), command: parsed.command, ...pickOf }, confirm);
      else if (parsed.kind === 'command') r = await ws.connectors.call(OC, 'chat.command', { ...(session ? { session } : {}), name: parsed.name, args: parsed.args, ...pickOf }, confirm);
      else if (job.quick) r = await ws.connectors.call(OC, 'chat.quick', { ...(session ? { session } : {}), text: parsed.text, ...(model ? { model } : {}) }, confirm);
      else if (session) {
        const sent = await ws.connectors.call(OC, 'chat.send', { session, text: parsed.text, ...pickOf, ...effort, ...(files.length ? { files } : {}), ...images }, confirm);
        // A quick chat with tools off sends another agent's message to a new chat (connector 1.38.0): open it.
        if (sent && sent.moved && sent.session) {
          echo[session] = (echo[session] || []).filter(x => x !== mine);
          sessPick[sent.session] = { agent: agent || '', model: model ? modelKey(model) : '' };
          pending.set(sent.session, { session: sent.session, from: 'you', title: job.text.replace(/\s+/g, ' ').slice(0, 80), at: Date.now(), last: Date.now(), busy: true });
          echo[sent.session] = [{ ...mine, base: 0 }];
          sending = false; select(sent.session); loadList(); return;
        }
      }
      else r = await ws.connectors.call(OC, 'chat.start', { text: parsed.text, ...pickOf, ...effort, ...(files.length ? { files } : {}), ...images }, confirm);
      const sid = session || (r && r.session);
      if (!session && sid) {
        sessPick[sid] = { agent: job.quick ? QUICK : agent || '', model: model ? modelKey(model) : '', ...(variant ? { effort: variant } : {}) };
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
      else { err = msg; if (!drafts[key()]) drafts[key()] = job.text; if (list.length && !(pics[key()] || []).length) pics[key()] = list; if (dl.length && !(docs[key()] || []).length) docs[key()] = dl; }
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
    if (name === 'terminal') { bench.open('terminal'); if (args) terminal.run(args); return; }
    if (name === 'files') { bench.open('files'); if (args) workFiles.open(args.replace(/^@/, '')); return; }
    if (name === 'side') {
      if (!sel) { err = 'Open a chat first. A side chat asks about the chat in view.'; draw(); return; }
      bench.open('side', { focus: !args });
      if (args) side.ask(args);
      return;
    }
    if (name === 'tui') {
      try { await ws.connectors.call(OC, 'terminal', sel ? { session: sel } : {}); flash("Opened in opencode's own window."); }
      catch (e) { ws.toast(e.message || "Couldn't open a terminal window.", { kind: 'error' }); }
      return;
    }
    if (name === 'status') return showStatus();
    if (!needChat()) return;
    if (name === 'rename') {
      if (args) { renaming = sel; renameText = args; return rename(); }
      if (closed) { closed = false; saveSide(false); }
      if (phone()) drawer = true;
      renaming = sel; renameText = titleOf(sel); draw();
      const box = el.querySelector('[data-chat-rename-box]');
      if (box) { box.focus(); box.select(); }
      return;
    }
    if (name === 'copy') return copyText(transcript((conv && conv.turns) || [], titleOf(sel)), 'Copied the chat.');
    if (name === 'fork') return fork('');
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
  /* Chat 4.6.0: what opencode's TUI does on a message and with /fork and /status. */
  function copyText(text, done = 'Copied.') {
    if (!text) { ws.toast('Nothing to copy yet.', { kind: 'warn' }); return; }
    if (!navigator.clipboard) { ws.toast("This browser won't let Chat copy.", { kind: 'warn' }); return; }
    navigator.clipboard.writeText(text).then(() => ws.toast(done, { kind: 'success' }), () => ws.toast("Couldn't copy.", { kind: 'error' }));
  }
  async function fork(message) {
    if (!sel) return;
    try {
      const r = await ws.connectors.call(OC, 'chat.fork', { session: sel, ...(message ? { message } : {}) });
      if (r && r.session) { pending.set(r.session, { session: r.session, from: 'you', title: r.title || 'Chat', at: Date.now(), last: Date.now() }); select(r.session); flash(message ? 'A new chat with everything up to there.' : 'A copy of the chat. The first one is unchanged.'); }
    } catch (e) { ws.toast(e.message || "Couldn't copy the chat.", { kind: 'error' }); }
    loadList();
  }
  async function undoFrom(message) {
    if (!sel) return;
    try {
      const r = await ws.connectors.call(OC, 'chat.undo', { session: sel, message }, confirm);
      if (r && r.text) drafts[sel] = r.text;
    } catch (e) { err = e.message || "Couldn't undo."; }
    draw();
    loadConv();
    focusBox();
  }
  async function showStatus(st) {
    try { status = st || await ws.connectors.call(OC, 'chat.status', {}); }
    catch (e) { ws.toast(e.message || "Couldn't read opencode's status.", { kind: 'error' }); return; }
    help = false;
    draw();
  }
  async function mcpSwitch(name, on) {
    try { await showStatus(await ws.connectors.call(OC, 'chat.mcp', { name, on }, confirm)); }
    catch (e) { ws.toast(e.message || `Couldn't ${on ? 'connect' : 'disconnect'} ${name}.`, { kind: 'error' }); }
  }
  function statusHtml() {
    if (!status) return '';
    const word = { connected: 'Connected', disabled: 'Off', failed: 'Failed', needs_auth: 'Needs sign in', needs_client_registration: 'Needs setup' };
    const mcp = (status.mcp || []).map(m => `<li><b>${esc(m.name)}</b> <span class="st st-${esc(m.status)}">${esc(word[m.status] || m.status)}</span>${m.error ? ` <span class="pop-d">${esc(m.error)}</span>` : ''} ` +
      `<button type="button" class="lnk" data-mcp="${esc(m.name)}" data-mcp-on="${m.status === 'connected' ? '0' : '1'}">${m.status === 'connected' ? 'Disconnect' : 'Connect'}</button></li>`).join('');
    const lsp = (status.lsp || []).map(l => `<li><b>${esc(l.name)}</b> <span class="st st-${esc(l.status)}">${esc(l.status === 'connected' ? 'Running' : l.status)}</span>${l.root ? ` <span class="pop-d">${esc(l.root)}</span>` : ''}</li>`).join('');
    const fmt = (status.formatters || []).filter(f => f.on).map(f => `<li><b>${esc(f.name)}</b> <span class="pop-d">${esc((f.extensions || []).join(' '))}</span></li>`).join('');
    const sec = (h, list, none) => `<h3>${h}</h3>${list ? `<ul class="chat-status-l">${list}</ul>` : `<p class="pop-d">${none}</p>`}`;
    return `<div class="chat-help chat-status" role="region" aria-label="opencode status"><p class="row"><b>opencode${status.version ? ` ${esc(status.version)}` : ''}</b> <button type="button" class="lnk" data-builtin="status">Refresh</button> <button type="button" class="lnk" data-status-close>Close</button></p>` +
      sec('MCP servers', mcp, 'None set up. Add them in opencode.json.') + sec('Language servers', lsp, 'None running yet. opencode starts one when it reads a file it knows.') + sec('Formatters', fmt, 'None on.') + '</div>';
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
  /** A flow card under the answer (Builds flow cards v1): Builds' Start work on that flow, filled in with the chat's ask. */
  function openFlow(id) { ws.open({ app: 'builds', path: flowRoute(id, titleOf(sel)) }).catch(() => ws.toast('Turn Builds on in Settings, Apps.', { kind: 'warn' })); }
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
    else if (kind === 'effort') {
      const list = [{ value: '', label: 'Default effort', desc: "The model's own" }].concat(efforts().map(v => ({ value: v, label: cap(v), desc: '' })));
      pop = { kind, items: list, i: Math.max(0, list.findIndex(x => x.value === effortNow())), q: '' };
    }
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
    if (kind === 'effort') { setPick('effort', it.value); draw(); return focusBox(); }
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
    const title = { slash: 'Commands', file: 'Files', agent: 'Agent', model: 'Model', effort: 'Reasoning effort' }[pop.kind];
    const search = pop.kind === 'model' ? `<input class="pop-q" data-keep="chat-pop-q" data-pop-q placeholder="Search models" aria-label="Search models" value="${esc(pop.q)}">` : '';
    const cur = pop.kind === 'agent' ? agentNow() : pop.kind === 'model' ? modelNow() : pop.kind === 'effort' ? effortNow() : null;
    const rows = pop.items.map((it, i) => `<li><button type="button" class="pop-it${i === pop.i ? ' on' : ''}${cur != null && it.value === cur ? ' cur' : ''}" data-pop-i="${i}" role="option" aria-selected="${i === pop.i}"><span class="pop-l">${esc(it.label)}</span>${it.desc ? `<span class="pop-d">${esc(it.desc)}</span>` : ''}</button></li>`).join('');
    const empty = !pop.items.length ? '<p class="pop-none">Nothing matches.</p>' : '';
    return `<div class="pop" data-pop><p class="pop-t">${title}</p>${search}<ul role="listbox" aria-label="${title}">${rows}</ul>${empty}</div>`;
  }

  /* ---------- drawing ---------- */
  function rowHtml(c, { snippet = '', archived = false } = {}) {
    if (renaming === c.session) {
      return `<li class="chat-row renaming"><input class="chat-rename" data-keep="chat-rename" data-chat-rename-box value="${esc(renameText)}" aria-label="Name this chat" maxlength="80"></li>`;
    }
    const outside = c.from === 'opencode';
    const beside = split.session() === c.session;
    // Alt-click (Option-click) opens a chat beside this one (Chat 4.1.0), as in Claude's desktop app.
    return `<li class="chat-row${c.session === sel ? ' on' : ''}${outside ? ' outside' : ''}${beside ? ' beside' : ''}"><button type="button" class="chat-item${c.session === sel ? ' on' : ''}" data-chat-open="${esc(c.session)}"${c.session === sel ? ' aria-current="true"' : ''} title="Alt-click opens it beside this chat">` +
      `<span class="chat-t">${c.busy ? '<span class="spin" aria-hidden="true"></span>' : ''}${esc(c.title)}</span>` +
      (snippet ? `<span class="chat-snip">${esc(snippet)}</span>` : '') +
      (c.waiting ? '<span class="chat-dot" title="opencode is asking you something"><span class="sr">Needs you</span></span>'
        : unread.has(c.session) && !c.busy ? '<span class="chat-dot done" title="Finished while you were away"><span class="sr">Done</span></span>' : '') + '</button>' +
      `<span class="chat-acts">` +
      (archived ? `<button type="button" class="chat-act" data-chat-unarchive="${esc(c.session)}" title="Unarchive" aria-label="Unarchive ${esc(c.title)}">${ICON.box}</button>`
        : `<button type="button" class="chat-act" data-chat-beside="${esc(c.session)}" title="Open beside this chat" aria-label="Open ${esc(c.title)} beside">${ICON.beside}</button>` +
          `<button type="button" class="chat-act" data-chat-rename="${esc(c.session)}" title="Rename" aria-label="Rename ${esc(c.title)}">${ICON.pen}</button>` +
          (outside ? '' : `<button type="button" class="chat-act" data-chat-archive="${esc(c.session)}" title="Archive: out of the list, kept with its thread" aria-label="Archive ${esc(c.title)}">${ICON.box}</button>`)) +
      (outside ? '' : `<button type="button" class="chat-act" data-chat-remove="${esc(c.session)}" title="Remove from Chat. The opencode session is kept." aria-label="Remove ${esc(c.title)}">${ICON.x}</button>`) + '</span></li>';
  }
  function sideHtml() {
    const every = showArchived ? archivedItems : listed();
    const shown = every.filter(c => matchChat(c, query));
    const groups = showArchived ? (shown.length ? [{ label: 'Archived', items: shown }] : []) : groupChats(shown.map(c => unread.has(c.session) ? { ...c, unread: true } : c));
    let list = groups.map(g => `<h3 class="chat-h">${esc(g.label)}</h3><ul>${g.items.map(c => rowHtml(c, { archived: showArchived })).join('')}</ul>`).join('');
    // Search in messages (Chat 4.1.0): chats whose words match, beyond the titles above.
    const more = hits && hitsFor === query.trim() ? hits.filter(h => !shown.some(c => c.session === h.session) && (!!h.archived === showArchived || !showArchived)) : [];
    if (more.length) list += `<h3 class="chat-h">In messages</h3><ul>${more.map(h => rowHtml({ ...h, title: h.title + (h.archived && !showArchived ? ' (archived)' : '') }, { snippet: h.snippet, archived: !!h.archived })).join('')}</ul>`;
    const empty = showArchived && !every.length ? '<p class="chat-empty">No archived chats.</p>'
      : !every.length
      ? (aiReady().ready ? '<p class="chat-empty">Your chats show here. Send a message to start one.</p>' : '<p class="chat-empty">Your chats show here once opencode is connected.</p>')
      : !shown.length && !more.length ? `<p class="chat-empty">${query.trim().length >= 3 && hitsFor !== query.trim() ? 'Searching...' : `No chats match "${esc(query)}".`}</p>` : '';
    const archBtn = showArchived ? '<button type="button" class="chat-archived on" data-chat-archived="0">Back to chats</button>'
      : archivedCount ? `<button type="button" class="chat-archived" data-chat-archived="1">Archived (${archivedCount})</button>` : '';
    return `<aside class="chat-side" aria-label="Chats">` +
      `<div class="chat-side-top"><button type="button" class="chat-newbtn${sel ? '' : ' on'}" data-chat-new>${ICON.plus}<span>New chat</span></button>` +
      `<button type="button" class="chat-icon" data-chat-side title="Close sidebar" aria-label="Close sidebar">${ICON.side}</button></div>` +
      `<div class="chat-find"><input type="search" class="chat-search" data-keep="chat-search" data-chat-search placeholder="${all ? 'Search all sessions' : 'Search chats'}" aria-label="Search chats" value="${esc(query)}">` +
      `<button type="button" class="chat-all${all ? ' on' : ''}" data-chat-all="${all ? '0' : '1'}" aria-pressed="${all}" title="${all ? 'Showing every opencode session (runs, PR reviews, the terminal). Click for just your chats.' : 'Show every opencode session in the workspace: runs, PR reviews and the terminal'}">All</button></div>` +
      (listErr ? `<p class="hub-error">${esc(listErr)}</p>` : '') +
      `<nav class="chat-list">${list}${empty}</nav>${(() => { const al = showArchived ? '' : alertsBtn(); return archBtn || al ? `<div class="chat-side-foot">${archBtn}${al}</div>` : ''; })()}</aside>`;
  }
  function topHtml(title, extra = '') {
    const sideBtn = closed || phone()
      ? `<button type="button" class="chat-icon" data-chat-side title="Open sidebar" aria-label="Open sidebar">${ICON.side}</button>` +
        (sel ? `<button type="button" class="chat-icon" data-chat-new title="New chat" aria-label="New chat">${ICON.plus}</button>` : '')
      : '';
    return `<header class="chat-top">${sideBtn}<h2>${esc(title)}</h2>${extra}${benchBtns()}</header>`;
  }
  /* The workbench's three buttons (Chat 4.0.0), at the right of every pane's header. */
  function benchBtns() {
    const st = bench ? bench.state() : { open: false };
    const b = (tab, icon, title, off = '') => {
      const on = st.open && st.tab === tab;
      return `<button type="button" class="chat-icon bench-btn${on ? ' on' : ''}" data-bench="${tab}" title="${off || title}" aria-label="${title}" aria-pressed="${on}"${off ? ' aria-disabled="true"' : ''}>${icon}</button>`;
    };
    const n = changes.count();
    return `<span class="row bench-btns">${b('terminal', ICON.term, 'Terminal (Ctrl+`)')}${b('files', ICON.files, 'Files')}${b('changes', ICON.changes, n ? `Changes (${n} comment${n === 1 ? '' : 's'})` : 'Changes: what this chat changed', sel ? '' : 'Changes: open a chat first')}${b('side', ICON.side, 'Side chat', sel ? '' : 'Side chat: open a chat first')}${b('split', ICON.beside, 'Second chat: another chat beside this one')}</span>`;
  }
  function picksHtml() {
    const a = agentNow();
    const models = (options && options.models) || [];
    return `<button type="button" class="pick pick-agent${MODES[a] ? ' hub' : ''}" data-pick="agent" title="${esc(a === HUB ? 'Hub: captures to your apps, or a Quick answer for a question (Tab switches)' : a === QUICK ? 'Quick: one model call from your notes, no tools or skills (Tab switches)' : a === REWRITE ? 'Rewrite: your draft in your voice, read-only (Tab switches)' : `${a || "opencode's default agent"}: tools, skills and AGENTS.md as in opencode in a terminal, in your workspace folder (Tab switches)`)}" aria-haspopup="listbox"><span>${esc(MODES[a] || a || 'Default agent')}</span>${ICON.caret}</button>` +
      (MODES[a] && a !== QUICK ? '' : `<button type="button" class="pick" data-pick="model" title="Model" aria-haspopup="listbox"><span>${esc(modelLabel(modelNow(), models))}</span>${ICON.caret}</button>`) +
      (MODES[a] || !efforts().length ? '' : `<button type="button" class="pick" data-pick="effort" title="Reasoning effort" aria-haspopup="listbox"><span>${esc(effortNow() ? cap(effortNow()) : 'Default effort')}</span>${ICON.caret}</button>`);
  }
  function composeHtml() {
    const k = key();
    const off = !aiReady().ready;
    const busy = working();
    const draft = drafts[k] || '';
    const shell = /^\s*!/.test(draft);
    const q = sel ? (queue[sel] || []).length : 0;
    const ctx = meterHtml();
    const tip = sel && !busy && !draft && suggest[sel] && !off ? `<button type="button" class="chat-suggest" data-chat-suggest title="Right arrow in the empty box takes it"><span class="dim">Suggested:</span> ${esc(suggest[sel])} <kbd>→</kbd></button>` : '';
    const hint = off ? esc(aiReady().why || 'opencode is not connected.')
      : note ? esc(note)
      : escAt && busy && Date.now() - escAt < 1500 ? 'Press Esc again to stop.'
      : shell ? 'Shell: runs in the workspace through opencode.'
      : q ? `${q} message${q === 1 ? '' : 's'} queued. ${q === 1 ? 'It goes' : 'They go'} when opencode is done.`
      : sel ? '' : 'Enter sends · Tab agent · / commands · @ files · ! shell';
    const action = busy && !draft.trim()
      ? `<button type="button" class="chat-send stop" data-chat-stop title="Stop (Esc twice)" aria-label="Stop">${ICON.stop}</button>`
      : `<button type="button" class="chat-send" data-chat-send title="${busy ? 'Queue' : 'Send'}" aria-label="${busy ? 'Queue' : 'Send'}"${off || sending ? ' disabled' : ''}>${ICON.up}</button>`;
    return `<div class="chat-compose"><div class="chat-col pop-anchor">${popHtml()}${tip}<div class="chat-box${shell ? ' shell' : ''}" data-chat-drop>` + chipsHtml(pics[k], 'data-pic-x') + docChipsHtml(docs[k]) +
      `<textarea rows="1" data-keep="chat:${esc(k)}" placeholder="${off ? 'opencode is not connected' : sel ? 'Message opencode' : 'Ask anything, or / for commands'}" aria-label="Message to opencode"${off ? ' disabled' : ''}>${esc(draft)}</textarea>` +
      `<div class="chat-bar"><button type="button" class="chat-icon chat-attach" data-chat-attach title="Attach pictures or PDFs (or paste and drop them)" aria-label="Attach pictures or PDFs"${off ? ' disabled' : ''}>${ICON.clip}</button>${picksHtml()}<span class="grow"></span>${ctx}${action}</div></div>` +
      `<p class="chat-hint" aria-live="polite">${hint}</p></div></div>`;
  }
  /* The context meter (Chat 4.1.0): how full the model's context window is, from opencode's own counts. */
  function contextLimit() {
    const models = (options && options.models) || [];
    const find = m => (m && m.provider ? models.find(x => x.provider === m.provider && x.id === m.id) : null);
    const hit = find(conv && conv.model) || find(modelFromKey(modelNow()));
    return hit && hit.context ? hit.context : 0;
  }
  function meterHtml() {
    if (!sel || !conv || !conv.totals) return '';
    const used = conv.totals.context || 0, cost = money(conv.totals.cost), limit = contextLimit();
    if (!used) return cost ? `<span class="chat-ctx">${esc(cost)}</span>` : '';
    if (!limit) return `<span class="chat-ctx" title="opencode did not say how big this model's context window is">${esc([`${tokens(used)} context`, cost].filter(Boolean).join(' · '))}</span>`;
    const pct = Math.min(100, Math.round((used / limit) * 100));
    const lvl = pct >= 90 ? ' bad' : pct >= 75 ? ' warn' : '';
    const title = `${used.toLocaleString()} of ${limit.toLocaleString()} tokens in the context window${cost ? `, ${cost} so far` : ''}. /compact frees space.`;
    return `<span class="chat-meter${lvl}" title="${esc(title)}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Context ${pct}% full"><span class="meter-ring" style="--p:${pct}"></span>${pct}%</span>` +
      (pct >= 75 ? '<button type="button" class="lnk chat-compact" data-builtin="compact" title="Summarize the chat so far to free space (/compact)">Compact</button>' : '');
  }
  /* PDFs above the box (Chat 4.1.0), each attaching in pieces or ready. */
  function docChipsHtml(list) {
    if (!list || !list.length) return '';
    return `<div class="pics docs">${list.map(d => `<span class="doc${d.state === 'failed' ? ' failed' : ''}" title="${esc(d.name)}"><span class="doc-ic" aria-hidden="true">PDF</span><span class="doc-n">${esc(d.name)}</span>` +
      `<span class="doc-st">${d.state === 'uploading' ? `${Math.round((d.done || 0) * 100)}%` : d.state === 'failed' ? 'failed' : ''}</span>` +
      `<button type="button" class="pic-x" data-doc-x="${esc(d.id)}" title="Remove ${esc(d.name)}" aria-label="Remove ${esc(d.name)}">×</button></span>`).join('')}</div>`;
  }
  async function takeDocs(files) {
    const k = key();
    if (!files.length || hubMode() || rewriteMode()) return;
    if (options && options.can && options.can.pdf === false) { flash("This opencode can't take PDFs from Chat."); return; }
    const list = docs[k] = docs[k] || [];
    for (const f of files) {
      if (list.length >= MAX_DOCS) { flash(`Up to ${MAX_DOCS} PDFs in one message.`); break; }
      const d = { id: 'd' + Math.random().toString(36).slice(2, 9), name: f.name || 'document.pdf', size: f.size, state: 'uploading', done: 0, att: null };
      list.push(d);
      draw();
      try {
        d.att = await uploadDoc(f, (piece) => ws.connectors.call(OC, 'chat.attach', piece, { confirm: true }), p => { d.done = p; draw(); });
        d.state = 'ready';
      } catch (e) { d.state = 'failed'; flash(e.message || "Couldn't attach that PDF."); }
      draw();
    }
    focusBox();
  }
  function takeFiles(files) {
    const all = Array.from(files || []);
    const pdfs = all.filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || ''));
    const pictures = all.filter(f => /^image\//.test(f.type));
    if (pictures.length) takePictures(pictures);
    if (pdfs.length) takeDocs(pdfs);
    if (all.length && !pdfs.length && !pictures.length) flash('Chat attaches pictures and PDFs. For other files, put them in the workspace and type @.');
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
      icon(ICON.compact, 'compact', 'Compact this chat (/compact)') +
      (busy ? '<button type="button" class="btn ghost" data-chat-stop>Stop</button>' : '') + '</span>';
  }
  /* Under the last answer: one quiet Start work... button; its menu has the flow cards and Save as note (Chat 2.3.0). */
  let afterOpen = false;
  /* Go deeper (Chat 4.5.0): a quick answer's question again, to an agent that reads code and files (Tandem's chat). */
  function deeperAgent() { const names = agents().map(a => a.name); return ['chat', 'plan', 'build'].find(n => names.includes(n)) || ''; }
  function quickLast() {
    if (!conv || !conv.quick) return null;
    const you = (conv.turns || []).filter(t => t.role === 'you').pop();
    return you && (!you.agent || QUICK_RAN.has(you.agent)) ? you : null;
  }
  async function goDeeper() {
    const you = quickLast();
    if (!you || !sel) return;
    const a = deeperAgent();
    setPick('agent', a);
    const job = { parsed: { kind: 'text', text: you.text }, files: [], pics: [], docs: [], text: you.text, ...(a ? { agent: a } : {}), ...(modelFromKey(modelNow()) ? { model: modelFromKey(modelNow()) } : {}) };
    await run(sel, job);
  }
  function afterHtml() {
    // A Quick answer is not what opencode in a terminal would do (one model call, no tools, so no skills): say so.
    const deeper = quickLast() ? `<span class="hub-meta chat-quick-note">Quick answer from your notes: no tools or skills.</span><button type="button" class="btn ghost chat-after-btn" data-chat-deeper title="Ask ${esc(deeperAgent() || 'an agent')} the same question with tools and skills, like opencode in a terminal. It reads code and files, so it takes longer">Go deeper</button>` : '';
    const menu = afterOpen ? `<div class="chat-after-menu" role="menu">${flowCardsHtml(titleOf(sel), 'data-chat-flow')}<button class="btn ghost" type="button" data-builtin="export">Save as note</button></div>` : '';
    return `<div class="chat-after">${deeper}<button type="button" class="btn ghost chat-after-btn${afterOpen ? ' on' : ''}" data-chat-after aria-expanded="${afterOpen}">Start work...</button>${menu}</div>`;
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
        helpHtml() + statusHtml() + errs + '</div></div>' + (hubOn ? hubCompose : '<div class="chat-hub" data-hub-home hidden></div>' + composeHtml()) + '</div>';
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
    rows += richRows(withLive(shown, live[sel], busy).concat(echoTurns(sel)), { open, details, session: sel, actions: true, busy: busy && !(first && first.running), activity: (conv && conv.activity) || (echoing(sel) ? 'Sending' : '') });
    if (undone) rows += `<p class="divider undo"><span>Undid ${undone} message${undone === 1 ? '' : 's'} and ${undone === 1 ? 'its' : 'their'} changes. <button type="button" class="lnk" data-builtin="redo">Redo</button> brings ${undone === 1 ? 'it' : 'them'} back; your next message drops ${undone === 1 ? 'it' : 'them'}.</span></p>`;
    for (const job of queue[sel] || []) rows += `<div class="turn you queued"><span class="who">You, queued</span><div class="tx">${esc(job.text)}</div><span class="you-agent">Queued</span></div>`;
    if (!conv && !first && !fromHub && !echoing(sel)) rows += '<p class="hub-meta">Loading...</p>';
    if (conv && Array.isArray(conv.prompts)) rows += conv.prompts.map(p => promptHtml(p, { answers, custom })).join('');
    else if (conv && conv.waiting) rows += asksHtml(sel) || `<p class="hub-meta">opencode is asking you something. Answer it in ${placeName('builds')}' Inbox.</p>`;
    if (conv && !busy && later.length && lastTandem(later)) rows += afterHtml();
    if (err) rows += `<p class="hub-error">${esc(err)}</p>`;
    return `<div class="chat-pane">${head}<div class="chat-scroll" data-chat-follow><div class="chat-col">${helpHtml()}${statusHtml()}<div class="turns">${rows}</div></div></div>${composeHtml()}</div>`;
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
    if (html === lastHtml && core.firstChild === lastFirst && core.firstChild) { mountHub(); return; }
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
    morph(core, html); // in place, so a selection, hover and pictures survive an answer streaming in (Chat 4.5.0)
    lastHtml = html; lastFirst = core.firstChild;
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
    paint(core);
  }

  /* ---------- pictures: previews and the thread's pictures, set after drawing ---------- */
  function paint(root) {
    for (const img of root.querySelectorAll('img[data-img-local],img[data-img-ref]')) {
      const id = img.getAttribute('data-img-local') || img.getAttribute('data-img-ref');
      const url = imgs.get(id);
      if (url) { if (img.getAttribute('src') !== url) img.src = url; continue; }
      if (img.hasAttribute('data-img-ref')) fetchImage(id);
    }
  }
  async function fetchImage(ref) {
    if (imgLoading.has(ref) || imgs.has(ref) || imgLoading.size > 4) return;
    const [session, message, part] = ref.split('|');
    imgLoading.add(ref);
    try {
      const r = await ws.connectors.call(OC, 'chat.image', { session, message, part: +part });
      imgs.set(ref, `data:${r.mime};base64,${r.data}`);
    } catch (e) { imgs.set(ref, ''); }
    imgLoading.delete(ref);
    paint(el);
  }
  async function takePictures(files) {
    const k = key();
    if (!files.length || hubMode() || rewriteMode()) return;
    if (options && options.can && options.can.images === false) { flash("This opencode can't take pictures from Chat."); return; }
    const list = pics[k] = pics[k] || [];
    const errors = await addPictures(list, files);
    for (const p of list) imgs.set(p.id, p.url);
    if (errors.length) flash(errors[0]);
    draw();
    focusBox();
  }
  function viewPicture(img) {
    if (!img || !img.src) return;
    const box = document.createElement('div');
    box.className = 'pic-view';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', img.alt || 'Picture');
    box.tabIndex = -1;
    const big = document.createElement('img');
    big.src = img.src; big.alt = img.alt || '';
    box.appendChild(big);
    const done = () => { box.remove(); document.removeEventListener('keydown', key, true); };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); } };
    box.addEventListener('click', done);
    document.addEventListener('keydown', key, true);
    document.body.appendChild(box);
    box.focus();
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
    } else if (k === 'chat-search') { query = t.value; searchSoon(); draw(); }
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
      if (e.key === 'ArrowRight' && !t.value && sel && suggest[sel]) { e.preventDefault(); takeSuggestion(); return; }
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
    } else if (t.matches('[data-chat-search]') && e.key === 'Escape' && query) { e.preventDefault(); query = ''; hits = null; hitsFor = ''; draw(); }
  });
  el.addEventListener('focusout', e => {
    if (e.target.matches && e.target.matches('[data-chat-rename-box]') && renaming) setTimeout(() => { if (renaming) rename(); }, 0);
    // A picker closes when focus leaves it.
    if (pop && (pop.kind === 'agent' || pop.kind === 'model' || pop.kind === 'effort')) setTimeout(() => { const a = document.activeElement; if (pop && !(a && a.closest && a.closest('[data-pop]'))) { pop = null; draw(); } }, 0);
  });
  el.addEventListener('mousedown', e => { if (e.target.closest && e.target.closest('[data-pop-i]')) e.preventDefault(); });
  el.addEventListener('click', e => {
    const b = e.target.closest('button,[data-chat-side]');
    if (!b || (hubEl && hubEl.contains(b))) return;
    // A button in a hub chat's first answer (a flow card, Save as note, a suggested action, a choice).
    if (hub && b.closest('.hub-intro') && hub.click(b)) return;
    const d = b.dataset;
    // The workbench handles its own clicks (bench.js and its tools); from it, the chat only opens files, pictures,
    // subagent sessions and Sources, and copies code.
    if (bench.el.contains(b) && d.openFile == null && d.imgView == null && d.copy == null && d.chatOpen == null && d.srcNote == null && d.srcWrong == null && d.srcPage == null) return;
    if (d.chatOpen != null && (e.altKey || e.metaKey && e.shiftKey)) { split.open(d.chatOpen); bench.open('split', { focus: false }); }
    else if (d.chatOpen != null) select(d.chatOpen);
    else if (d.chatBeside != null) { split.open(d.chatBeside); bench.open('split', { focus: false }); draw(); }
    else if (d.chatArchive != null) archive(d.chatArchive, true);
    else if (d.chatUnarchive != null) archive(d.chatUnarchive, false);
    else if (d.chatArchived != null) { showArchived = d.chatArchived === '1'; draw(); loadList(); }
    else if (d.chatAlerts != null) toggleAlerts();
    else if (d.chatSuggest != null) takeSuggestion();
    else if (d.chatAttach != null) {
      const input = document.createElement('input');
      input.type = 'file'; input.multiple = true; input.accept = 'image/png,image/jpeg,image/gif,image/webp,application/pdf';
      input.addEventListener('change', () => takeFiles(input.files));
      input.click();
    }
    else if (d.docX != null) { const k = key(); docs[k] = (docs[k] || []).filter(x => x.id !== d.docX); draw(); focusBox(); }
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
    else if (d.chatDeeper != null) goDeeper();
    else if (d.chatFlow != null) { afterOpen = false; openFlow(d.chatFlow); }
    else if (d.builtin != null) { if (d.builtin === 'export') afterOpen = false; builtin(d.builtin, ''); }
    else if (d.pick != null) { if (pop && pop.kind === d.pick) { pop = null; draw(); } else openPop(d.pick); }
    else if (d.popI != null) choose(+d.popI);
    else if (d.tool != null) { if (open.has(d.tool)) open.delete(d.tool); else open.add(d.tool); draw(); }
    else if (d.turnCopy != null) copyText(turnText((conv && conv.turns) || [], d.turnCopy));
    else if (d.turnUndo != null) undoFrom(d.turnUndo);
    else if (d.turnFork != null) fork(d.turnFork);
    else if (d.mcp != null) mcpSwitch(d.mcp, d.mcpOn === '1');
    else if (d.statusClose != null) { status = null; draw(); }
    else if (d.copy != null) {
      const code = b.parentElement && b.parentElement.querySelector('code');
      if (code && navigator.clipboard) navigator.clipboard.writeText(code.textContent).then(() => ws.toast('Copied.', { kind: 'success' }), () => {});
    }
    else if (d.perm != null || d.qPick != null || d.qSend != null || d.qReject != null) {
      const r = promptClick(d, (conv && conv.prompts) || [], { answers, custom });
      if (r && r.answer) answer(r.answer); else if (r && r.redraw) draw();
    }
    // The workbench (Chat 4.0.0): its buttons in the header, a file to open in Files, a picture to look at.
    else if (d.bench != null) { if (d.bench === 'side' && !sel) { ws.toast('Open a chat first. A side chat asks about the chat in view.', { kind: 'warn' }); return; } bench.toggle(d.bench); }
    else if (d.openFile != null) { bench.open('files', { focus: false }); workFiles.open(d.openFile); }
    else if (d.imgView != null) viewPicture(b.querySelector('img'));
    else if (d.picX != null) { const k = key(); pics[k] = (pics[k] || []).filter(p => p.id !== d.picX); draw(); focusBox(); }
    // A Sources chip (sources.js, Workshop docs/knowledge.md): open where the fact is kept.
    else if (d.srcNote != null) ws.open({ app: 'notes', path: d.srcNote });
    else if (d.srcWrong != null) { ws.open({ app: 'notes', path: d.srcWrong }); ws.toast('Fix the line in Notes. Tandem reads the note as you leave it.'); }
    else if (d.srcPage != null) ws.open({ app: 'settings', path: d.srcPage });
  });

  /* Pictures and PDFs: paste into the box, or drop anywhere on the composer. */
  el.addEventListener('paste', e => {
    if (!e.target.matches || !e.target.matches('[data-keep^="chat:"]')) return;
    const files = picturesIn(e.clipboardData, { paste: true });
    const pdfs = docsIn(e.clipboardData);
    if (files.length || pdfs.length) { e.preventDefault(); if (files.length) takePictures(files); if (pdfs.length) takeDocs(pdfs); }
  });
  el.addEventListener('dragover', e => { if (e.target.closest && e.target.closest('[data-chat-drop]') && e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); e.target.closest('[data-chat-drop]').classList.add('drop'); } });
  el.addEventListener('dragleave', e => { const box = e.target.closest && e.target.closest('[data-chat-drop]'); if (box && !box.contains(e.relatedTarget)) box.classList.remove('drop'); });
  el.addEventListener('drop', e => {
    const box = e.target.closest && e.target.closest('[data-chat-drop]');
    if (!box) return;
    box.classList.remove('drop');
    const files = picturesIn(e.dataTransfer);
    const pdfs = docsIn(e.dataTransfer);
    if (files.length || pdfs.length) { e.preventDefault(); if (files.length) takePictures(files); if (pdfs.length) takeDocs(pdfs); }
  });
  // Several chats (Chat 4.2.0): Alt+N new chat, Alt+Up/Down the chat above or below, Alt+J the next that needs you.
  document.addEventListener('keydown', e => {
    if (!visible) return;
    const k = chatKey(e);
    if (!k) return;
    if (e.target && e.target.closest && e.target.closest('.monaco-editor, .xterm')) return; // the editor and terminal keep their keys
    e.preventDefault();
    if (k === 'new') { leaveRewrite(); select(null); return; }
    const to = k === 'jump' ? nextNeedy(order(), sel, needsYou) : stepChat(order(), sel, k === 'prev' ? -1 : 1);
    if (k === 'jump' && !to) { flash('No chat needs you right now.'); return; }
    if (to && to !== sel) select(to);
  });
  // Ctrl+` opens or closes the terminal, as in most editors.
  document.addEventListener('keydown', e => {
    if (!visible || !e.ctrlKey || e.altKey || e.metaKey || (e.key !== '`' && e.code !== 'Backquote')) return;
    e.preventDefault();
    bench.toggle('terminal');
    if (!bench.state().open) focusBox();
  });
  if (typeof window !== 'undefined') window.addEventListener('beforeunload', e => { if (workFiles.unsaved().length) { e.preventDefault(); e.returnValue = ''; } });

  /* Chat 4.7.0 (connector 1.41.0): a local model that sat idle is unloaded by its server; ask the connector to load it
     again as Chat comes into view or you start typing, so the answer does not wait for that. At most once a minute. */
  let warmAt = 0;
  const warm = () => {
    if (!aiReady().ready || Date.now() - warmAt < 60000) return;
    warmAt = Date.now();
    ws.connectors.call(OC, 'chat.warm', {}).catch(() => {});
  };
  ws.on('visible', p => { inView = !!(p && p.visible); if (inView) warm(); });
  el.addEventListener('focusin', warm);
  if (rewrite) rewrite.setBar({ picks: picksHtml, pop: popHtml });
  draw();
  bench.start();
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
    /* A question from the hub (Chat 4.5.0): a quick answer in a new chat. False when this opencode has no Quick. */
    quick(text) {
      if (!canQuick() || !aiReady().ready) return false;
      select(null);
      run(null, { parsed: { kind: 'text', text }, files: [], pics: [], docs: [], text, quick: true, ...(modelFromKey(pick.model) ? { model: modelFromKey(pick.model) } : {}) });
      return true;
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
