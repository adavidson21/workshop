/* Agents: the page, as HTML strings, from the state in state.js. No DOM, no connection: main.js paints
   what render() returns and handles the clicks. Ported from eng-agents' dashboard.template.html
   (Dashboard 1.6.1, live mode). What changed from the template:
   - Live mode only. The static page stays in eng-agents (/dashboard static).
   - Data comes from the opencode connector's `state` action; buttons call its actions (main.js).
   - .work files open in a sheet here (the `file.read` action) instead of a /files/ link.
   - The shell owns the theme and the name: no theme menu and no brand when embedded.
   - No update checks (the connector makes none). */
import { S } from './state.js';

// ---------------------------------------------------------------- helpers
export function h(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Inline `code` and **bold** only, plus "- " list lines as bullets. Everything else stays plain text.
export function md(s) {
  return h(s).replace(/^\s*[-*]\s+/gm, '• ').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
// Only http(s) links leave the app, in a new tab.
function safeUrl(u) { return /^https?:\/\//i.test(String(u || '')) ? String(u) : null; }
function link(href, text, cls) {
  const u = safeUrl(href);
  if (!u) return cls ? `<span class="${cls}">${h(text)}</span>` : h(text);
  return `<a href="${h(u)}" target="_blank" rel="noopener"${cls ? ` class="${cls}"` : ''}>${h(text)}</a>`;
}
function fileBtn(folder, name, cls, label) {
  return `<button type="button" class="lnk${cls ? ' ' + cls : ''}" data-file="${h(folder)}" data-name="${h(name)}">${h(label || name)}</button>`;
}
export function copyBtn(text, label) {
  S.copyStore.push(text);
  return `<button type="button" class="copy" data-copy="${S.copyStore.length - 1}" aria-label="Copy ${h(text)}">${label || 'Copy'}</button>`;
}
export function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

export function ago(ms) {
  const m = Math.round((S.now - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const hr = Math.round(m / 60);
  if (hr < 24) return plural(hr, 'hour') + ' ago';
  const d = Math.round(hr / 24);
  if (d < 14) return plural(d, 'day') + ' ago';
  return Math.round(d / 7) + ' weeks ago';
}
export function dayKey(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function dayName(s) {
  const k = (s || '').slice(0, 10);
  if (k === S.today) return 'Today';
  if (k === S.yest) return 'Yesterday';
  const p = k.split('-');
  if (p.length !== 3) return s;
  return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
export function timeOf(ms) { return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }

// ------------------------------------------------------------ live state helpers
const L = () => S.L;
export function ocReady() { return S.conn === 'on' && !!L() && !!L().opencode && !!L().opencode.connected; }
export function itemSession(it) {
  if (!L() || !L().items[it.folder]) return null;
  const id = L().items[it.folder].current;
  return id && L().sessions[id] ? L().sessions[id] : null;
}
export function itemPerms(it) { return L() ? L().permissions.filter(p => p.folder === it.folder) : []; }
export function itemQs(it) { return L() ? L().questions.filter(q => q.folder === it.folder) : []; }
export function isBusy(s) { return !!s && !!s.status && s.status !== 'idle'; }
export function asking(it) { return itemPerms(it).length + itemQs(it).length > 0; }
export function itemAuto(it) { return L() && L().autopilot ? L().autopilot[it.folder] || null : null; }
export function autoIs(it, status) { const a = itemAuto(it); return !!a && a.status === status; }
export function bucketOf(it) {
  if (it.kind === 'item' && (asking(it) || autoIs(it, 'waiting'))) return 'needs';
  if (it.kind === 'item' && autoIs(it, 'running') && it.bucket === 'needs') return 'active';
  if (it.kind !== 'item' && asking(it)) return 'notes';
  return it.bucket;
}
// A command to run for spikes, docs, and TSDs, from their "next" text: the first `/command ...`.
function noteCommand(it) {
  const m = /`(\/[a-z][a-z0-9-]*[^`]*)`/i.exec(it.nextText || '');
  return m ? m[1].trim() : null;
}
function openAttr(key, dflt) {
  const v = Object.prototype.hasOwnProperty.call(S.ui.open, key) ? S.ui.open[key] : dflt;
  return ` data-key="${h(key)}"` + (v ? ' open' : '');
}
export function itemForFolder(folder) {
  return ((S.D && S.D.items) || []).filter(x => x.folder === folder)[0] || null;
}
// The element id for an item: its work item id, or its folder for spikes, docs and TSDs.
export function itemKey(it) { return it.id ? String(it.id) : it.folder; }

// ------------------------------------------------------------ state colors
export function stateVar(it) {
  if (asking(it) || autoIs(it, 'waiting')) return 'var(--gate)';
  if (it.bucket === 'paused') return 'var(--hold)';
  if (it.blocked) return 'var(--stop)';
  if (bucketOf(it) === 'needs') return 'var(--gate)';
  return 'var(--go)';
}

// --------------------------------------------------------------- the track
// Done stages are checked, the current one is a filled label in the item's state color with what is
// happening under it, later stages are faint with a dashed line.
const STOPS = {
  feature: [['start', 'Start'], ['spec', 'Spec'], ['plan', 'Plan'], ['tasks', 'Tasks'], ['build', 'Build'], ['review', 'Review'], ['pr', 'PR']],
  bug: [['start', 'Start'], ['bug', 'Bug'], ['build', 'Build'], ['review', 'Review'], ['pr', 'PR']]
};
const CHECK = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.3l2.3 2.3 4.7-5"/></svg>';
function hereSub(it, key) {
  if (it.paused) return 'Paused';
  if (it.blocked) return 'Blocked';
  if (asking(it)) return 'Waiting on you';
  if (autoIs(it, 'running') || isBusy(itemSession(it))) return 'Working';
  if (it.stage === 'ship') return 'Ready to open';
  const n = it.next || {};
  if (n.needsYou) return key === 'review' ? 'Pick fixes' : 'Approve';
  if (key === 'build' && it.tasks && it.tasks.total) return it.tasks.done + ' of ' + it.tasks.total + ' done';
  return 'Up next';
}
function doneTip(it, key) {
  const g = { spec: 'spec', plan: 'plan', bug: 'bug', review: 'review' }[key];
  const v = g && it.gates ? it.gates[g] : null;
  if (v === 'APPROVED') return key + '.md approved';
  if (v === 'READY') return 'Review: READY';
  if (key === 'build' && it.tasks && it.tasks.total) return plural(it.tasks.total, 'task') + ' done';
  return 'Done';
}
export function track(it) {
  const stops = STOPS[it.lane] || STOPS.feature;
  let idx = -1;
  for (let i = 0; i < stops.length; i++) if (stops[i][0] === it.stage) idx = i;
  if (it.stage === 'ship') idx = stops.length - 1; // PR text written: the PR stage is where it waits
  let out = `<div class="track" role="img" aria-label="${h(trackLabel(it, stops, idx))}" style="--state:${stateVar(it)}">`;
  for (let j = 0; j < stops.length; j++) {
    const key = stops[j][0];
    const cls = j < idx ? 'done' : (j === idx ? 'here' : '');
    const sub = cls === 'here' ? hereSub(it, key) : (cls === 'done' && key === 'build' && it.tasks && it.tasks.total ? it.tasks.done + '/' + it.tasks.total : '');
    const tip = cls === 'done' ? doneTip(it, key) : cls === 'here' ? 'Now: ' + stops[j][1] + ', ' + sub : 'Not started';
    out += `<div class="stop ${cls}" title="${h(tip)}"><span class="dot">${cls === 'done' ? CHECK : ''}</span><span class="name">${stops[j][1]}</span><span class="sub">${h(sub)}</span></div>`;
    if (j < stops.length - 1) out += `<div class="rail${j < idx ? ' done' : ''}"></div>`;
  }
  return out + '</div>';
}
function trackLabel(it, stops, idx) {
  if (idx < 0) return 'Stage unknown';
  return 'Stage ' + (idx + 1) + ' of ' + stops.length + ': ' + stops[idx][1] + ', ' + hereSub(it, stops[idx][0]);
}

// --------------------------------------------------------------- next step
// One main button per step; the command is in its tooltip. label: the button text (default "Run").
// quiet: a secondary button next to a primary one.
function runBtn(it, cmd, label, quiet) {
  if (!cmd) return '';
  const s = itemSession(it);
  const fresh = /^\/(do-task|check-docs)\b/.test(cmd);
  const blocked = !ocReady() ? 'opencode is not connected' : (autoIs(it, 'running') ? 'Autopilot is running this item' : (isBusy(s) && !fresh ? "This item's session is still working" : (S.ui.busy[it.folder] ? 'Starting' : '')));
  const tip = blocked || ('Runs ' + cmd + ' in opencode' + (fresh ? ' in a new session' : (s ? " in this item's session" : ' in a new session for this item')));
  return `<button type="button" class="btn${quiet ? '' : ' primary'}" data-run="${h(it.folder)}" data-cmd="${h(cmd)}" title="${h(tip)}"${blocked ? ' disabled' : ''}>${h(label || 'Run')}</button>`;
}
// The file to read before approving, for "Review spec.md" style steps.
function gateFileLink(it) {
  if (it.paused || !it.next || !it.next.needsYou) return '';
  const f = { spec: 'spec.md', plan: 'plan.md', bug: 'bug.md', review: 'review.md' }[it.next.stage];
  if (!f || !it.files || it.files.indexOf(f) < 0) return '';
  return fileBtn(it.folder, f, 'then', 'Open ' + f);
}
// The step in plain words. The words come from New-Dashboard.ps1 (stepWords), the one place that defines them.
export function cmdWords(it, cmd) {
  const p = String(cmd).split(/\s+/), name = p[0].replace(/^\//, '');
  if (name === 'do-task') {
    const n = +p[2], t = ((it.tasks && it.tasks.list) || []).filter(x => x.n === n)[0];
    return 'Task ' + n + (t ? ': ' + t.title : '');
  }
  return ((S.D && S.D.stepWords) || {})[name] || cmd;
}
export function nextHtml(it, big) {
  const n = it.next || {};
  const cmd = it.paused ? '/resume ' + it.id : n.command;
  const act = it.paused ? null : n.action;
  const running = autoIs(it, 'running');
  const kind = running || autoIs(it, 'waiting') ? null : autoStartKind(it);
  const name = cmd ? cmd.split(/\s+/)[0] : '';
  const text = act ? md(act) : cmd ? h(cmdWords(it, cmd)) : '';
  let btns = '';
  if (!running) {
    if (kind) btns += autoBtn(it, kind, kind === 'approve-start' ? 'Approve and build' : 'Build with autopilot', 'primary', autoTip(it, kind), '');
    if (cmd) btns += runBtn(it, cmd, name === '/approve' ? (kind ? 'Approve only' : 'Approve') : name === '/resume' ? 'Resume' : kind ? 'Run next step only' : 'Run', !!kind || autoIs(it, 'waiting'));
  }
  const note = n.note && !it.paused ? liveNote(n.note) : '';
  if (big) {
    return `<div class="do"><span class="act">${text}</span>${gateFileLink(it)}` + (btns ? `<span class="row" style="margin-left:auto">${btns}</span>` : '') + '</div>';
  }
  return `<div class="next-line"><span class="lbl">Next</span><span class="act">${text}</span>${gateFileLink(it)}${btns}` + (note ? `<span class="then">${md(note)}</span>` : '') + '</div>';
}
// This page opens new sessions by itself, so drop "start a new session" advice.
export function liveNote(note) {
  return String(note).replace(/\s*After approval:.*$/i, '').replace(/\s*Start a new session \(\/new\)( first| before \/do-task)?\.?/gi, '').replace(/Start a new session,? (and run|then) /gi, 'Run ').trim();
}

function leftOffHtml(it) {
  let body = '';
  if (it.paused) {
    const p = it.paused;
    body += `<span class="held">Paused${p.since ? ' since ' + h(p.since) : ''}</span>` + (p.reason ? ': ' + md(p.reason) : '.');
    if (p.inProgress && !/^none/i.test(p.inProgress)) body += '<br>In progress: ' + md(p.inProgress);
    if (p.wip) body += `<div class="pre">${md(p.wip)}</div>`;
    if (p.waiting) body += `<div><span class="dim">Waiting on:</span> <span class="pre">${md(p.waiting)}</span></div>`;
  } else if (it.last) {
    const l = it.last;
    body += `<span class="when">${h(dayName(l.date))}, <code>${h(l.command)}</code>${l.agent ? ' (' + h(l.agent) + ')' : ''}:</span> ` + md(l.did || 'No summary.');
    if (it.blocked) body += '<br><span class="alert">Blocked:</span> ' + md(it.blocked);
    else if (l.notes) body += '<br><span class="dim">Notes:</span> ' + md(l.notes);
    if (l.verify && !it.blocked) body += '<br><span class="dim">Verify:</span> ' + md(l.verify);
  } else {
    body = '<span class="dim">Nothing in progress.md yet.</span>';
  }
  return `<div class="left-off"><span class="lbl">Left off</span><div class="body">${body}</div></div>`;
}

// ------------------------------------------------------------- agent panel
function permHtml(p, showWho) {
  const s = L().sessions[p.sessionID];
  const what = p.title || (p.patterns || []).join(', ');
  const who = showWho ? `<p class="q-h">${h((s && s.title) || p.sessionID)}</p>` : '';
  const always = (p.always || []).length ? ' (' + (p.always || []).join(', ') + ')' : '';
  return `<div class="ask">${who}<p class="q">Allow <strong>${h(p.permission)}</strong>${what ? ': <code>' + h(what) + '</code>' : ''}</p>` +
    '<div class="row">' +
    `<button type="button" class="btn warn" data-perm="${h(p.id)}" data-answer="once">Allow once</button>` +
    `<button type="button" class="btn" data-perm="${h(p.id)}" data-answer="always" title="Stop asking for this in this session${h(always)}">Always allow</button>` +
    `<button type="button" class="btn danger" data-perm="${h(p.id)}" data-answer="reject">Reject</button>` +
    '</div></div>';
}
function questionHtml(q, showWho) {
  const s = L().sessions[q.sessionID];
  const picks = S.ui.picks[q.id] || {};
  let out = `<div class="ask" data-qform="${h(q.id)}">`;
  if (showWho) out += `<p class="q-h">${h((s && s.title) || q.sessionID)}</p>`;
  (q.questions || []).forEach((qq, i) => {
    const name = q.id + '-' + i;
    const chosen = picks[i] || [];
    out += (qq.header ? `<p class="q-h">${h(qq.header)}</p>` : '') + `<p class="q">${md(qq.question)}</p><div class="opts">`;
    (qq.options || []).forEach(o => {
      const on = chosen.indexOf(o.label) >= 0;
      out += `<label><input type="${qq.multiple ? 'checkbox' : 'radio'}" name="${h(name)}" value="${h(o.label)}" data-qpick="${h(q.id)}" data-qi="${i}"${on ? ' checked' : ''}>` +
        `<span>${h(o.label)}${o.description ? ' <span class="d">' + h(o.description) + '</span>' : ''}</span></label>`;
    });
    if (qq.custom !== false) {
      const draftKey = 'q:' + q.id + ':' + i;
      out += `<input type="text" placeholder="Or type your own answer" data-draft="${h(draftKey)}" value="${h(S.ui.drafts[draftKey] || '')}">`;
    }
    out += '</div>';
  });
  out += `<div class="row"><button type="button" class="btn warn" data-qsend="${h(q.id)}">Answer</button>` +
    `<button type="button" class="btn" data-qreject="${h(q.id)}">Dismiss</button></div></div>`;
  return out;
}

// ---------------------------------------------------------- autopilot
// Which start button fits: approve the waiting plan or bug analysis first, or start from an approved one.
export function autoStartKind(it) {
  if (it.kind !== 'item' || it.paused) return null;
  const n = it.next || {};
  if (n.command && /^\/approve\b/.test(n.command) && (n.stage === 'plan' || n.stage === 'bug')) return 'approve-start';
  const gate = it.lane === 'bug' ? (it.gates || {}).bug : (it.gates || {}).plan;
  return gate === 'APPROVED' && n.stage !== 'ship' ? 'start' : null;
}
function autoBtn(it, act, label, cls, tip, off) {
  const dis = off || (!ocReady() && act !== 'stop' && act !== 'dismiss' ? 'opencode is not connected' : (S.ui.busy['a:' + it.folder] ? 'Working' : ''));
  return `<button type="button" class="btn${cls ? ' ' + cls : ''}" data-auto="${h(it.folder)}" data-act="${act}" title="${h(dis || tip)}"${dis ? ' disabled' : ''}>${h(label)}</button>`;
}
function autoTip(it, kind) {
  return (kind === 'approve-start' ? 'Approves ' + (it.lane === 'bug' ? 'bug.md' : 'plan.md') + ', then runs' : 'Runs') +
    ' the rest: tasks, each task in a new session, review (fix rounds for Blockers), and PR text. Stops when it needs you. Never pushes.';
}
// Only while autopilot runs or needs you. Starting it is the main button on the Next line.
export function autoHtml(it) {
  if (!L() || it.kind !== 'item') return '';
  const a = itemAuto(it);
  if (!a || (a.status !== 'running' && a.status !== 'waiting')) return '';
  const log = a.log && a.log.length ? `<details${openAttr('a:' + it.folder, false)}><summary>Autopilot log</summary>` +
    '<ul class="hist">' + a.log.slice().reverse().map(x => `<li>${h(timeOf(Date.parse(x.at)))} ${h(x.text)}</li>`).join('') + '</ul></details>' : '';
  const rounds = a.fixRounds ? `<span class="then">fix round ${a.fixRounds} of ${a.maxFixRounds}</span>` : '';
  if (a.status === 'running') {
    return '<div class="auto run"><div class="auto-head"><span class="state"><span class="spin" aria-hidden="true"></span>Autopilot</span>' +
      (a.command ? `<span class="then" title="${h(a.command)}">${h(cmdWords(it, a.command.replace(/\s+auto$/, '')))}</span>` : '') + rounds +
      `<span class="row">${autoBtn(it, 'stop', 'Stop after this step', '', 'The current step finishes. Nothing runs after it.')}</span></div>${log}</div>`;
  }
  return `<div class="auto wait"><div class="auto-head"><span class="state">Autopilot needs you</span>${rounds}` +
    `<span class="row">${autoBtn(it, 'resume', 'Resume', 'primary', 'Re-reads .work and runs the next step')}${autoBtn(it, 'stop', 'Stop', '', 'Turn autopilot off for this item')}</span></div>` +
    `<p class="msg">${md(a.message || '')}</p>${log}</div>`;
}

export function agentHtml(it) {
  if (!L()) return '';
  const s = itemSession(it);
  const perms = itemPerms(it), qs = itemQs(it);
  const links = L().items[it.folder];
  if (!s && !perms.length && !qs.length) return '';
  const busy = isBusy(s);
  const ask = perms.length + qs.length > 0;
  let out = `<div class="agent${ask ? ' asking' : busy ? ' busy' : ''}">`;
  if (s) {
    const state = ask ? 'Waiting for you' : busy ? (s.status === 'retry' ? 'Retrying' : 'Working') : (s.error ? 'Stopped' : 'Done');
    out += `<div class="agent-head"><span class="state">${busy && !ask ? '<span class="spin" aria-hidden="true"></span>' : ''}${h(state)}</span>` +
      (s.command ? `<span class="cmdname">${h(s.command)}</span>` : '') +
      '<span class="row">' +
      (busy ? `<button type="button" class="btn danger" data-abort="${h(s.id)}">Stop</button>` : '') +
      (L().canOpenTerminal ? `<button type="button" class="btn" data-term="${h(s.id)}" title="Opens the opencode TUI on this session">Open in terminal</button>` : '') +
      (s.attach ? copyBtn(s.attach, 'Copy terminal command') : '') + '</span></div>';
    if (busy && s.activity && !ask) out += `<div class="activity" title="${h(s.activity)}">${h(s.activity)}</div>`;
    if (s.error) out += `<p class="err">${h(s.error)}</p>`;
  }
  perms.forEach(p => { out += permHtml(p, false); });
  qs.forEach(q => { out += questionHtml(q, false); });
  if (s && s.text) {
    const writing = busy && s.textAt && s.busySince && s.textAt >= s.busySince;
    out += `<p class="say-h">${writing ? 'Agent is writing' : 'Agent said'}${s.textAt ? ' (' + ago(s.textAt) + ')' : ''}</p>` +
      `<pre class="say"${writing ? ' data-follow' : ''}>${h(s.text)}</pre>`;
  }
  if (s && !busy) {
    const dk = 'r:' + s.id;
    out += `<div class="reply"><textarea data-draft="${h(dk)}" data-sid="${h(s.id)}" placeholder="Reply to the agent, or type a command (for example /status ${h(it.id || it.folder)}). Ctrl+Enter sends." aria-label="Reply to the agent">` +
      h(S.ui.drafts[dk] || '') + `</textarea><button type="button" class="btn" data-reply="${h(s.id)}">Send</button></div>`;
  }
  if (links && links.sessions.length > 1) {
    const older = links.sessions.slice(0, -1).reverse();
    out += `<details${openAttr('h:' + it.folder, false)}><summary>Earlier sessions for this item (${older.length})</summary>` +
      '<ul class="hist" style="margin-top:6px">' + older.map(x =>
        `<li><span class="ht" title="${h(x.id)}">${h(x.title || x.command || x.id)}</span>` +
        (L().canOpenTerminal ? `<button type="button" class="btn" data-term="${h(x.id)}">Open</button>` : '') + '</li>').join('') + '</ul></details>';
  }
  return out + '</div>';
}

// The item in "Pick up here" is not drawn twice: its group gets this one line instead.
function pickedRow(it) {
  return `<a class="picked" href="#pickup-h" data-jump="pickup-h" style="--state:${stateVar(it)}"><span class="num">#${h(it.id)}</span>` +
    `<span class="pt">${h(it.title)}</span><span class="dim">In Pick up here</span></a>`;
}
function agentNote(it) {
  const s = itemSession(it);
  if (!isBusy(s) && !asking(it)) return '';
  return `<p class="note">${asking(it) ? 'The agent is waiting for you' : 'The agent is working'}: see <a href="#pickup-h" data-jump="pickup-h">Pick up here</a>.</p>`;
}
// Prompts from sessions that are not linked to a .work item (for example, started in the TUI).
function waitingHtml() {
  if (!L()) return '';
  const perms = L().permissions.filter(p => !p.folder);
  const qs = L().questions.filter(q => !q.folder);
  if (!perms.length && !qs.length) return '';
  return '<section class="waiting" aria-label="Waiting for you"><h3 style="margin:0;font-size:15px">Waiting for you</h3>' +
    perms.map(p => permHtml(p, true)).join('') + qs.map(q => questionHtml(q, true)).join('') + '</section>';
}

// ------------------------------------------------------------- repo flags
function repoFlags(g, expected, paused) {
  const f = [];
  if (!g) return f;
  if (!g.exists) return [['bad', 'Folder missing']];
  if (!g.isGit) return [['bad', 'Not a git repo']];
  if (g.detached) f.push(['warn', 'Detached HEAD']);
  if (expected && g.branch && g.branch !== expected) f.push([paused ? 'info' : 'bad', 'On ' + g.branch + (paused ? ' (item is paused)' : '')]);
  if (g.changed) f.push(['warn', plural(g.changed, 'uncommitted file')]);
  if (g.ahead) f.push(['info', plural(g.ahead, 'unpushed commit')]);
  if (g.behind) f.push(['info', g.behind + ' behind remote']);
  if (g.gone) f.push(['info', 'Remote branch deleted']);
  if (g.branch && !g.upstream && g.branch !== g.defaultBranch) f.push(['info', g.unpushed ? 'Not pushed (' + plural(g.unpushed, 'commit') + ')' : 'Not pushed']);
  if (!f.length) f.push(['ok', g.upstream ? 'Clean, pushed' : 'Clean']);
  return f;
}
function flagsHtml(f) { return f.map(x => `<span class="flag ${x[0]}">${h(x[1])}</span>`).join(''); }

function reposTable(it) {
  if (!it.repos || !it.repos.length) return '<p class="dim" style="margin:0">No repos.md yet.</p>';
  const rows = it.repos.map(r => {
    const g = r.git || {};
    const l = r.links || {};
    const links = [];
    if (l.branch) links.push(link(l.branch, 'Branch'));
    if (l.pr) links.push(link(l.pr, 'Create PR'));
    const last = g.lastSha ? `<span class="dim mono">${h(g.lastSha)}</span> ${h(g.lastMsg)}` : '<span class="dim">none</span>';
    return `<tr><td><strong>${h(r.folder)}</strong>${r.shared ? ' <span class="tag">shared</span>' : ''}` +
      `<br><span class="branch">${h(r.branch || 'no branch')}</span></td>` +
      `<td>${flagsHtml(repoFlags(g, r.branch, !!it.paused))}</td><td>${last}</td>` +
      `<td><div class="links">${links.join('') || '<span class="dim">no links</span>'}</div></td></tr>`;
  }).join('');
  return `<div class="tbl-wrap"><table><thead><tr><th>Repo</th><th>State</th><th>Last commit</th><th>Links</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function tasksHtml(it) {
  const t = it.tasks;
  if (!t || !t.total) return '';
  let firstOpen = null;
  t.list.forEach(x => { if (!x.done && (firstOpen === null || x.n < firstOpen)) firstOpen = x.n; });
  const li = t.list.map(x => `<li class="${x.done ? 'done' : ''}${x.n === firstOpen ? ' first' : ''}"><span class="box" aria-hidden="true"></span><span class="tt">` +
    h(x.n + '. ' + x.title) + (x.repo ? ` <span class="rp">${h(x.repo)}</span>` : '') + '</span></li>').join('');
  return `<div><p class="sub-h">Tasks <span class="bar" aria-hidden="true"><i style="width:${Math.round(100 * t.done / t.total)}%"></i></span> ${t.done} of ${t.total} done</p><ul class="tasks">${li}</ul></div>`;
}

// The page runs commands itself. Offer the TUI on this item's session (or the server) for the terminal.
function kitHtml(it) {
  const s = it ? itemSession(it) : null;
  const cmd = s ? s.attach : (L() && L().opencode ? L().opencode.attach : null);
  if (!cmd) return '';
  return `<div class="kit"><div class="kit-head"><span>Work in the terminal (opencode TUI on ${s ? "this item's session" : 'this server'})</span></div>` +
    `<div class="kit-line"><code>${h(cmd)}</code>${copyBtn(cmd)}</div></div>`;
}
function filesHtml(it) {
  if (!it.files || !it.files.length) return '';
  return `<div><p class="sub-h">Files</p><div class="files">${it.files.map(f => fileBtn(it.folder, f)).join('')}</div></div>`;
}

// ------------------------------------------------------------- PR text (ready to ship)
function prHtml(it) {
  if (!it.pr || !it.pr.length) return '';
  const cards = it.pr.map(p => {
    const ps = p.push;
    const prLink = safeUrl(p.links && p.links.pr);
    const where = prLink && /\/_git\//.test(prLink) ? 'ADO' : prLink && /github\.com\//i.test(prLink) ? 'GitHub' : '';
    const pushed = ps && ps.remote && !ps.unpushed;
    const flag = !ps ? ['warn', 'Repo not found'] : !ps.local && !ps.remote ? ['bad', 'Branch not found'] : !ps.remote ? ['warn', 'Not pushed yet'] : ps.unpushed ? ['warn', plural(ps.unpushed, 'commit') + ' not pushed'] : ['ok', 'Pushed'];
    const head = `<div class="pr-head"><span class="rn">${h(p.repo)}</span>` +
      `<span class="branch">${h(p.branch || 'no branch')} → ${h(p.target || 'main')}</span>${flagsHtml([flag])}` +
      '<span class="row">' + (prLink ? `<a class="btn${pushed ? ' primary' : ''}" href="${h(prLink)}" target="_blank" rel="noopener" title="Opens the new pull request page with the branches filled in">Create PR${where ? ' in ' + where : ''}</a>` : '<span class="dim" style="font-size:13px">No PR link: the repo has no origin remote</span>') + '</span></div>';
    const pk = 'p:' + it.folder + ':' + p.repo;
    const pushBtn = S.conn === 'on' ? `<button type="button" class="btn primary" data-push="${h(it.folder)}" data-repo="${h(p.repo)}" title="Runs this command now. Your click is the approval."${S.ui.busy[pk] ? ' disabled' : ''}>${S.ui.busy[pk] ? 'Pushing...' : 'Push'}</button>` : '';
    const push = !pushed && p.pushCmd && ps && ps.local ? `<div class="pr-push"><span class="dim">Push first:</span><code>${h(p.pushCmd)}</code>${pushBtn || copyBtn(p.pushCmd)}</div>` : '';
    const title = p.title ? `<div class="pr-field"><div class="fh"><p class="sub-h">Title</p>${copyBtn(p.title, 'Copy title')}</div><div class="pr-title">${h(p.title)}</div></div>`
      : '<p class="dim" style="margin:0">No title in pr.md for this repo.</p>';
    const desc = p.description ? `<div class="pr-field"><div class="fh"><p class="sub-h">Description</p>${copyBtn(p.description, 'Copy description')}</div><pre class="pr-desc">${h(p.description)}</pre></div>` : '';
    return `<div class="pr">${head}${push}${title}${desc}</div>`;
  }).join('');
  const file = it.files && it.files.indexOf('pr.md') >= 0 ? ' ' + fileBtn(it.folder, 'pr.md', 'plain') : '';
  return `<div class="prbox"><p class="sub-h">Pull requests${file}</p>${cards}</div>`;
}

// ------------------------------------------------------------- remove
function removeLabel(it) { return bucketOf(it) === 'ship' ? 'Remove' : it.kind === 'item' ? 'Abandon' : 'Remove'; }
function removeBtn(it) {
  const s = itemSession(it);
  const why = autoIs(it, 'running') ? 'Autopilot is running this item. Stop it first.' : isBusy(s) ? 'The agent is still working. Stop it first.' : '';
  const tip = why || (bucketOf(it) === 'ship' ? "PR merged? Delete this item's .work folder" : "Delete this item's .work folder");
  return `<button type="button" class="btn remove" data-remove="${h(it.folder)}" title="${h(tip)}"${why ? ' disabled' : ''}>${removeLabel(it)}</button>`;
}
// What the user types to confirm a remove: the item id, or the folder for spikes, docs and TSDs.
export function removeKey(it) { return it.id ? String(it.id) : it.folder; }
export function removeSheetHtml() {
  const it = itemForFolder(S.ui.remove);
  if (!it) { S.ui.remove = null; return ''; }
  const ship = bucketOf(it) === 'ship';
  const name = it.id ? '#' + it.id + ' ' + it.title : it.title;
  const key = removeKey(it);
  const typed = (S.ui.drafts['rm:' + it.folder] || '').trim();
  let out = `<div class="sheet-head"><h3 id="rm-h">${h((ship ? 'Clean up ' : it.kind === 'item' ? 'Abandon ' : 'Remove ') + name)}?</h3><button type="button" class="ibtn" data-close-sheet="1" aria-label="Close">${ICON.x}</button></div>`;
  out += `<p>This permanently deletes <code>.work/${h(it.folder)}</code>${it.files && it.files.length ? ' (' + h(it.files.join(', ')) + ')' : ''}` +
    " and the sessions and autopilot state Workshop keeps for it. It cannot be undone.</p>";
  // Work that lives in the repos is not touched, but say so when there is some.
  const risky = [], cmds = [];
  (it.repos || []).forEach(r => {
    const g = r.git || {};
    if (!r.branch) return;
    const onIt = g.branch === r.branch;
    if (onIt && g.changed) risky.push(r.folder + ': ' + plural(g.changed, 'uncommitted file') + ' on ' + r.branch);
    if (onIt && (g.ahead || (!g.upstream && g.unpushed))) risky.push(r.folder + ': ' + plural(g.ahead || g.unpushed, 'commit') + ' not pushed');
    const rf = /\s/.test(r.folder) ? '"' + r.folder + '"' : r.folder;
    cmds.push('git -C ' + rf + ' switch ' + (g.defaultBranch || 'main'));
    cmds.push('git -C ' + rf + ' branch -D ' + r.branch);
  });
  if (risky.length) out += `<div class="ovr"><p><strong>Branches and commits stay in the repos.</strong> Still there after this:</p><ul class="gone">${risky.map(x => `<li>${h(x)}</li>`).join('')}</ul></div>`;
  else if (cmds.length) out += '<p>Branches and commits stay in the repos.</p>';
  if (cmds.length && !ship) {
    out += `<details${openAttr('rmb:' + it.folder, false)}><summary>Delete the branches too (run these yourself)</summary>` +
      `<div class="kit" style="margin-top:6px">${cmds.map(c => `<div class="kit-line"><code>${h(c)}</code>${copyBtn(c)}</div>`).join('')}</div></details>`;
  }
  out += `<label class="confirm"><span>Type <code>${h(key)}</code> to confirm</span><input type="text" autocomplete="off" spellcheck="false" data-draft="rm:${h(it.folder)}" value="${h(typed)}" aria-label="Type ${h(key)} to confirm"></label>`;
  const ok = typed === key;
  const foot = '<span class="grow"></span><button type="button" class="btn" data-close-sheet="1">Cancel</button>' +
    `<button type="button" class="btn destroy" data-remove-go="${h(it.folder)}" data-confirm="${h(key)}"${ok ? '' : ' disabled'}>${ship ? 'Delete the folder' : it.kind === 'item' ? 'Abandon and delete' : 'Delete the folder'}</button>`;
  return `<div class="modal" data-sheet="1"><div class="backdrop" data-close-sheet="1"></div><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="rm-h">${out}<footer>${foot}</footer></div></div>`;
}

// ------------------------------------------------------------- a .work file, read through file.read
function fileSheetHtml() {
  const f = S.ui.file;
  const body = f.error ? `<p class="err">${h(f.error)}</p>` : f.text == null ? '<p>Loading.</p>' : `<pre class="filetext">${h(f.text)}</pre>`;
  const foot = '<span class="grow"></span>' + (f.text ? copyBtn(f.text, 'Copy') : '') + '<button type="button" class="btn" data-close-sheet="1">Close</button>';
  return `<div class="modal" data-sheet="1"><div class="backdrop" data-close-sheet="1"></div><div class="sheet wide" role="dialog" aria-modal="true" aria-labelledby="file-h">` +
    `<div class="sheet-head"><h3 id="file-h"><code>.work/${h(f.folder)}/${h(f.name)}</code></h3><button type="button" class="ibtn" data-close-sheet="1" aria-label="Close">${ICON.x}</button></div>` +
    `${body}<footer>${foot}</footer></div></div>`;
}

function idLink(it) { return safeUrl(it.url) ? link(it.url, '#' + it.id, 'num') : `<span class="num">#${h(it.id)}</span>`; }

// ------------------------------------------------------------- item card
// noAgent: the item is also shown in "Pick up here", which carries its agent panel.
export function itemCard(it, noAgent) {
  if (it.kind !== 'item') return noteCard(it);
  const meta = [];
  meta.push(`<span class="tag ${h(it.lane)}">${h(it.lane)}${it.laneGuessed ? '?' : ''}</span>`);
  if (it.adoState) meta.push(`<span title="ADO state when the item was fetched">ADO: ${h(it.adoState)}</span>`);
  meta.push(`<span title="${h(new Date(it.modifiedMs).toLocaleString())}">Touched ${ago(it.modifiedMs)}</span>`);
  meta.push(removeBtn(it));
  const title = safeUrl(it.url) ? link(it.url, it.title) : h(it.title);
  return `<article class="item" id="item-${h(itemKey(it))}" style="--state:${stateVar(it)}">` +
    `<div class="item-head"><h4 class="t">${idLink(it)}${title}</h4><div class="meta">${meta.join('')}</div></div>` +
    track(it) + nextHtml(it, false) + (it.stage === 'ship' ? prHtml(it) : '') + (noAgent ? '' : autoHtml(it)) + (noAgent ? agentNote(it) : agentHtml(it)) + leftOffHtml(it) +
    `<details${openAttr('d:' + it.folder, false)}><summary>Repos, tasks, files</summary><div class="detail-body">` +
    reposTable(it) + tasksHtml(it) + kitHtml(it) + filesHtml(it) + '</div></details></article>';
}
function noteCard(it) {
  const label = { spike: 'Spike', docs: 'Docs', tsd: 'TSD' }[it.kind] || 'Folder';
  let body = '';
  if (it.state) body += `<p style="margin:6px 0 0"><strong>${h(it.state)}</strong></p>`;
  if (it.summary) body += `<p class="pre" style="margin:6px 0 0">${md(it.summary)}</p>`;
  if (it.nextText) body += `<div class="next-line"><span class="lbl">Next</span><span>${md(liveNote(it.nextText))}</span>${runBtn(it, noteCommand(it))}</div>`;
  return `<article class="item" id="item-${h(it.folder)}" style="--state:${asking(it) ? 'var(--gate)' : 'var(--line)'}"><div class="item-head"><h4 class="t">${h(it.title)}</h4><div class="meta"><span class="tag">${label}` +
    `</span><span>Touched ${ago(it.modifiedMs)}</span>${removeBtn(it)}</div></div>${body}${agentHtml(it)}` +
    (it.files && it.files.length ? `<details${openAttr('d:' + it.folder, false)}><summary>Files</summary><div class="detail-body">${filesHtml(it)}</div></details>` : '') + '</article>';
}

// --------------------------------------------------------- pick up here
export function pickupHtml(it) {
  let why;
  if (asking(it)) why = '<strong>The agent is waiting for you.</strong>';
  else if (it.bucket === 'paused') why = 'Nothing is moving. This is the most recent paused item.';
  else if (it.blocked) why = '<strong>Blocked.</strong> ' + md(it.blocked);
  else if (it.next && it.next.note) why = md(liveNote(it.next.note));
  else why = '';
  let lo = '';
  if (it.paused) lo = leftOffHtml(it);
  else if (it.last) lo = `<p class="why"><strong>Last:</strong> ${h(dayName(it.last.date))}, <code>${h(it.last.command)}</code>: ${md(it.last.did || '')}</p>`;
  const title = safeUrl(it.url) ? link(it.url, it.title) : h(it.title);
  return `<section class="pickup" id="item-${h(itemKey(it))}" style="--state:${stateVar(it)}" aria-labelledby="pickup-h">` +
    `<div class="pick-top"><p class="eyebrow">Pick up here, touched ${ago(it.modifiedMs)}</p>${removeBtn(it)}</div>` +
    `<h2 id="pickup-h">${idLink(it)}${title}</h2>` +
    track(it) + nextHtml(it, true) + autoHtml(it) + agentHtml(it) +
    (why ? `<p class="why">${why}</p>` : '') + lo +
    `<details${openAttr('p:' + it.folder, false)}><summary>Terminal command and repos</summary><div class="detail-body">${kitHtml(it)}${reposTable(it)}</div></details>` +
    '</section>';
}

// -------------------------------------------------------------- sidebar
function reposPanel() {
  const repos = (S.D && S.D.repos) || [];
  if (!repos.length) return '';
  const busy = [], clean = [];
  repos.forEach(r => {
    const g = r.git || {};
    const onDefault = !g.branch || g.branch === g.defaultBranch;
    if (g.changed || g.ahead || g.detached || !onDefault) busy.push(r); else clean.push(r);
  });
  busy.sort((a, b) => (b.git.changed || 0) - (a.git.changed || 0));
  const li = busy.map(r => {
    const g = r.git;
    const owner = r.owner ? (r.ownerKnown ? `<a href="#item-${h(r.owner)}" data-jump="item-${h(r.owner)}">#${h(r.owner)}</a>` : `<span title="No .work folder for this id">#${h(r.owner)}?</span>`) : '';
    const flags = repoFlags(g, null).filter(f => f[0] !== 'ok');
    if (!r.owner && g.branch && g.branch !== g.defaultBranch) flags.unshift(['info', 'Not a pipeline branch']);
    const bl = g.links && g.links.branch ? link(g.links.branch, 'Branch') : '';
    return `<li><div class="rn"><span>${h(r.folder)} ${owner}</span>${bl}</div>` +
      `<div class="branch">${h(g.detached ? '(detached)' : g.branch)}</div><div>${flagsHtml(flags)}</div>` +
      (g.lastSha ? `<div class="lc" title="${h(g.lastMsg)}"><span class="mono">${h(g.lastSha)}</span> ${h(g.lastMsg)}</div>` : '') + '</li>';
  }).join('');
  const cleanTxt = clean.length ? `<p class="clean-list">${plural(clean.length, 'repo')} clean on their default branch: ${clean.map(r => h(r.folder)).join(', ')}.</p>` : '';
  return `<section class="panel" aria-labelledby="repos-h"><h3 id="repos-h">Repos with work in progress <span class="n">${busy.length}</span></h3>` +
    (busy.length ? `<ul class="repo-list">${li}</ul>` : '<p class="dim" style="margin:0">Every repo is clean on its default branch.</p>') + cleanTxt + '</section>';
}

// One line per item per day: what moved, not every log entry. null: commands that do not move an item.
const VERB = {
  start: 'Started', spec: 'Wrote the spec', plan: 'Planned', approve: 'Approved', tasks: 'Split into tasks',
  bug: 'Analyzed the bug', review: 'Reviewed', pr: 'Wrote PR text', pause: 'Paused', resume: 'Resumed',
  spike: 'Researched', docs: 'Wrote docs', tsd: 'Drafted the TSD', 'check-docs': 'Fact-checked', publish: 'Published',
  status: null, standup: null, dashboard: null, memory: null, 'onboard-repo': null
};
const ACTIVITY_ROWS = 8;
function activityPanel() {
  const a = (S.D && S.D.activity) || [];
  if (!a.length) return '';
  const groups = [], byKey = {};
  a.forEach(e => { // newest first
    const key = (e.date || '').slice(0, 10) + '|' + e.folder;
    let g = byKey[key];
    if (!g) { g = byKey[key] = { date: e.date, id: e.id, folder: e.folder, title: e.title, entries: [] }; groups.push(g); }
    g.entries.push(e);
  });
  let out = '', lastDay = null;
  groups.slice(0, ACTIVITY_ROWS).forEach(g => {
    const words = []; let tasks = 0, fail = false, pass = false;
    g.entries.slice().reverse().forEach(e => { // oldest first, so the line reads in order
      const c = String(e.command || '').replace(/^\//, '').split(/\s+/)[0].toLowerCase();
      if (/\bFAIL/i.test(e.verify || '')) fail = true; else if (/\bPASS/i.test(e.verify || '')) pass = true;
      if (c === 'do-task') { if (!tasks) words.push('@tasks'); tasks++; return; }
      const w = Object.prototype.hasOwnProperty.call(VERB, c) ? VERB[c] : 'Ran /' + c;
      if (w && words.indexOf(w) < 0) words.push(w);
    });
    let line = words.map((w, i) => {
      if (w === '@tasks') return (i ? 'did ' : 'Did ') + plural(tasks, 'task');
      return i ? w.charAt(0).toLowerCase() + w.slice(1) : w;
    }).join(', ');
    if (!line) line = 'Checked in';
    const d = dayName(g.date);
    if (d !== lastDay) { out += `<li class="day">${h(d)}</li>`; lastDay = d; }
    const cls = fail ? 'fail' : pass ? 'pass' : '';
    const name = `<span class="num">#${h(g.id)}</span>${h(g.title || g.folder)}`;
    const live = itemForFolder(g.folder);
    out += `<li class="ev ${cls}"${fail ? ' title="A verify step failed"' : ''}><span class="pip" aria-hidden="true"></span><div style="min-width:0">` +
      (live ? `<a class="it" href="#item-${h(itemKey(live))}" data-jump="item-${h(itemKey(live))}">${name}</a>` : `<span class="it">${name}</span>`) +
      `<span class="w">${h(line)}</span></div></li>`;
  });
  return `<section class="panel" aria-labelledby="act-h"><h3 id="act-h">Recent activity</h3><ul class="timeline">${out}</ul></section>`;
}

// ---------------------------------------------------------------- header and menus
export const ICON = {
  theme: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="6.5"/><path d="M10 3.5a6.5 6.5 0 0 0 0 13z" fill="currentColor"/></svg>',
  more: '<svg viewBox="0 0 20 20" fill="currentColor"><circle cx="4.5" cy="10" r="1.6"/><circle cx="10" cy="10" r="1.6"/><circle cx="15.5" cy="10" r="1.6"/></svg>',
  x: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/></svg>'
};
function moreMenuHtml() {
  const o = (L() && L().opencode) || {};
  let items = '<button type="button" role="menuitem" data-refresh="1" title="Re-read .work and git now">Refresh now</button>';
  if (S.canNotify) {
    const perm = typeof Notification === 'function' ? Notification.permission : 'denied';
    items += perm === 'granted' ? '<button type="button" role="menuitem" disabled title="You get a notification when an agent waits for you or finishes, while this app is out of sight">Alerts are on</button>'
      : perm === 'denied' ? '<button type="button" role="menuitem" disabled title="Notifications are blocked for this site in your browser settings">Alerts are blocked</button>'
      : '<button type="button" role="menuitem" data-alerts="1" title="Get a notification when an agent waits for you or finishes">Turn on alerts</button>';
  }
  if (L() && L().canOpenTerminal && o.connected) items += '<button type="button" role="menuitem" data-term="">Open the opencode TUI</button>';
  if (o.attach) items += copyBtn(o.attach, 'Copy terminal command');
  items += '<div class="sep"></div><button type="button" role="menuitem" data-cfg-open="1">opencode settings</button>';
  return `<div class="menu" role="menu" style="top:${S.ui.menu.top}px;right:${S.ui.menu.right}px">${items}</div>`;
}
function themeMenuHtml() {
  const T = typeof window !== 'undefined' && window.WorkshopTheme;
  return T ? `<div class="menu" role="menu" style="top:${S.ui.menu.top}px;right:${S.ui.menu.right}px">${T.menuHtml()}</div>` : '';
}
function menuHtml() {
  if (!S.ui.menu) return '';
  return S.ui.menu.kind === 'more' ? moreMenuHtml() : themeMenuHtml();
}
// Inside the shell the shell shows the name and owns the theme. Opened on its own, the page has both.
function brandHtml() {
  if (S.embedded) return '';
  return `<div class="brand"><span class="logo" aria-hidden="true"><i></i></span><h1>Dispatch</h1>${S.version ? `<span class="ver">v${h(S.version)}</span>` : ''}</div>`;
}
export function pill() {
  const o = (L() && L().opencode) || {};
  if (S.conn === 'off') return ['off', 'Workshop not reachable'];
  if (S.conn !== 'on') return ['', 'Connecting'];
  if (!o.connected) return ['off', 'opencode not connected'];
  return ['on', 'Live'];
}
function headerHtml() {
  const o = (L() && L().opencode) || {};
  const st = pill();
  const tip = S.conn === 'on' && S.D ? 'Updated ' + timeOf(S.D.generatedMs) + '. opencode ' + (o.connected ? (o.version || '') + ' at ' + (o.url || '') : 'not connected') : '';
  return `<header class="top">${brandHtml()}<span class="ws">${h(S.D && S.D.workspace)}</span><span class="fresh">` +
    `<span class="pill ${st[0]}" title="${h(tip)}"><span class="led"></span>${h(st[1])}</span>` +
    `<button type="button" class="btn primary" data-start-open="1" title="Run /start for a new work item in opencode">Start a work item</button>` +
    `<button type="button" class="ibtn" data-more-menu="1" aria-label="More" title="More" aria-haspopup="menu">${ICON.more}</button></span></header>`;
}
function bannersHtml() {
  let out = '';
  if (S.conn === 'off') out += '<div class="banner">Workshop stopped or restarted. This page reconnects by itself. If it does not, start Workshop again: <code>node workshop.mjs start</code></div>';
  else if (L() && L().opencode && !L().opencode.connected && L().opencode.error) out += `<div class="banner">${md(L().opencode.error)}</div>`;
  if (S.D && S.D.liveMode && S.D.liveMode.error) out += `<div class="banner">Could not read <code>.work</code>: ${h(S.D.liveMode.error)}</div>`;
  return out;
}

// --------------------------------------------------------- the setup guide
// Browser mode (this page can't reach Workshop on this computer): two steps. 1. Paste one command that
// installs Tandem, Workshop and anything missing, starts Workshop and allows this site (scripts/bootstrap.*,
// served by worker/index.js at /install.ps1 and /install.sh). It checks itself: main.js looks for Workshop
// every few seconds while this step is open. 2. Connect: pair this page. Its state (S.setup) is kept per
// browser by main.js.
export const GUIDE_STEPS = ['install', 'connect'];
const SOURCE = 'https://github.com/adavidson21/workshop/blob/main/scripts';
const CHECK_SVG = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.3l2.3 2.3 4.7-5"/></svg>';
export function guideDefaults() { return { done: {}, open: null, port: 4380, os: 'win', check: null, pair: null }; }
/** The one-line install command for this site. */
export function installCommand(win, origin) {
  return win ? `irm ${origin}/install.ps1 | iex` : `curl -fsSL ${origin}/install.sh | bash`;
}
function cmds(lines) {
  return `<div class="kit gcmd">${lines.map(l => `<div class="kit-line"><code>${h(l)}</code>${copyBtn(l)}</div>`).join('')}</div>`;
}
function gmsg(m) { return m ? `<p class="gmsg${m.ok === true ? ' ok' : m.ok === false ? ' bad' : ''}" role="status">${md(m.text)}</p>` : '<p class="gmsg" role="status"></p>'; }
export function guideHtml() {
  const g = Object.assign(guideDefaults(), S.setup || {});
  const open = GUIDE_STEPS.includes(g.open) || g.open === 'none' ? g.open : GUIDE_STEPS.find(k => !g.done[k]) || 'connect';
  const win = g.os !== 'mac';
  const origin = S.origin || '';
  const osPick = `<div class="gos" role="group" aria-label="Your computer">` +
    `<button type="button" data-gos="win" aria-pressed="${win}"${win ? ' class="on"' : ''}>Windows</button>` +
    `<button type="button" data-gos="mac" aria-pressed="${!win}"${!win ? ' class="on"' : ''}>Mac or Linux</button></div>`;
  const bodies = {
    install: `<p>One command sets up everything Dispatch needs, for your user only, with no admin rights: Tandem, Workshop's small helper that runs only on this computer, and opencode and Node if you don't have them. It starts Workshop now and whenever you log in, and allows this site.</p>` +
      osPick +
      `<p class="gneed">${win ? 'Open <b>PowerShell</b> (Start menu, type PowerShell) and paste this:' : 'Open <b>Terminal</b> and paste this:'}</p>` +
      cmds([installCommand(win, origin)]) +
      `<p class="note">Your work goes in <code>~/work</code>. You can change that later in opencode settings, here in Dispatch. Running the command again updates everything and keeps your settings. <a href="${SOURCE}/bootstrap.${win ? 'ps1' : 'sh'}" target="_blank" rel="noopener">See what it does</a>.</p>` +
      `<div class="gcheck"><button type="button" class="btn primary" data-gcheck>Check for Workshop</button>` +
      `<details class="gport"><summary>Using another port?</summary><label>Port <input type="number" class="mono" data-gport min="1024" max="65535" value="${h(g.port)}"></label></details></div>` +
      gmsg(g.check || { ok: null, text: 'This step ticks itself off when Workshop answers.' }),
    connect: `<p>The installer opened Workshop in your browser once, which signs this browser in. Now click Connect and allow this site in the small Workshop window. Your browser may also ask to let this site reach devices on your network: allow it, that is how it reaches <code>127.0.0.1</code>.</p>` +
      `<div class="gacts"><button type="button" class="btn primary" data-gpair>Connect to Workshop</button></div>` + gmsg(g.pair) +
      `<p class="note">If the window says to open Workshop first, Workshop signed in to a different browser. Run <code>workshop open</code> in a new ${win ? 'PowerShell' : 'Terminal'} window, open the address it prints in this browser, then connect again.</p>`
  };
  const titles = { install: 'Install Tandem and Workshop', connect: 'Connect this page' };
  const doneCount = GUIDE_STEPS.filter(k => g.done[k]).length;
  const steps = GUIDE_STEPS.map((k, i) => {
    const isOpen = k === open, done = !!g.done[k];
    return `<li class="gstep${done ? ' done' : ''}${isOpen ? ' open' : ''}">` +
      `<button type="button" class="ghead" data-gopen="${k}" aria-expanded="${isOpen}"><span class="gnum" aria-hidden="true">${done ? CHECK_SVG : i + 1}</span>` +
      `<span class="gt">${titles[k]}</span>${done ? '<span class="gstate">Done</span>' : ''}</button>` +
      (isOpen ? `<div class="gbody">${bodies[k]}</div>` : '') + '</li>';
  }).join('');
  const lost = S.wasPaired ? '<div class="banner">This page was connected to Workshop before, but Workshop is not answering. Log out and back in, or run the install command below again, which starts it. If that does not help, connect again below.</div>' : '';
  return `<section class="guide">${lost}<p class="eyebrow">Set up, ${doneCount} of ${GUIDE_STEPS.length} done</p>` +
    `<h2>Connect Dispatch to your computer</h2>` +
    `<p class="lede">Dispatch is the front end for Tandem, which runs coding agents in opencode on your computer. Your code and work items stay there: this page talks straight to your computer, never to a server.</p>` +
    `<ol class="gsteps">${steps}</ol></section>`;
}

// --------------------------------------------------------- before the connector is ready
// The connector off, starting or in error: say what is wrong and how to fix it.
export function setupHtml() {
  const c = S.connector;
  let title, body, act = '';
  if (S.mode === 'browser') {
    return guideHtml();
  } else if (!c) {
    title = 'Connecting to Workshop';
    body = '<p>Looking for the opencode connector.</p>';
  } else if (c.state === 'missing') {
    title = 'The opencode connector is not installed';
    body = '<p>This copy of Workshop has no <code>connectors/opencode</code> folder.</p>';
  } else if (c.state === 'disabled') {
    title = 'Turn on the opencode connector';
    body = '<p>Dispatch is the front end for Tandem: your work items and the opencode agents Tandem runs on them. Turn on the opencode connector in Settings and set your workspace folder: the folder that holds <code>.work</code> and your repos.</p>';
    act = 'settings';
  } else if (c.state === 'starting') {
    title = 'Starting the opencode connector';
    body = `<p>${h(c.message || 'Reading .work.')}</p>`;
  } else {
    title = "The opencode connector can't start";
    body = `<p>${md(c.message || 'It stopped.')}</p><p>Check its settings: the workspace folder, PowerShell, and the opencode server.</p>`;
    act = 'settings';
  }
  // Fixing settings happens here (the opencode settings sheet). Only turning the connector on is a Workshop
  // setting, which a hosted page cannot change.
  const here = act && (S.mode === 'local' || c.state !== 'disabled');
  const btn = here ? '<div class="acts"><button type="button" class="btn primary" data-cfg-open="1">Open opencode settings</button></div>'
    : act && S.agentUrl ? `<div class="acts"><a class="btn primary" href="${h(S.agentUrl)}/#/settings" target="_blank" rel="noopener">Open Settings in Workshop</a></div><p class="note">Turning the connector on can only be done in Workshop on this computer.</p>`
    : act ? '<p class="note">Change it in Settings, in Workshop on this computer.</p>' : '';
  return `<div class="setup"><h2>${title}</h2>${body}${btn}</div>`;
}

// ---------------------------------------------------------------- page
export const GROUPS = [
  ['needs', 'Needs you', 'Drafts to review and /approve, review findings, blocked tasks, and agents waiting for an answer.'],
  ['active', 'In progress', ''],
  ['paused', 'Paused', 'Run /resume to pick one up.'],
  ['ship', 'Ready to ship', 'PR text is written. Push, open the PRs, and once they merge, click Remove to clean up the .work folder.'],
  ['notes', 'Spikes, docs, and TSDs', '']
];

// Pick up here: an item whose agent is waiting, else the most recently touched item that is moving,
// else the most recent paused one.
export function pickItem(items, by) {
  const newest = list => list.length ? list.reduce((a, b) => (b.modifiedMs > a.modifiedMs ? b : a)) : null;
  const askingItems = items.filter(it => it.kind === 'item' && asking(it));
  return newest(askingItems) || newest((by.needs || []).concat(by.active || []).filter(it => it.kind === 'item')) || newest(by.paused || []);
}

// --------------------------------------------------------- opencode settings
// The opencode connector's settings, edited here instead of in Workshop. The form is built from the
// connector's configSchema (GET /api/connectors/opencode/config). From a hosted page only fields the
// connector marks x-workshop-hosted can be changed (docs/agent-api.md); the rest show their value and say
// where to change them. S.ui.settings: {view, error, saving, enabled}; typed values live in S.ui.drafts as
// "cfg:<path>".
export const cfgGet = (obj, p) => p.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
export const hostedOnly = () => S.mode !== 'local';
export function cfgEditable(field) { return !hostedOnly() || field['x-workshop-hosted'] === true; }
/** The value shown for a field: what the user typed, else the saved value. */
export function cfgValue(p, field) {
  const d = S.ui.drafts['cfg:' + p];
  if (d !== undefined) return d;
  const v = cfgGet(S.ui.settings && S.ui.settings.view && S.ui.settings.view.config, p);
  return v === undefined ? (field.type === 'boolean' ? false : '') : v;
}
function cfgFields(schema, prefix, env) {
  let out = '';
  for (const [k, f] of Object.entries(schema.properties || {})) {
    const p = prefix ? prefix + '.' + k : k;
    if (f.type === 'object') { out += `<fieldset class="cfg-group"><legend>${h(f.title || k)}</legend>${cfgFields(f, p, env)}</fieldset>`; continue; }
    const v = cfgValue(p, f);
    const off = cfgEditable(f) ? '' : ' disabled';
    const desc = f.description ? `<span class="cfg-d">${md(f.description)}</span>` : '';
    let envNote = '';
    if (f['x-workshop-env'] && typeof v === 'string' && v && env && env[v]) envNote = `<span class="cfg-env ${env[v].set ? 'ok' : 'bad'}">${env[v].set ? 'Set on this computer' : 'Not set on this computer'}</span>`;
    if (f.type === 'boolean') {
      out += `<label class="cfg-row cfg-check"><input type="checkbox" data-cfg="${h(p)}"${v === true ? ' checked' : ''}${off}><span><span class="cfg-t">${h(f.title || k)}</span>${desc}</span></label>`;
    } else {
      const num = f.type === 'integer' || f.type === 'number';
      const attrs = num ? ` type="number" inputmode="numeric"${f.minimum != null ? ` min="${f.minimum}"` : ''}${f.maximum != null ? ` max="${f.maximum}"` : ''}` : ' type="text" spellcheck="false" autocomplete="off"';
      const ph = f.default != null && !num ? ` placeholder="${h(f.default)}"` : '';
      out += `<label class="cfg-row"><span class="cfg-t">${h(f.title || k)}</span>${desc}` +
        `<input${attrs} class="mono" data-cfg="${h(p)}" data-draft="cfg:${h(p)}" value="${h(v)}"${ph}${off}>${envNote}</label>`;
    }
  }
  return out;
}
function settingsSheetHtml() {
  const st = S.ui.settings;
  const head = `<div class="sheet-head"><h3 id="cfg-h">opencode settings</h3><button type="button" class="ibtn" data-close-sheet="1" aria-label="Close">${ICON.x}</button></div>`;
  let body;
  if (st.error && !st.view) body = `<p class="gmsg bad">${md(st.error)}</p>`;
  else if (!st.view) body = '<p>Loading the settings from Workshop on your computer.</p>';
  else {
    const locked = hostedOnly() && Object.keys(st.view.schema.properties || {}).length > 0;
    const toggle = S.mode === 'local'
      ? `<label class="cfg-row cfg-check cfg-on"><input type="checkbox" data-cfg-enabled="1"${st.enabled ? ' checked' : ''}><span><span class="cfg-t">Turn on the opencode connector</span><span class="cfg-d">Dispatch needs it on to show your work.</span></span></label>`
      : '';
    body = `<p>How Dispatch finds your work and talks to opencode on this computer. Saving restarts the connector.</p>` +
      `<form class="cfg" data-cfg-form="1" novalidate>${toggle}${cfgFields(st.view.schema, '', st.view.env)}</form>` +
      (locked ? `<p class="note">Greyed out settings run commands or read secrets on your computer, so they can only be changed in Workshop there${S.agentUrl ? `: <a href="${h(S.agentUrl)}/#/settings" target="_blank" rel="noopener">open Workshop settings</a>` : ''}.</p>` : '') +
      (st.error ? `<p class="gmsg bad" role="status">${md(st.error)}</p>` : '');
  }
  const foot = '<span class="grow"></span><button type="button" class="btn" data-close-sheet="1">Cancel</button>' +
    (st.view ? `<button type="button" class="btn primary" data-cfg-save="1"${st.saving ? ' disabled' : ''}>${st.saving ? 'Saving' : 'Save'}</button>` : '');
  return `<div class="modal" data-sheet="1"><div class="backdrop" data-close-sheet="1"></div><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="cfg-h">${head}${body}<footer>${foot}</footer></div></div>`;
}
/**
 * The config to save: the saved config with what the user typed on top. Empty optional text fields are
 * left out (the connector's default applies); numbers are parsed. Returns {config} or {error}.
 */
export function cfgBuild() {
  const st = S.ui.settings;
  const config = structuredClone(st.view.config || {});
  const walk = (schema, prefix, target) => {
    for (const [k, f] of Object.entries(schema.properties || {})) {
      const p = prefix ? prefix + '.' + k : k;
      if (f.type === 'object') { target[k] = target[k] && typeof target[k] === 'object' ? target[k] : {}; const e = walk(f, p, target[k]); if (e) return e; if (!Object.keys(target[k]).length) delete target[k]; continue; }
      const d = S.ui.drafts['cfg:' + p];
      if (d === undefined) continue;
      if (f.type === 'boolean') { target[k] = d === true; continue; }
      const text = String(d).trim();
      const required = (schema.required || []).includes(k);
      if (!text) { if (required) return `${f.title || k} is needed.`; delete target[k]; continue; }
      if (f.type === 'integer' || f.type === 'number') {
        const n = Number(text);
        if (!Number.isFinite(n) || (f.type === 'integer' && !Number.isInteger(n))) return `${f.title || k} must be a number.`;
        if ((f.minimum != null && n < f.minimum) || (f.maximum != null && n > f.maximum)) return `${f.title || k} must be from ${f.minimum} to ${f.maximum}.`;
        target[k] = n;
      } else target[k] = text;
    }
    return null;
  };
  const error = walk(st.view.schema, '', config);
  return error ? { error } : { config };
}

// --------------------------------------------------------- start a work item
// Runs /start <id> <lane> in opencode (the connector's `start` action), like Docket's Start buttons.
// S.ui.start: {lane, busy, error}; the id the user types lives in S.ui.drafts['start:id'].
export function startCheck(raw, lane) {
  const id = String(raw || '').trim().replace(/^#/, '');
  if (!/^[0-9]{1,10}$/.test(id)) return { error: 'Type the work item number, like 12345.' };
  if (lane !== 'feature' && lane !== 'bug') return { error: 'Pick Feature or Bug.' };
  if ((S.D && S.D.items || []).some(it => String(it.id) === id)) return { error: `#${id} is already started. It is in the list.` };
  return { id, lane };
}
function startSheetHtml() {
  const st = S.ui.start;
  const o = (L() && L().opencode) || {};
  const lane = st.lane;
  const pick = (k, label, d) => `<button type="button" data-start-lane="${k}" aria-pressed="${lane === k}"${lane === k ? ' class="on"' : ''}>${label}<span>${d}</span></button>`;
  const head = `<div class="sheet-head"><h3 id="start-h">Start a work item</h3><button type="button" class="ibtn" data-close-sheet="1" aria-label="Close">${ICON.x}</button></div>`;
  const body = `<p>Tandem reads the work item, sets up its folder in <code>.work</code> and your branch, then waits for you. It runs <code>/start</code> in opencode.</p>` +
    `<form class="cfg" data-start-form="1" novalidate>` +
    `<label class="cfg-row"><span class="cfg-t">Work item number</span><input type="text" inputmode="numeric" class="mono start-id" data-draft="start:id" value="${h(S.ui.drafts['start:id'] || '')}" placeholder="12345" autocomplete="off"></label>` +
    `<div class="cfg-row"><span class="cfg-t">Kind of work</span><div class="lanes" role="group" aria-label="Kind of work">${pick('feature', 'Feature', 'Spec, plan, tasks, build, review, PR')}${pick('bug', 'Bug', 'Reproduce, fix, review, PR')}</div></div></form>` +
    (o.connected ? '' : '<p class="gmsg bad">opencode is not connected to Workshop, so nothing can start yet.</p>') +
    (st.error ? `<p class="gmsg bad" role="status">${md(st.error)}</p>` : '');
  const foot = '<span class="grow"></span><button type="button" class="btn" data-close-sheet="1">Cancel</button>' +
    `<button type="button" class="btn primary" data-start-go="1"${st.busy || !o.connected ? ' disabled' : ''}>${st.busy ? 'Starting' : 'Start'}</button>`;
  return `<div class="modal" data-sheet="1"><div class="backdrop" data-close-sheet="1"></div><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="start-h">${head}${body}<footer>${foot}</footer></div></div>`;
}

function overlaysHtml() {
  return menuHtml() + (S.ui.start ? startSheetHtml() : S.ui.settings ? settingsSheetHtml() : S.ui.remove ? removeSheetHtml() : S.ui.file ? fileSheetHtml() : '');
}

/** The whole page. Resets the copy list, so call it once per paint. */
export function render() {
  S.copyStore = [];
  if (!S.connector || S.connector.state !== 'ready' || !S.D) return setupHtml() + overlaysHtml();
  const items = S.D.items || [];
  const by = {};
  items.forEach(it => { const b = bucketOf(it); (by[b] = by[b] || []).push(it); });
  let html = headerHtml() + bannersHtml();
  if (!items.length) {
    html += waitingHtml();
    html += '<div class="empty"><h2>No work in .work yet</h2><p>Start a work item and it shows up here.</p><div class="do"><button type="button" class="btn primary" data-start-open="1">Start a work item</button></div>' +
      '<p class="hint">Or type <span class="cmd">/start &lt;id&gt; feature</span> in opencode.</p></div>';
    html += `<div style="margin-top:28px">${reposPanel()}</div>`;
    return html + overlaysHtml();
  }
  const pick = pickItem(items, by);
  html += '<div class="grid"><main>' + waitingHtml();
  if (pick) html += pickupHtml(pick);
  if (items.length > 8) {
    html += '<ul class="counts" aria-label="Jump to a group">' + GROUPS.map(g => {
      const n = (by[g[0]] || []).length;
      return `<li><a href="#g-${g[0]}" data-jump="g-${g[0]}" data-b="${g[0]}" class="${n ? '' : 'zero'}">${h(g[1])} <b>${n}</b></a></li>`;
    }).join('') + '</ul>';
  }
  GROUPS.forEach(g => {
    const list = by[g[0]];
    if (!list || !list.length) return;
    html += `<section class="group" id="g-${g[0]}" aria-labelledby="gh-${g[0]}"><h3 id="gh-${g[0]}">${h(g[1])} <span class="n">${list.length}</span></h3>` +
      (g[2] ? `<p class="hint">${md(g[2])}</p>` : '') +
      `<div class="items">${list.map(it => (it === pick ? pickedRow(it) : itemCard(it, false))).join('')}</div></section>`;
  });
  if (!S.D.gitAvailable) html += '<p class="note">git was not found on PATH, so repo state is missing.</p>';
  html += `</main><aside>${reposPanel()}${activityPanel()}</aside></div>`;
  return html + overlaysHtml();
}

/** Open prompts and questions, for the rail badge and alerts. */
export function prompts() {
  if (!L()) return [];
  return L().permissions.map(p => ({ id: p.id, sid: p.sessionID, folder: p.folder, text: 'Allow ' + p.permission + (p.title ? ': ' + p.title : '') }))
    .concat(L().questions.map(q => ({ id: q.id, sid: q.sessionID, folder: q.folder, text: ((q.questions || [])[0] || {}).question || 'The agent has a question' })));
}
