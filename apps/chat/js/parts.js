/* Chat: drawing a turn's parts and reading the composer, like the opencode TUI (docs/chat.md). No DOM, so Node tests
   import it (test/parts.test.mjs).

   Parts come from the opencode connector's chat.messages (connectors/opencode/lib/chat-parts.mjs): text, reasoning,
   tool calls (with output, diffs, todos and subagent sessions), files, patches and compaction. Everything from
   opencode is escaped. Tool calls and thinking fold; which ones are open is the caller's (`open`, a Set of keys). */
import { esc, mdHtml } from './md.js';

/* ---------- the composer ---------- */

/** Commands Chat handles itself, like the TUI's. Anything else after / is one of opencode's commands. */
export const BUILTINS = [
  { name: 'new', description: 'Start a new chat' },
  { name: 'undo', description: 'Undo the last message and its file changes' },
  { name: 'redo', description: 'Bring back what undo took back' },
  { name: 'compact', description: 'Summarize this chat to free up context' },
  { name: 'models', description: 'Pick a model' },
  { name: 'agents', description: 'Pick an agent' },
  { name: 'sessions', description: 'Show every opencode session' },
  { name: 'export', description: 'Save the last answer as a note' },
  { name: 'terminal', description: 'Open this chat in the opencode terminal' },
  { name: 'details', description: 'Show or hide tool details' },
  { name: 'help', description: 'What you can type here' }
];
const BUILTIN = new Set(BUILTINS.map(b => b.name));

/**
 * What the composer's text asks for:
 * - {kind: 'shell', command} for !command
 * - {kind: 'builtin', name, args} for one of BUILTINS
 * - {kind: 'command', name, args} for any other /name
 * - {kind: 'text', text} otherwise. A leading // sends a message that starts with /.
 */
export function parseInput(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return { kind: 'empty' };
  if (text.startsWith('!')) { const command = text.slice(1).trim(); return command ? { kind: 'shell', command } : { kind: 'empty' }; }
  if (text.startsWith('//')) return { kind: 'text', text: text.slice(1) };
  const m = /^\/([A-Za-z0-9._:-]+)(?:\s+([\s\S]*))?$/.exec(text);
  if (m) {
    const name = m[1], args = (m[2] || '').trim();
    return BUILTIN.has(name) ? { kind: 'builtin', name, args } : { kind: 'command', name, args };
  }
  return { kind: 'text', text };
}

/** The word being typed for a popup: {kind: 'slash', q} at the start of the box, {kind: 'file', q, start} after @. */
export function popupFor(text, caret) {
  const before = String(text || '').slice(0, caret == null ? String(text || '').length : caret);
  const slash = /^\/([A-Za-z0-9._:-]*)$/.exec(before);
  if (slash) return { kind: 'slash', q: slash[1] };
  const at = /(^|\s)@([^\s@]*)$/.exec(before);
  if (at) return { kind: 'file', q: at[2], start: before.length - at[2].length - 1 };
  return null;
}

/** Commands for the / popup: Chat's own, then opencode's, prefix matches first. */
export function matchCommands(q, commands = []) {
  const want = String(q || '').toLowerCase();
  const seen = new Set();
  const all = [...BUILTINS.map(c => ({ ...c, builtin: true })), ...commands.filter(c => c && c.name && !BUILTIN.has(c.name))]
    .filter(c => { if (seen.has(c.name)) return false; seen.add(c.name); return true; });
  const starts = all.filter(c => c.name.toLowerCase().startsWith(want));
  const has = all.filter(c => !c.name.toLowerCase().startsWith(want) && c.name.toLowerCase().includes(want));
  return starts.concat(has).slice(0, 40);
}

/** @files still in the text, from those picked in the @ popup. */
export function filesIn(text, picked) {
  const t = String(text || '');
  return [...(picked || [])].filter(f => new RegExp(`(^|\\s)@${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`).test(t));
}

/** Models that match a filter, by provider then name. */
export function matchModels(q, models = []) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  return models.filter(m => { const s = `${m.providerName} ${m.provider} ${m.name} ${m.id}`.toLowerCase(); return words.every(w => s.includes(w)); });
}
export const modelKey = m => (m && m.provider && m.id ? `${m.provider}/${m.id}` : '');
export function modelFromKey(key) {
  const k = String(key || ''), i = k.indexOf('/');
  return i > 0 ? { provider: k.slice(0, i), id: k.slice(i + 1) } : null;
}
/** A short model name for the chip: the model's own name when opencode gave one. */
export function modelLabel(key, models = []) {
  const m = modelFromKey(key);
  if (!m) return 'Default model';
  const found = models.find(x => x.provider === m.provider && x.id === m.id);
  return found ? found.name : m.id;
}

/** The next agent for Tab (or the one before for Shift+Tab). */
export function cycleAgent(list, current, back = false) {
  const names = (list || []).map(a => (typeof a === 'string' ? a : a.name)).filter(Boolean);
  if (!names.length) return current;
  const i = names.indexOf(current);
  return names[(i + (back ? -1 : 1) + names.length) % names.length];
}

/* ---------- numbers ---------- */
export function tokens(n) {
  const v = Number(n) || 0;
  if (v < 1000) return String(v);
  if (v < 1e6) return `${(v / 1000).toFixed(v < 1e4 ? 1 : 0)}k`;
  return `${(v / 1e6).toFixed(1)}M`;
}
export const money = n => (Number(n) > 0 ? `$${Number(n) < 0.01 ? Number(n).toFixed(4) : Number(n).toFixed(2)}` : '');

/* ---------- the transcript ---------- */

const TOOL_NAMES = { bash: 'Shell', read: 'Read', edit: 'Edit', write: 'Write', patch: 'Patch', grep: 'Search', glob: 'Find files', list: 'List', webfetch: 'Fetch', task: 'Subagent', todowrite: 'To-dos', todoread: 'To-dos', invalid: 'Invalid tool call' };
export const toolName = t => TOOL_NAMES[t] || t;

/** A unified diff (or added lines) with + and - lines marked. */
export function diffHtml(diff) {
  const rows = String(diff || '').split('\n').filter(l => !/^(Index:|={3,}|diff --git)/.test(l)).map(l => {
    const cls = /^(\+\+\+|---)/.test(l) ? 'df-file' : l.startsWith('@@') ? 'df-hunk' : l.startsWith('+') ? 'df-add' : l.startsWith('-') ? 'df-del' : '';
    return `<span${cls ? ` class="${cls}"` : ''}>${esc(l) || ' '}</span>`;
  });
  return `<pre class="diff">${rows.join('\n')}</pre>`;
}

function todosHtml(list) {
  return `<ul class="todos">${list.map(t => `<li class="td-${esc(String(t.status).replace(/[^a-z_]/g, ''))}"><span class="task${t.status === 'completed' ? ' done' : ''}" aria-hidden="true"></span>${esc(t.content)}</li>`).join('')}</ul>`;
}

const STATUS_WORD = { pending: 'Waiting', running: 'Running', error: 'Failed', completed: '' };

/** One tool call: a line you can open, with what it did. `details`: open everything that has output. */
export function toolHtml(p, key, { open, details = false } = {}) {
  if (p.todos && p.todos.length) return `<div class="tool tool-todos"><p class="tool-line"><span class="tool-n">${esc(toolName(p.tool))}</span></p>${todosHtml(p.todos)}</div>`;
  const hasBody = !!(p.output || p.diff || p.error);
  // `open` holds the keys you flipped from their default (open for diffs and failures, or everything with details).
  const byDefault = details || p.status === 'error' || !!p.diff;
  const isOpen = hasBody && (open && open.has(key) ? !byDefault : byDefault);
  const running = p.status === 'running' || p.status === 'pending';
  const word = STATUS_WORD[p.status] || '';
  const head = `<span class="tool-n">${esc(toolName(p.tool))}</span><span class="tool-s">${esc(p.input || p.title || '')}</span>` +
    (running ? '<span class="spin" aria-hidden="true"></span>' : '') + (word ? `<span class="tool-w">${esc(word)}</span>` : '') +
    (p.child ? `<button type="button" class="lnk tool-open" data-chat-open="${esc(p.child)}">Open</button>` : '');
  const line = hasBody
    ? `<button type="button" class="tool-line" data-tool="${esc(key)}" aria-expanded="${isOpen}"><span class="chev" aria-hidden="true"></span>${head}</button>`
    : `<p class="tool-line">${head}</p>`;
  let body = '';
  if (isOpen) {
    if (p.diff) body += diffHtml(p.diff);
    if (p.output && !p.diff) body += `<pre class="out">${esc(p.output)}</pre>`;
    if (p.error) body += `<pre class="out err">${esc(p.error)}</pre>`;
  }
  return `<div class="tool st-${esc(p.status)}">${line}${body}</div>`;
}

/** The parts of one of opencode's turns. */
export function partsHtml(turn, { open, details = false } = {}) {
  const id = (turn && turn.id) || '';
  const parts = (turn && turn.parts) || [];
  const out = [];
  parts.forEach((p, i) => {
    const key = `${id}:${i}`;
    if (p.type === 'text') out.push(`<div class="md">${mdHtml(p.text)}</div>`);
    else if (p.type === 'reasoning') {
      const o = open && open.has(key) ? !details : details;
      out.push(`<div class="think"><button type="button" class="think-h" data-tool="${esc(key)}" aria-expanded="${o}"><span class="chev" aria-hidden="true"></span>Thinking</button>${o ? `<div class="think-b">${mdHtml(p.text)}</div>` : ''}</div>`);
    } else if (p.type === 'tool') out.push(toolHtml(p, key, { open, details }));
    else if (p.type === 'file') out.push(`<p class="att"><span class="att-chip">${esc(p.name)}</span></p>`);
    else if (p.type === 'patch' && p.files && p.files.length) out.push(`<p class="tool-sum">Changed ${p.files.length === 1 ? esc(p.files[0]) : `${p.files.length} files: ${p.files.map(esc).join(', ')}`}</p>`);
    else if (p.type === 'subtask') out.push(`<p class="tool-sum">Subagent ${esc(p.agent)}: ${esc(p.text)}</p>`);
    else if (p.type === 'compaction') out.push('<p class="divider"><span>Compacted</span></p>');
  });
  if (turn && turn.error) out.push(`<p class="hub-error">${esc(turn.error)}</p>`);
  return out.join('');
}

/** The small line under an answer: agent, model, tokens and cost. */
export function metaHtml(turn) {
  if (!turn) return '';
  const bits = [];
  if (turn.agent) bits.push(esc(turn.agent));
  if (turn.model) bits.push(esc(turn.model.id));
  if (turn.tokens) { const t = turn.tokens; const n = t.input + t.output + t.reasoning + t.cacheRead + t.cacheWrite; if (n) bits.push(`${tokens(n)} tokens`); }
  const c = money(turn.cost);
  if (c) bits.push(c);
  return bits.length ? `<p class="turn-meta">${bits.join(' · ')}</p>` : '';
}

/** Turns as HTML rows. Consecutive answers from opencode (one per step) share one block and one meta line. */
export function richRows(turns, { open, details = false, busy = false, activity = '' } = {}) {
  const list = Array.isArray(turns) ? turns : [];
  const rows = [];
  let lastAgent = null;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t.role === 'you') {
      const files = (t.parts || []).filter(p => p.type === 'file').map(p => `<span class="att-chip">${esc(p.name)}</span>`).join('');
      // The agent shows only when it changed from your last message (Chat 2.3.0): the picker already says which.
      const tag = t.agent && lastAgent !== null && t.agent !== lastAgent ? `<span class="you-agent">${esc(t.agent)}</span>` : '';
      if (t.agent) lastAgent = t.agent;
      rows.push(`<div class="turn you"><span class="who">You</span><div class="tx">${esc(t.text)}${files ? `<span class="att">${files}</span>` : ''}</div>${tag}</div>`);
      continue;
    }
    const group = [t];
    while (i + 1 < list.length && list[i + 1].role !== 'you') group.push(list[++i]);
    const body = group.map(g => (g.parts ? partsHtml(g, { open, details }) : `<div class="md">${mdHtml(g.text)}</div>`)).join('');
    const last = group[group.length - 1];
    const sum = group.reduce((a, g) => a + (Number(g.cost) || 0), 0);
    const meta = metaHtml({ ...last, cost: sum });
    rows.push(`<div class="turn tandem"><span class="who">opencode</span><div class="tx">${body}${meta}</div></div>`);
  }
  if (busy) rows.push(`<div class="turn tandem writing"><span class="who">opencode</span><div class="tx"><span class="spin" aria-hidden="true"></span> ${esc(activity || 'Working')}...</div></div>`);
  return rows.join('');
}

/* ---------- permission prompts and questions, answered in the thread ---------- */

const PERMISSION_WORDS = { bash: 'run a command', edit: 'change a file', write: 'write a file', webfetch: 'fetch a web page', external_directory: 'work outside the workspace', doom_loop: 'keep going after repeating itself' };

/** A permission prompt or question from opencode, with the controls to answer it (data-perm, data-q-*). */
export function promptHtml(p, { answers = {}, custom = {} } = {}) {
  if (p.kind === 'permission') {
    const what = PERMISSION_WORDS[p.permission] || (p.permission ? `use ${p.permission}` : 'go on');
    const detail = p.title || (p.patterns || []).join(', ');
    const always = (p.always || []).length ? ` title="Allow ${esc(p.always.join(', '))} for the rest of this opencode session"` : '';
    return `<div class="ask perm" role="group" aria-label="opencode asks"><p class="ask-q">opencode wants to <b>${esc(what)}</b></p>` +
      (detail ? `<pre class="ask-d">${esc(detail)}</pre>` : '') + (p.message ? `<p class="ask-m">${esc(p.message)}</p>` : '') +
      `<p class="ask-btns"><button type="button" class="btn primary" data-perm="once" data-id="${esc(p.id)}">Allow once</button>` +
      `<button type="button" class="btn" data-perm="always" data-id="${esc(p.id)}"${always}>Always allow</button>` +
      `<button type="button" class="btn ghost" data-perm="reject" data-id="${esc(p.id)}">Reject</button></p></div>`;
  }
  const picked = answers[p.id] || [];
  const qs = (p.questions || []).map((q, qi) => {
    const mine = picked[qi] || [];
    const opts = (q.options || []).map(o => `<button type="button" class="chip${mine.includes(o.label) ? ' on' : ''}" data-q-pick="${esc(p.id)}" data-qi="${qi}" data-label="${esc(o.label)}" aria-pressed="${mine.includes(o.label)}"${o.description ? ` title="${esc(o.description)}"` : ''}>${esc(o.label)}</button>`).join('');
    const box = q.custom !== false ? `<input class="ask-in" data-keep="q:${esc(p.id)}:${qi}" data-q-custom="${esc(p.id)}" data-qi="${qi}" placeholder="Or type an answer" value="${esc((custom[p.id] || {})[qi] || '')}">` : '';
    return `<div class="ask-one">${q.header ? `<p class="ask-h">${esc(q.header)}</p>` : ''}<p class="ask-q">${esc(q.question)}</p>${q.multiple ? '<p class="ask-m">Pick any.</p>' : ''}<div class="ask-opts">${opts}</div>${box}</div>`;
  }).join('');
  return `<div class="ask" role="group" aria-label="opencode asks">${p.title ? `<p class="ask-h">${esc(p.title)}</p>` : ''}${qs}` +
    `<p class="ask-btns"><button type="button" class="btn primary" data-q-send="${esc(p.id)}">Answer</button><button type="button" class="btn ghost" data-q-reject="${esc(p.id)}">Dismiss</button></p></div>`;
}

/** The answers to send for a question: per question, the picked labels, or the typed answer when there is one. */
export function questionAnswers(p, answers = {}, custom = {}) {
  return (p.questions || []).map((q, qi) => {
    const typed = String((custom[p.id] || {})[qi] || '').trim();
    if (typed) return [typed];
    return ((answers[p.id] || [])[qi] || []).slice();
  });
}

/** Turns after an undo's message are hidden until redo (or the next message drops them). */
export function splitRevert(turns, revertId) {
  const list = Array.isArray(turns) ? turns : [];
  if (!revertId) return { shown: list, undone: 0 };
  const i = list.findIndex(t => t.id === revertId);
  if (i < 0) return { shown: list, undone: 0 };
  return { shown: list.slice(0, i), undone: list.slice(i).filter(t => t.role === 'you').length };
}

export const HELP = [
  ['Enter', 'Send'], ['Shift+Enter', 'New line'], ['Tab, Shift+Tab', 'Switch agent'], ['/', 'Commands (yours and opencode\'s)'],
  ['@', 'Attach a workspace file'], ['!', 'Run a shell command in the workspace'], ['Up', 'Last message (empty box)'], ['Esc twice', 'Stop opencode']
];
