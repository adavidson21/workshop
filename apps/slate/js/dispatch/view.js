/* Agents: the page, as HTML strings, from the state in state.js. No DOM, no connection: main.js paints
   what render() returns and handles the clicks. Ported from eng-agents' dashboard.template.html
   (Dashboard 1.6.1, live mode). What changed from the template:
   - Live mode only. The static page stays in eng-agents (/dashboard static).
   - Data comes from the opencode connector's `state` action; buttons call its actions (main.js).
   - .work files open in a sheet here (the `file.read` action) instead of a /files/ link.
   - The shell owns the theme and the name: no theme menu and no brand when embedded.
   - No update checks (the connector makes none). */
import { docHtml, lockReason } from './doc.js';
import { S } from './state.js';
import { SITE } from '../../../../shared/site.js';
import { projectChip, projectList, projectsOn, projectName, projectSheetHtml, projectsSheetHtml, moveSheetHtml, INBOX } from './projects.js';
import { pageHtml, tabsHtml } from './pages.js';
import { BOARD_TABS } from '../loom.js';
import { PICKER, flowById, stepsOf, shownSteps, flowCardHtml } from './flows.js';
/** The flows Other flows offers (Loom 6.0.0); the drop box starts the rest. */
export const OTHER_FLOWS = ['request', 'epic', 'docs'];

// ---------------------------------------------------------------- helpers
export function h(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Inline `code` and **bold** only, plus "- " list lines as bullets. Everything else stays plain text.
export function md(s) {
  return h(s).replace(/^\s*[-*]\s+/gm, '• ').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
// Only http(s) links leave the app, in a new tab.
export function safeUrl(u) { return /^https?:\/\//i.test(String(u || '')) ? String(u) : null; }
export function link(href, text, cls) {
  const u = safeUrl(href);
  if (!u) return cls ? `<span class="${cls}">${h(text)}</span>` : h(text);
  return `<a href="${h(u)}" target="_blank" rel="noopener"${cls ? ` class="${cls}"` : ''}>${h(text)}</a>`;
}
export function fileBtn(folder, name, cls, label) {
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
export function dayName(s) {
  const k = (s || '').slice(0, 10);
  if (k === S.today) return 'Today';
  if (k === S.yest) return 'Yesterday';
  const p = k.split('-');
  if (p.length !== 3) return s;
  return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
export function timeOf(ms) { return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }); }
/** A date and time for a tooltip, on a 12-hour clock. */
export function stamp(ms) { const d = new Date(ms); return isNaN(d) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', hour12: true }); }

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
export function noteCommand(it) {
  const m = /`(\/[a-z][a-z0-9-]*[^`]*)`/i.exec(it.nextText || '');
  return m ? m[1].trim() : null;
}
export function openAttr(key, dflt) {
  const v = Object.prototype.hasOwnProperty.call(S.ui.open, key) ? S.ui.open[key] : dflt;
  return ` data-key="${h(key)}"` + (v ? ' open' : '');
}
/** A .work file read through file.read (main.js loadFiles): {text, error, at, loading}, or null before it is asked for. */
export function fileOf(folder, name) { return (S.files && S.files[folder + '/' + name]) || null; }
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
  feature: [['start', 'Start'], ['spec', 'Spec and plan'], ['build', 'Build'], ['review', 'Review'], ['pr', 'PR']],
  bug: [['start', 'Start'], ['bug', 'Bug'], ['build', 'Build'], ['review', 'Review'], ['pr', 'PR']],
  quick: [['start', 'Start'], ['quick', 'Quick plan'], ['build', 'Build'], ['review', 'Review'], ['pr', 'PR']]
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
  const g = { spec: 'plan', plan: 'plan', bug: 'bug', quick: 'quick', review: 'review' }[key];
  const v = g && it.gates ? it.gates[g] : null;
  if (v === 'APPROVED') return key === 'spec' ? 'spec.md and plan.md approved' : key + '.md approved';
  if (v === 'READY') return 'Review: READY';
  if (key === 'build' && it.tasks && it.tasks.total) return plural(it.tasks.total, 'task') + ' done';
  return 'Done';
}
export function track(it) {
  const stops = STOPS[it.lane] || STOPS.feature;
  let idx = -1;
  // One feature gate (eng-agents Core 4.0.0): the plan and tasks stages sit inside "Spec and plan".
  const stage = it.lane === 'feature' && (it.stage === 'plan' || it.stage === 'tasks') ? 'spec' : it.stage;
  for (let i = 0; i < stops.length; i++) if (stops[i][0] === stage) idx = i;
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
export function runBtn(it, cmd, label, quiet) {
  if (!cmd) return '';
  const r = runState(it, cmd);
  return `<button type="button" class="btn${quiet ? '' : ' primary'}" data-run="${h(it.folder)}" data-cmd="${h(cmd)}" title="${h(r.tip)}"${r.blocked ? ' disabled' : ''}>${h(label || 'Run')}</button>`;
}
/** Why a command cannot run now ('' when it can), and its tooltip. */
export function runState(it, cmd) {
  const s = itemSession(it);
  const fresh = /^\/(do-task|check-docs)\b/.test(cmd);
  const blocked = !ocReady() ? 'opencode is not connected' : (autoIs(it, 'running') ? 'Autopilot is running this item' : (isBusy(s) && !fresh ? "This item's session is still working" : (S.ui.busy[it.folder] ? 'Starting' : '')));
  return { blocked, tip: blocked || ('Runs ' + cmd + ' in opencode' + (fresh ? ' in a new session' : (s ? " in this item's session" : ' in a new session for this item'))) };
}
/** A path card (flows.js forkHtml) that runs a command, like runBtn. */
export function runFork(it, cmd, label, desc, primary) {
  const r = runState(it, cmd);
  return { label, desc, primary, title: r.tip, disabled: !!r.blocked, attrs: `data-run="${h(it.folder)}" data-cmd="${h(cmd)}"` };
}
// The file to read before approving, for "Review spec.md" style steps.
function gateFileLink(it) {
  if (it.paused || !it.next || !it.next.needsYou) return '';
  const f = { spec: 'spec.md', plan: 'plan.md', bug: 'bug.md', quick: 'quick.md', review: 'review.md' }[it.next.stage];
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
/** The step's buttons: Build with autopilot when it fits, then the step itself. primaryOnly: just the first one. */
export function nextBtns(it, primaryOnly) {
  const n = it.next || {};
  const cmd = it.paused ? '/resume ' + it.id : n.command;
  const running = autoIs(it, 'running') || autoIs(it, 'queued');
  const kind = running || autoIs(it, 'waiting') ? null : autoStartKind(it);
  const name = cmd ? cmd.split(/\s+/)[0] : '';
  if (running) return '';
  // The software factory (Loom 6.2.0): approving the plan is the first of your two gates; the build starts on its own.
  const auto = kind ? autoBtn(it, kind, kind === 'approve-start' ? 'Approve' : 'Build with autopilot', 'primary', autoTip(it, kind), '') : '';
  const step = cmd ? runBtn(it, cmd, name === '/approve' ? (kind ? 'Approve, do not build yet' : 'Approve') : name === '/resume' ? 'Resume' : kind ? 'Run next step only' : 'Run', !!kind || autoIs(it, 'waiting')) : '';
  return primaryOnly ? (auto || step) : auto + step;
}
/** The step in plain words: the action text, else the command's words. */
export function nextText(it) {
  const n = it.next || {};
  const cmd = it.paused ? '/resume ' + it.id : n.command;
  const act = it.paused ? null : n.action;
  return act ? md(act) : cmd ? h(cmdWords(it, cmd)) : '';
}
export function nextHtml(it, big) {
  const n = it.next || {};
  const text = nextText(it);
  const btns = nextBtns(it, false);
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

export function leftOffHtml(it) {
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
export function permHtml(p, showWho) {
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
export function questionHtml(q, showWho) {
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
  // Hands-off Quick change (review by exception, connector 1.20.0): autopilot writes the quick plan and approves it
  // itself when it is clean, so Build with autopilot shows before the plan exists and on a draft plan.
  if (handsOff(it) && n.stage === 'quick') return 'start';
  if (n.command && /^\/approve\b/.test(n.command) && (n.stage === 'plan' || n.stage === 'bug' || n.stage === 'quick')) return 'approve-start';
  const gate = it.lane === 'bug' ? (it.gates || {}).bug : it.lane === 'quick' ? (it.gates || {}).quick : (it.gates || {}).plan;
  return gate === 'APPROVED' && n.stage !== 'ship' ? 'start' : null;
}
function autoBtn(it, act, label, cls, tip, off) {
  const dis = off || (!ocReady() && act !== 'stop' && act !== 'dismiss' ? 'opencode is not connected' : (S.ui.busy['a:' + it.folder] ? 'Working' : ''));
  return `<button type="button" class="btn${cls ? ' ' + cls : ''}" data-auto="${h(it.folder)}" data-act="${act}" title="${h(dis || tip)}"${dis ? ' disabled' : ''}>${h(label)}</button>`;
}
const handsOff = it => it.lane === 'quick' && !!(S.D && S.D.autopilotOptions && S.D.autopilotOptions.quickHandsOff);
function autoTip(it, kind) {
  if (kind === 'start' && handsOff(it) && (it.next || {}).stage === 'quick') {
    return 'Writes the quick plan and approves it on its own when it is clean (no open questions, at most 3 assumptions, at most 3 tasks), then builds, reviews, checks the UI and writes the PR text. A plan that is not clean stops for you. You publish it.';
  }
  return (kind === 'approve-start' ? 'Approves ' + (it.lane === 'bug' ? 'bug.md' : it.lane === 'quick' ? 'quick.md' : 'plan.md') + ', then runs' : 'Runs') +
    ' the rest on its own: tasks, review with fix rounds, UI checks, and PR text. Stops only when it truly needs you. You publish it.';
}
// Only while autopilot runs or needs you. Starting it is the main button on the Next line.
export function autoHtml(it) {
  if (!L() || it.kind !== 'item') return '';
  const a = itemAuto(it);
  if (!a || !['running', 'waiting', 'queued'].includes(a.status)) return '';
  const log = a.log && a.log.length ? `<details${openAttr('a:' + it.folder, false)}><summary>Autopilot log</summary>` +
    '<ul class="hist">' + a.log.slice().reverse().map(x => `<li>${h(timeOf(Date.parse(x.at)))} ${h(x.text)}</li>`).join('') + '</ul></details>' : '';
  const rounds = a.fixRounds ? `<span class="then">fix round ${a.fixRounds} of ${a.maxFixRounds}</span>` : '';
  if (a.status === 'queued') {
    return '<div class="auto run"><div class="auto-head"><span class="state">Autopilot queued</span>' +
      `<span class="row">${autoBtn(it, 'stop', 'Cancel', '', 'Take it out of the queue')}</span></div><p class="msg">${md(a.message || '')}</p>${log}</div>`;
  }
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
  let out = sessionBox(s, perms, qs, `Reply to the agent, or type a command (for example /status ${it.id || it.folder}). Ctrl+Enter sends.`, true);
  if (links && links.sessions.length > 1) {
    const older = links.sessions.slice(0, -1).reverse();
    out = out.slice(0, -'</div>'.length) + `<details${openAttr('h:' + it.folder, false)}><summary>Earlier sessions for this item (${older.length})</summary>` +
      '<ul class="hist" style="margin-top:6px">' + older.map(x =>
        `<li><span class="ht" title="${h(x.id)}">${h(x.title || x.command || x.id)}</span>` +
        (L().canOpenTerminal ? `<button type="button" class="btn" data-term="${h(x.id)}">Open</button>` : '') + '</li>').join('') + '</ul></details></div>';
  }
  return out;
}
/** One opencode session as a box: state, Stop, its prompts and questions, what it said, and a reply field. */
export function sessionBox(s, perms, qs, hint) {
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
    if (s.error) out += `<p class="err">${h(s.error)}${aiState() === 'off' ? ' <b>No AI model is connected:</b> see Getting set up.' : ''}</p>`;
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
    out += `<div class="reply"><textarea data-draft="${h(dk)}" data-sid="${h(s.id)}" placeholder="${h(hint)}" aria-label="Reply to the agent">` +
      h(S.ui.drafts[dk] || '') + `</textarea><button type="button" class="btn" data-reply="${h(s.id)}">Send</button></div>`;
  }
  return out + '</div>';
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

export function reposTable(it) {
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

export function tasksHtml(it) {
  const t = it.tasks;
  if (!t || !t.total) return '';
  let firstOpen = null;
  t.list.forEach(x => { if (!x.done && (firstOpen === null || x.n < firstOpen)) firstOpen = x.n; });
  const li = t.list.map(x => `<li class="${x.done ? 'done' : ''}${x.n === firstOpen ? ' first' : ''}"><span class="box" aria-hidden="true"></span><span class="tt">` +
    h(x.n + '. ' + x.title) + (x.repo ? ` <span class="rp">${h(x.repo)}</span>` : '') + '</span></li>').join('');
  return `<div><p class="sub-h">Tasks <span class="bar" aria-hidden="true"><i style="width:${Math.round(100 * t.done / t.total)}%"></i></span> ${t.done} of ${t.total} done</p><ul class="tasks">${li}</ul></div>`;
}

// The page runs commands itself. Offer the TUI on this item's session (or the server) for the terminal.
export function kitHtml(it) {
  const s = it ? itemSession(it) : null;
  const cmd = s ? s.attach : (L() && L().opencode ? L().opencode.attach : null);
  if (!cmd) return '';
  return `<div class="kit"><div class="kit-head"><span>Work in the terminal (opencode TUI on ${s ? "this item's session" : 'this server'})</span></div>` +
    `<div class="kit-line"><code>${h(cmd)}</code>${copyBtn(cmd)}</div></div>`;
}
export function filesHtml(it) {
  if (!it.files || !it.files.length) return '';
  return `<div><p class="sub-h">Files</p><div class="files">${it.files.map(f => fileBtn(it.folder, f)).join('')}</div></div>`;
}

// ------------------------------------------------------------- PR text (ready to ship)
// The code review for one repo of an item: where it stands and a link to review.html (state.reviews,
// from the opencode connector).
export function reviewHref(it, repo) {
  return `review.html?id=${encodeURIComponent(it.id || it.folder)}&repo=${encodeURIComponent(repo)}`;
}
export function prHtml(it) {
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
    // Connected, Publish (or Approve and publish in the code review) pushes every branch (connector 1.27.0). Without a
    // connection, the command can still be copied and run by hand.
    const push = !pushed && p.pushCmd && ps && ps.local && S.conn !== 'on'
      ? `<div class="pr-push"><span class="dim">Push first:</span><code>${h(p.pushCmd)}</code>${copyBtn(p.pushCmd)}</div>`
      : '';
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
export function removeBtn(it) {
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

// ------------------------------------------------------------- a .work file: read, preview and edit (doc.js)
// Read through file.read, saved through file.write with the text it was read at, so nothing Tandem wrote since is
// overwritten. Read-only while Tandem or autopilot works on the item. Open in Folio shows it in Folio (app id notes).
export function fileDraftKey(f) { return 'file:' + f.folder + '/' + f.name; }
export function fileDraft(f) { const d = S.ui.drafts[fileDraftKey(f)]; return d == null ? f.text : d; }
export function fileDirty(f) { return !!f && f.text != null && fileDraft(f) !== f.text; }
export function fileLock(f) {
  const it = (S.D && S.D.items || []).find(x => x.folder === f.folder);
  return it ? lockReason({ busy: isBusy(itemSession(it)), auto: autoIs(it, 'running') }) : '';
}
function fileSheetHtml() {
  const f = S.ui.file;
  const lock = f.text == null ? '' : fileLock(f);
  const mode = lock ? 'preview' : (f.mode || 'preview');
  const cur = fileDraft(f);
  const dirty = fileDirty(f);
  const key = fileDraftKey(f);
  let body;
  if (f.error && f.text == null) body = `<p class="err">${h(f.error)}</p>`;
  else if (f.text == null) body = '<p>Loading.</p>';
  else if (mode === 'edit') body = `<textarea class="doc-edit" data-draft="${h(key)}" spellcheck="true" aria-label="Edit ${h(f.name)}">${h(cur)}</textarea>`;
  else body = cur.trim() ? `<div class="doc">${docHtml(cur)}</div>` : '<p class="dim">This file is empty.</p>';
  const tabs = f.text == null ? '' :
    `<div class="doc-tabs" role="tablist" aria-label="View">` +
    `<button type="button" role="tab" class="doc-tab${mode === 'preview' ? ' on' : ''}" aria-selected="${mode === 'preview'}" data-file-mode="preview">Preview</button>` +
    `<button type="button" role="tab" class="doc-tab${mode === 'edit' ? ' on' : ''}" aria-selected="${mode === 'edit'}" data-file-mode="edit"${lock ? ` disabled title="${h(lock)}"` : ''}>Edit</button></div>`;
  let notes = '';
  if (lock) notes += `<p class="doc-note">${h(lock)}${dirty ? ' Your edits are kept here.' : ''}</p>`;
  if (f.conflict) notes += `<div class="ovr"><p>${h(f.name)} changed since you opened it, so nothing was saved.</p>` +
    `<button type="button" class="btn" data-file-reload="1">Load the new version</button> ${copyBtn(cur, 'Copy my text')}</div>`;
  else if (f.error) notes += `<p class="err">${h(f.error)}</p>`;
  const foot = f.confirmClose
    ? `<span class="grow dim">Discard your changes to ${h(f.name)}?</span><button type="button" class="btn" data-file-keep="1">Keep editing</button><button type="button" class="btn danger" data-file-discard="1">Discard</button>`
    : `<span class="grow dim" data-file-state="1">${f.saving ? 'Saving.' : dirty ? 'Unsaved changes' : f.saved ? 'Saved' : ''}</span>` +
      (S.hasNotes && f.text != null ? `<button type="button" class="btn" data-open-notebook="1" title="Open in Folio">Open in Folio</button>` : '') +
      (f.text ? copyBtn(cur, 'Copy') : '') +
      (f.text != null ? `<button type="button" class="btn" data-file-revert="1"${dirty ? '' : ' hidden'}>Revert</button>` +
        `<button type="button" class="btn primary" data-file-save="1"${!dirty || lock || f.saving ? ' disabled' : ''}>Save</button>` : '') +
      '<button type="button" class="btn" data-close-sheet="1">Close</button>';
  return `<div class="modal" data-sheet="1"><div class="backdrop" data-close-sheet="1"></div><div class="sheet wide doc-sheet" role="dialog" aria-modal="true" aria-labelledby="file-h">` +
    `<div class="sheet-head"><h3 id="file-h"><code>.work/${h(f.folder)}/${h(f.name)}</code></h3>${tabs}<button type="button" class="ibtn" data-close-sheet="1" aria-label="Close">${ICON.x}</button></div>` +
    `${notes}${body}<footer>${foot}</footer></div></div>`;
}

// ------------------------------------------------------------- the brief (brief.md, from /start)
// Open by default until the spec or bug analysis is written; after that it is reference, so it starts
// closed. Opening or closing it by hand is remembered (S.ui.open). Every line is escaped: headings
// become labels, the rest goes through md() (code, bold, bullets) as plain text.
export function briefOpen(it) {
  const g = it.gates || {};
  return !g.spec && !g.bug && !g.plan && !(it.tasks && it.tasks.total);
}
export function briefText(text) {
  const lines = String(text || '').replace(/<!--[\s\S]*?-->/g, '').replace(/\r/g, '').split('\n');
  const out = [];
  let para = [];
  const flush = () => { const t = para.join('\n').trim(); if (t) out.push(`<div class="pre">${md(t)}</div>`); para = []; };
  for (const ln of lines) {
    if (/^#\s/.test(ln)) continue; // the "# Brief: <id> <title>" line repeats the card's title
    const hd = /^##+\s+(.+?)\s*$/.exec(ln);
    if (hd) { flush(); out.push(`<p class="sub-h">${h(hd[1])}</p>`); continue; }
    para.push(ln);
  }
  flush();
  return out.join('');
}
export function briefHtml(it) {
  if (!it.files || it.files.indexOf('brief.md') < 0) return '';
  const b = fileOf(it.folder, 'brief.md');
  const body = !b || (b.text == null && !b.error) ? '<p class="dim">Loading the brief.</p>'
    : b.text == null ? `<p class="err">${h(b.error)}</p>` : briefText(b.text);
  return `<details class="brief"${openAttr('b:' + it.folder, briefOpen(it))}><summary>Brief</summary>` +
    `<div class="brief-body">${body}<p class="brief-foot">${fileBtn(it.folder, 'brief.md', 'plain', 'Open brief.md')}</p></div></details>`;
}

/** "From Slate": the request this run came from, when Slate knows the ADO item (Slate's summary, `ado` card). */
/** What Slate says about a run (its summary): found by run folder, else by ADO id. */
export function slateOf(it) {
  if (!it || !S.slate) return null;
  return (it.folder && S.slate.get(it.folder)) || (it.id && S.slate.get(String(it.id))) || null;
}
export function slateChip(it) {
  const s = slateOf(it);
  return s ? `<button type="button" class="tag slate" data-open-slate="${h(s.route)}" title="${h(s.note || 'Open the request in Slate')}">From Slate</button>` : '';
}
export function idLink(it) { return safeUrl(it.url) ? link(it.url, '#' + it.id, 'num') : `<span class="num">#${h(it.id)}</span>`; }

// ------------------------------------------------------------- item card
// The whole run as one card, for places that show a run in full without its own page (tests).
export function itemCard(it) {
  if (it.kind !== 'item') return noteCard(it);
  const meta = [];
  meta.push(`<span class="tag ${h(it.lane)}">${h(it.lane)}${it.laneGuessed ? '?' : ''}</span>`);
  if (it.adoState) meta.push(`<span title="ADO state when the item was fetched">ADO: ${h(it.adoState)}</span>`);
  meta.push(`<span title="${h(stamp(it.modifiedMs))}">Touched ${ago(it.modifiedMs)}</span>`);
  meta.push(projectChip(it));
  meta.push(slateChip(it));
  meta.push(removeBtn(it));
  const title = safeUrl(it.url) ? link(it.url, it.title) : h(it.title);
  return `<article class="item" id="item-${h(itemKey(it))}" style="--state:${stateVar(it)}">` +
    `<div class="item-head"><h4 class="t">${idLink(it)}${title}</h4><div class="meta">${meta.join('')}</div></div>` +
    briefHtml(it) + track(it) + nextHtml(it, false) + (it.stage === 'ship' ? prHtml(it) : '') + autoHtml(it) + agentHtml(it) + leftOffHtml(it) +
    `<details${openAttr('d:' + it.folder, false)}><summary>Repos, tasks, files</summary><div class="detail-body">` +
    reposTable(it) + tasksHtml(it) + kitHtml(it) + filesHtml(it) + '</div></details></article>';
}
export function noteCard(it) {
  const label = { spike: 'Spike', docs: 'Docs', tsd: 'TSD' }[it.kind] || 'Folder';
  let body = '';
  if (it.state) body += `<p style="margin:6px 0 0"><strong>${h(it.state)}</strong></p>`;
  if (it.summary) body += `<p class="pre" style="margin:6px 0 0">${md(it.summary)}</p>`;
  if (it.nextText) body += `<div class="next-line"><span class="lbl">Next</span><span>${md(liveNote(it.nextText))}</span>${runBtn(it, noteCommand(it))}</div>`;
  return `<article class="item" id="item-${h(it.folder)}" style="--state:${asking(it) ? 'var(--gate)' : 'var(--line)'}"><div class="item-head"><h4 class="t">${h(it.title)}</h4><div class="meta"><span class="tag">${label}` +
    `</span><span>Touched ${ago(it.modifiedMs)}</span>${projectChip(it)}${removeBtn(it)}</div></div>${body}${agentHtml(it)}` +
    (it.files && it.files.length ? `<details${openAttr('d:' + it.folder, false)}><summary>Files</summary><div class="detail-body">${filesHtml(it)}</div></details>` : '') + '</article>';
}

// --------------------------------------------------------- pick up here
export function pickupHtml(it) {
  let why;
  if (asking(it)) why = '<strong>The agent is waiting for you.</strong>';
  else if (it.bucket === 'paused') why = 'Nothing is moving. This is the latest paused item.';
  else if (it.blocked) why = '<strong>Blocked.</strong> ' + md(it.blocked);
  else if (it.next && it.next.note) why = md(liveNote(it.next.note));
  else why = '';
  let lo = '';
  if (it.paused) lo = leftOffHtml(it);
  else if (it.last) lo = `<p class="why"><strong>Last:</strong> ${h(dayName(it.last.date))}, <code>${h(it.last.command)}</code>: ${md(it.last.did || '')}</p>`;
  const title = safeUrl(it.url) ? link(it.url, it.title) : h(it.title);
  return `<section class="pickup" id="item-${h(itemKey(it))}" style="--state:${stateVar(it)}" aria-labelledby="pickup-h">` +
    `<div class="pick-top"><p class="eyebrow">Pick up here, touched ${ago(it.modifiedMs)}</p>${projectChip(it)}${removeBtn(it)}</div>` +
    `<h2 id="pickup-h">${idLink(it)}${title}</h2>` +
    track(it) + nextHtml(it, true) + autoHtml(it) + agentHtml(it) +
    (why ? `<p class="why">${why}</p>` : '') + lo +
    `<details${openAttr('p:' + it.folder, false)}><summary>Terminal command and repos</summary><div class="detail-body">${kitHtml(it)}${reposTable(it)}</div></details>` +
    '</section>';
}

// -------------------------------------------------------------- sidebar
export function reposPanel() {
  const repos = (S.D && S.D.repos) || [];
  const add = '<button type="button" class="lnk plain" data-repo-open="1">Add a repo</button>';
  if (!repos.length) return `<section class="panel" aria-labelledby="repos-h"><h3 id="repos-h">Repos <span class="n">0</span></h3><p class="dim" style="margin:0">No repos in your workspace yet. ${add}</p></section>`;
  const busy = [], clean = [];
  repos.forEach(r => {
    const g = r.git || {};
    const onDefault = !g.branch || g.branch === g.defaultBranch;
    if (g.changed || g.ahead || g.detached || !onDefault) busy.push(r); else clean.push(r);
  });
  busy.sort((a, b) => (b.git.changed || 0) - (a.git.changed || 0));
  const li = busy.map(r => {
    const g = r.git;
    const owner = r.owner ? (r.ownerKnown ? `<button type="button" class="lnk" data-open-item="${h(r.owner)}">#${h(r.owner)}</button>` : `<span title="No .work folder for this id">#${h(r.owner)}?</span>`) : '';
    const flags = repoFlags(g, null).filter(f => f[0] !== 'ok');
    if (!r.owner && g.branch && g.branch !== g.defaultBranch) flags.unshift(['info', 'Not a pipeline branch']);
    const bl = g.links && g.links.branch ? link(g.links.branch, 'Branch') : '';
    return `<li><div class="rn"><span>${h(r.folder)} ${owner}</span>${bl}</div>` +
      `<div class="branch">${h(g.detached ? '(detached)' : g.branch)}</div><div>${flagsHtml(flags)}</div>` +
      (g.lastSha ? `<div class="lc" title="${h(g.lastMsg)}"><span class="mono">${h(g.lastSha)}</span> ${h(g.lastMsg)}</div>` : '') + '</li>';
  }).join('');
  const cleanTxt = clean.length ? `<p class="clean-list">${plural(clean.length, 'repo')} clean on their default branch: ${clean.map(r => h(r.folder)).join(', ')}.</p>` : '';
  const guides = `<details class="repo-guides"${openAttr('repo-guides', false)} data-key="repo-guides"><summary>Repo guides</summary><p class="dim">An agent drafts how to build, test and navigate the repo, for you to review. Redo it after big changes.</p><ul>` +
    repos.map(r => `<li><span class="mono">${h(r.folder)}</span><button type="button" class="btn" data-guide="${h(r.folder)}">Draft guide</button></li>`).join('') + '</ul></details>';
  return `<section class="panel" aria-labelledby="repos-h"><h3 id="repos-h">Repos with work in progress <span class="n">${busy.length}</span></h3>` +
    (busy.length ? `<ul class="repo-list">${li}</ul>` : '<p class="dim" style="margin:0">Every repo is clean on its default branch.</p>') + cleanTxt + `<p class="repo-acts">${add}</p>` + guides + '</section>';
}

// One line per item per day: what moved, not every log entry. null: commands that do not move an item.
const VERB = {
  start: 'Started', spec: 'Wrote the spec', plan: 'Planned', approve: 'Approved', tasks: 'Split into tasks',
  bug: 'Analyzed the bug', quick: 'Wrote the quick plan', review: 'Reviewed', pr: 'Wrote PR text', pause: 'Paused', resume: 'Resumed',
  spike: 'Researched', docs: 'Wrote docs', tsd: 'Drafted the TSD', 'check-docs': 'Fact-checked', publish: 'Published',
  status: null, standup: null, dashboard: null, memory: null, 'onboard-repo': null
};
const ACTIVITY_ROWS = 8;
/** Recent activity: what moved, one line per item per day. folder: only that item's (the run page). */
export function activityHtml(folder) {
  const a = ((S.D && S.D.activity) || []).filter(e => !folder || e.folder === folder);
  if (!a.length) return '';
  const groups = [], byKey = {};
  a.forEach(e => { // newest first
    const key = (e.date || '').slice(0, 10) + '|' + e.folder;
    let g = byKey[key];
    if (!g) { g = byKey[key] = { date: e.date, id: e.id, folder: e.folder, title: e.title, entries: [] }; groups.push(g); }
    g.entries.push(e);
  });
  let out = '', lastDay = null;
  groups.slice(0, folder ? 30 : ACTIVITY_ROWS).forEach(g => {
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
      (folder ? '' : live ? `<button type="button" class="lnk it" data-open-item="${h(live.folder)}">${name}</button>` : `<span class="it">${name}</span>`) +
      `<span class="w">${h(line)}</span></div></li>`;
  });
  return `<ul class="timeline">${out}</ul>`;
}

// ---------------------------------------------------------------- header and menus
export const ICON = {
  theme: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="6.5"/><path d="M10 3.5a6.5 6.5 0 0 0 0 13z" fill="currentColor"/></svg>',
  more: '<svg viewBox="0 0 20 20" fill="currentColor"><circle cx="4.5" cy="10" r="1.6"/><circle cx="10" cy="10" r="1.6"/><circle cx="15.5" cy="10" r="1.6"/></svg>',
  x: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/></svg>',
  menu: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3.5 6h13M3.5 10h13M3.5 14h13"/></svg>'
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
  items += '<div class="sep"></div>' + (projectsOn() ? '<button type="button" role="menuitem" data-projects-open="1">Projects</button>' : '') +
    '<button type="button" role="menuitem" data-repos-open="1">Repos</button>' +
    '<button type="button" role="menuitem" data-cfg-open="1">opencode settings</button>';
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
  return `<div class="brand"><span class="logo" aria-hidden="true"><i></i></span><h1>Loom</h1>${S.version ? `<span class="ver">v${h(S.version)}</span>` : ''}</div>`;
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
  const tip = S.conn === 'on' && S.D ? (S.D.workspace ? S.D.workspace + '. ' : '') + 'Updated ' + timeOf(S.D.generatedMs) + '. opencode ' + (o.connected ? (o.version || '') + ' at ' + (o.url || '') : 'not connected') : '';
  return `<header class="top">${brandHtml()}${tabsHtml()}<span class="fresh">` +
    `<span class="pill ${st[0]}" title="${h(tip)}"><span class="led"></span>${h(st[1])}</span>` +
    `<button type="button" class="ibtn" data-more-menu="1" aria-label="More" title="More" aria-haspopup="menu">${ICON.more}</button></span></header>`;
}
function bannersHtml() {
  let out = '';
  if (S.conn === 'off') out += '<div class="banner">Workshop is not answering. Start it with <code>workshop start</code> (from a clone: <code>node workshop.mjs start</code>). This page reconnects by itself.</div>';
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
const SOURCE = `https://github.com/${SITE.repos.workshop}/blob/main/scripts`;
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
    install: `<p>One command installs Tandem, Workshop, and opencode and Node if you don't have them. No admin rights needed. It starts Workshop, opens it once in your browser to sign in, and allows this site. It does not turn on start at login; do that in Workshop settings.</p>` +
      osPick +
      `<p class="gneed">${win ? 'Open <b>PowerShell</b> (Start menu, type PowerShell) and paste this:' : 'Open <b>Terminal</b> and paste this:'}</p>` +
      cmds([installCommand(win, origin)]) +
      `<p class="note">${win ? 'If opencode has no AI model yet, it asks you to pick a provider and paste an API key. ' : 'If it ends by asking you to run <code>opencode auth login</code>, do that in a new Terminal window. '}Work goes in <code>~/work</code> (change it in opencode settings). Run the command again to update; your settings are kept. <a href="${SOURCE}/bootstrap.${win ? 'ps1' : 'sh'}" target="_blank" rel="noopener">View the script</a>.</p>` +
      `<div class="gcheck"><button type="button" class="btn primary" data-gcheck>Check for Workshop</button>` +
      `<details class="gport"><summary>Using another port?</summary><label>Port <input type="number" class="mono" data-gport min="1024" max="65535" value="${h(g.port)}"></label></details></div>` +
      gmsg(g.check || { ok: null, text: 'Marked done when Workshop answers.' }),
    connect: `<p>Click Connect, then allow this site in the Workshop window. If your browser asks to let this site reach your local network, allow it.</p>` +
      `<div class="gacts"><button type="button" class="btn primary" data-gpair>Connect to Workshop</button></div>` + gmsg(g.pair) +
      `<p class="note">Window says to open Workshop first? Workshop is signed in to a different browser. Run <code>workshop open --print</code> in a new ${win ? 'PowerShell' : 'Terminal'} window, open the address it prints in this browser, then connect again.</p>`
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
  const lost = S.wasPaired ? '<div class="banner">This page was connected to Workshop before, but Workshop is not answering. Start it with <code>workshop start</code> in a terminal. If that does not help, connect again below.</div>' : '';
  return `<section class="guide">${lost}<p class="eyebrow">Set up, ${doneCount} of ${GUIDE_STEPS.length} done</p>` +
    `<h2>Connect Loom to your computer</h2>` +
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
    title = 'Loom is not set up on this computer';
    body = '<p>Loom runs coding agents (Tandem, on opencode) on your work items: triage, drafting stories, building and reviewing code. It needs opencode, Tandem and an AI model your company allows, so it is optional; the rest of Workshop works without it.</p>'
      + '<p>To add it, run the Workshop installer again and answer <b>y</b> to the AI model question (in work mode, follow "Dispatch in work mode" in docs/install.md). Home\'s Get started has the steps under <b>Set up Dispatch for coding agents</b>.</p>'
      + '<p class="note">The box below still captures tasks, receipts and notes without it.</p>';
  } else if (c.state === 'disabled') {
    title = 'Turn on the opencode connector';
    body = '<p>Turn it on in Settings and set your workspace folder (the folder that holds <code>.work</code> and your repos).</p>';
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
    : act && S.agentUrl ? `<div class="acts"><a class="btn primary" href="${h(S.agentUrl)}/#/settings" target="_blank" rel="noopener">Open Settings in Workshop</a></div><p class="note">Only Workshop on this computer can turn the connector on.</p>`
    : act ? '<p class="note">Change it in Settings, in Workshop on this computer.</p>' : '';
  return `<div class="setup"><h2>${title}</h2>${body}${btn}</div>`;
}

// ---------------------------------------------------------------- page
// Run buckets, for Pick up here (pages.js). Work groups its rows by flows.js instead.
export const GROUPS = [
  ['needs', 'Needs you', ''],
  ['active', 'In progress', ''],
  ['paused', 'Paused', '']
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
  else if (!st.view) body = '<p>Loading settings.</p>';
  else {
    const locked = hostedOnly() && Object.keys(st.view.schema.properties || {}).length > 0;
    const toggle = S.mode === 'local'
      ? `<label class="cfg-row cfg-check cfg-on"><input type="checkbox" data-cfg-enabled="1"${st.enabled ? ' checked' : ''}><span><span class="cfg-t">Turn on the opencode connector</span><span class="cfg-d">Loom needs it on.</span></span></label>`
      : '';
    body = `<p>Saving restarts the connector.</p>` +
      `<form class="cfg" data-cfg-form="1" novalidate>${toggle}${cfgFields(st.view.schema, '', st.view.env)}</form>` +
      (locked ? `<p class="note">Greyed out settings can only be changed in Workshop on this computer${S.agentUrl ? `: <a href="${h(S.agentUrl)}/#/settings" target="_blank" rel="noopener">open Workshop settings</a>` : ''}.</p>` : '') +
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

// --------------------------------------------------------- start work: pick a flow (flows.js), then fill it in
// The flow cards are the main way work starts (Loom flow cards v1). Each flow starts with one action:
//   request:  a board card from what was asked, then triage (board command `request`: the board half's triage).
//   feature, bug: an ADO work item by number (`start`: /start <id> <lane>), shown when Tandem has ADO set up, or
//                 described (`start.local`: writes .work/L<n>-<name>/workitem.md, then /start L<n> <lane>). A feature
//                 can be a small change (the quick lane: one short plan).
//   spike:    a question to answer, an optional timebox, no code changes (`spike`: /spike <question> --timebox <t>).
//   epic:     an idea to scope into an epic, features and stories (`scope.start`: /scope <idea>).
//   handoff:  a board card to define and hand to a person (board command `handoff`: the board half's refine).
//   docs:     what to document (`docs.start`: /docs <target>), or as a technical spec, a product or repos
//             (`tsd.start`: /tsd <target>).
// S.ui.start: {flow, src, lane, size, type, project, busy, error}. What the person types lives in S.ui.drafts['start:<field>'].
export const adoOn = () => !!(S.D && S.D.tandem && S.D.tandem.ado);
// Older start modes and flows, still accepted (the hub, older links, Start work from findings).
const LEGACY = { describe: 'feature', quick: 'feature', small: 'feature', tsd: 'docs', spike: 'spike', ado: 'feature' };
export function startFlowOf(st) {
  if (!st) return null;
  if (st.flow && flowById(st.flow) && flowById(st.flow).picker !== false) return st.flow;
  return LEGACY[st.flow] || LEGACY[st.mode] || null;
}
export const TIMEBOXES = [['', 'No timebox'], ['1h', '1 hour'], ['2h', '2 hours'], ['4h', 'Half a day'], ['1d', 'A day']];
/** The action and args for the start sheet as filled in, or {error}. A board flow returns {board, args}. */
export function startRequest(st, drafts) {
  const d = k => String(drafts['start:' + k] || '').trim();
  const one = k => d(k).replace(/\s+/g, ' ');
  const flow = startFlowOf(st);
  const project = st.project && st.project !== INBOX ? st.project : null;
  if (!flow) return { error: 'Pick a flow.' };
  if (flow === 'request' || flow === 'handoff') {
    const title = one('title');
    if (!title) return { error: flow === 'request' ? 'Say what was asked for, in a few words.' : 'Give the work a short title.' };
    if (title.length > 255) return { error: 'Keep the title under 255 characters.' };
    const args = { title };
    if (d('desc')) args.description = d('desc').slice(0, 32000);
    if (flow === 'request' && one('requester')) args.requester = one('requester').slice(0, 200);
    return { board: flow, args };
  }
  if (flow === 'spike') {
    const topic = one('topic');
    if (!topic) return { error: 'Say what question to answer.' };
    const args = { topic: topic.slice(0, 500) };
    if (st.timebox && TIMEBOXES.some(([k]) => k && k === st.timebox)) args.timebox = st.timebox;
    return { action: 'spike', args };
  }
  if (flow === 'epic') {
    const idea = d('idea');
    if (!idea) return { error: 'Say what the idea is.' };
    if (idea.length > 4000) return { error: 'Keep the idea under 4000 characters.' };
    return { action: 'scope.start', args: { idea } };
  }
  if (flow === 'docs') {
    const target = one('target');
    if (st.type === 'tsd' || st.flow === 'tsd') {
      if (!target) return { error: 'Name the product, or the repo folders.' };
      if (!TSD_TARGET.test(target)) return { error: 'A product name or repo folders separated by spaces: letters, numbers, spaces, dots, dashes, underscores and /.' };
      return { action: 'tsd.start', args: { target } };
    }
    if (!target) return { error: 'Say what to document.' };
    if (target.length > 500) return { error: 'Keep it under 500 characters.' };
    return { action: 'docs.start', args: { target } };
  }
  const lane = flow === 'bug' || (st.flow === 'quick' && st.lane === 'bug') ? 'bug' : st.size === 'small' || st.flow === 'small' ? 'quick' : 'feature';
  if (flow !== 'feature' && flow !== 'bug') return { error: 'Pick a flow.' };
  // Fix a bug from an error log: a diagnosis first (Core 4.3.0 /spike <folder> --log), configuration before code.
  if (flow === 'bug' && st.src === 'log') {
    const log = String(drafts['start:log'] || '').replace(/\r\n?/g, '\n');
    if (!log.trim()) return { error: 'Paste the error log or stack trace.' };
    if (log.length > MAX_LOG) return { error: `Keep the log under ${MAX_LOG / 1000}k characters: the lines around the first error are enough.` };
    const args = { log };
    if (one('where')) args.where = one('where').slice(0, 300);
    return { action: 'spike', args };
  }
  if (startSrc(st) === 'ado') {
    const r = startCheck(d('id'), lane);
    if (r.error) return r;
    const args = { id: r.id, lane };
    if (project) args.project = project;
    return { action: 'start', args };
  }
  const title = one('title');
  if (!title) return { error: 'Give the work a short title.' };
  if (title.length > 200) return { error: 'Keep the title under 200 characters.' };
  const args = { title, lane };
  if (d('desc')) args.description = d('desc');
  if (lane === 'bug' && d('repro')) args.repro = d('repro');
  if (project) args.project = project;
  return { action: 'start.local', args };
}
/** Where a feature or bug comes from: an ADO item (when Tandem has ADO set up) or described ("No ADO item"). */
export const startSrc = st => st.src === 'log' && startFlowOf(st) === 'bug' ? 'log' : (adoOn() && (st.src || (st.mode === 'describe' || st.flow === 'quick' ? 'describe' : 'ado')) === 'ado' ? 'ado' : 'describe');
/** The longest log Start work sends (the connector's MAX_LOG). */
export const MAX_LOG = 100000;
// What /tsd takes: a product name from the repo map, or repo folders (as the connector checks).
export const TSD_TARGET = /^[A-Za-z0-9][A-Za-z0-9 ._\/-]{0,299}$/;
export function startCheck(raw, lane) {
  const id = String(raw || '').trim().replace(/^#/, '');
  if (!/^[0-9]{1,10}$/.test(id)) return { error: 'Type the work item number, like 12345.' };
  if (lane !== 'feature' && lane !== 'bug' && lane !== 'quick') return { error: 'Pick Feature or Bug.' };
  if ((S.D && S.D.items || []).some(it => String(it.id) === id)) return { error: `#${id} is already started. It is in the list.` };
  return { id, lane };
}
function startFormHtml(f, st) {
  const dv = k => h(S.ui.drafts['start:' + k] || '');
  const pnow = st.project || INBOX;
  const projectPick = projectsOn() && projectList().length > 1 ? `<label class="cfg-row"><span class="cfg-t">Project</span><span class="cfg-d">The run gets the project's instructions.</span><select data-start-project="1">` +
    projectList().map(p => `<option value="${h(p.id)}"${p.id === pnow ? ' selected' : ''}>${h(projectName(p))}</option>`).join('') + '</select></label>' : '';
  const toggle = (attr, cur, opts, label) => `<div class="gos start-modes" role="group" aria-label="${h(label)}">` +
    opts.map(([k, l]) => `<button type="button" ${attr}="${h(k)}" aria-pressed="${cur === k}"${cur === k ? ' class="on"' : ''}>${h(l)}</button>`).join('') + '</div>';
  if (f.id === 'request') {
    return `<p>Adds the request as a card in Clarify and starts a triage: Tandem reads it and the code, and says what is missing. Then you pick the path. Runs <code>/triage</code>.</p>` +
      `<label class="cfg-row"><span class="cfg-t">What was asked for</span><input type="text" class="start-first" data-draft="start:title" value="${dv('title')}" placeholder="Export the audit log as CSV" maxlength="255" autocomplete="off"></label>` +
      `<label class="cfg-row"><span class="cfg-t">Asked by</span><input type="text" data-draft="start:requester" value="${dv('requester')}" placeholder="A name, a team, or a customer" maxlength="200" autocomplete="off"></label>` +
      `<label class="cfg-row"><span class="cfg-t">Their words, and anything you know</span><textarea rows="4" data-draft="start:desc" placeholder="Paste the message. The more it says, the fewer questions triage has.">${dv('desc')}</textarea></label>`;
  }
  if (f.id === 'handoff') {
    return `<p>Adds it as a card in Lanes and drafts one story for you to approve. Then you pick who builds it and assign it in ADO in one step, and its card nudges you if it stalls. Runs <code>/refine</code>.</p>` +
      `<label class="cfg-row"><span class="cfg-t">Title</span><input type="text" class="start-first" data-draft="start:title" value="${dv('title')}" placeholder="Add paging to the audit log" maxlength="255" autocomplete="off"></label>` +
      `<label class="cfg-row"><span class="cfg-t">What is needed, and why</span><textarea rows="5" data-draft="start:desc" placeholder="What you know so far. The draft asks at most 2 questions.">${dv('desc')}</textarea></label>`;
  }
  if (f.id === 'spike') {
    const tb = st.timebox || '';
    return `<p>An agent reads the code and answers your question with up to 3 options and a recommendation. No code changes. Runs <code>/spike</code>.</p>` +
      `<label class="cfg-row"><span class="cfg-t">The question to answer</span><textarea class="start-first" rows="3" data-draft="start:topic" placeholder="What would it take to make sessions last 8 hours?">${dv('topic')}</textarea></label>` +
      `<div class="cfg-row"><span class="cfg-t">Timebox</span><span class="cfg-d">Optional. It reports what it has when the time is up.</span>${toggle('data-start-timebox', tb, TIMEBOXES, 'Timebox')}</div>`;
  }
  if (f.id === 'epic') {
    return `<p>Reads the repo map, the product docs and the code, asks at most 3 questions, then writes the epic and its stories for you to approve. Runs <code>/scope</code>.</p>` +
      `<label class="cfg-row"><span class="cfg-t">The idea</span><textarea class="start-first" rows="4" data-draft="start:idea" placeholder="Add a change request ticket type, with its own approval step">${dv('idea')}</textarea></label>`;
  }
  if (f.id === 'docs') {
    const type = st.type === 'tsd' ? 'tsd' : 'docs';
    const pick = `<div class="cfg-row"><span class="cfg-t">Type</span>${toggle('data-start-type', type, [['docs', 'Docs'], ['tsd', 'Technical spec']], 'Type')}</div>`;
    if (type === 'tsd') {
      return pick + `<p>Confirms the repos with you, lists what is there, asks you to pick the flows to trace, then writes the spec with diagrams. Runs <code>/tsd</code>.</p>` +
        `<label class="cfg-row"><span class="cfg-t">Product or repos</span><span class="cfg-d">A product name from the repo map, or repo folders separated by spaces.</span><input type="text" class="mono start-first" data-draft="start:target" value="${dv('target')}" placeholder="Billing" maxlength="300" spellcheck="false" autocomplete="off"></label>`;
    }
    return pick + `<p>Picks where the doc lives, who reads it and what they need, then writes it from the code. Runs <code>/docs</code>.</p>` +
      `<label class="cfg-row"><span class="cfg-t">What to document</span><input type="text" class="start-first" data-draft="start:target" value="${dv('target')}" placeholder="How to run the gateway locally" maxlength="500" autocomplete="off"></label>`;
  }
  // Build a feature, Fix a bug: an ADO item, or no ADO item (described). A feature can be a small change.
  const lane = f.id === 'bug' ? 'bug' : st.size === 'small' ? 'quick' : 'feature';
  const src = startSrc(st);
  const srcOpts = [...(adoOn() ? [['ado', 'ADO work item']] : []), ['describe', adoOn() ? 'No ADO item' : 'Describe it'], ...(f.id === 'bug' ? [['log', 'Error log']] : [])];
  const srcPick = srcOpts.length > 1 ? toggle('data-start-src', src, srcOpts, 'Where the work is') : '';
  if (src === 'log') {
    return srcPick + `<p>Paste the log. Tandem finds where it happens, checks the configuration first, then the code, and writes the probable root cause, why, and a solution: a setting change when one fixes it. Nothing is changed. Runs <code>/spike --log</code>.</p>` +
      `<label class="cfg-row"><span class="cfg-t">The error log or stack trace</span><span class="cfg-d">Passwords, keys, tokens and email addresses are masked before it is saved, but take out anything sensitive first.</span><textarea class="mono start-first" rows="10" data-draft="start:log" spellcheck="false" placeholder="System.TimeoutException: The operation has timed out.&#10;   at Eligibility.Client.Check() in Client.cs:line 42">${dv('log')}</textarea></label>` +
      `<label class="cfg-row"><span class="cfg-t">Where it happened</span><span class="cfg-d">Optional: the service and environment, if the log does not say.</span><input type="text" data-draft="start:where" value="${dv('where')}" placeholder="eligibility-api, production" maxlength="300" autocomplete="off"></label>`;
  }
  const sizePick = f.id === 'feature' ? `<div class="cfg-row"><span class="cfg-t">Size</span>${toggle('data-start-size', st.size === 'small' ? 'small' : 'normal', [['normal', 'Feature'], ['small', 'Small change']], 'Size')}` +
    `<span class="cfg-d">${st.size === 'small' ? 'One repo, 1 or 2 tasks, no schema or API change: one short plan to approve instead of a spec and plan.' : 'Spec and plan to approve, then the build.'}</span></div>` : '';
  if (src === 'ado') {
    return srcPick + sizePick + `<p>Fetches the work item from Azure DevOps, sets up its <code>.work</code> folder and branches, then waits for you. Runs <code>/start</code>.</p>` +
      `<label class="cfg-row"><span class="cfg-t">Work item number</span><input type="text" inputmode="numeric" class="mono start-id start-first" data-draft="start:id" value="${dv('id')}" placeholder="12345" autocomplete="off"></label>` + projectPick;
  }
  return srcPick + sizePick + `<p>Tandem saves this as a local work item, picks the repos, makes branches, then waits for you. Link an ADO item later; the PR needs one.</p>` + projectPick +
    `<label class="cfg-row"><span class="cfg-t">Title</span><input type="text" class="start-first" data-draft="start:title" value="${dv('title')}" placeholder="${lane === 'bug' ? 'Export fails after one retry' : 'Add CSV export to reports'}" maxlength="200" autocomplete="off"></label>` +
    `<label class="cfg-row"><span class="cfg-t">What should change, and why</span><textarea rows="5" data-draft="start:desc" placeholder="The more you say, the fewer questions the agent asks.">${dv('desc')}</textarea></label>` +
    (lane === 'bug' ? `<label class="cfg-row"><span class="cfg-t">Steps to reproduce</span><textarea rows="3" data-draft="start:repro" placeholder="1. Open reports 2. Click Export twice">${dv('repro')}</textarea></label>` : '');
}
const GO_LABEL = { request: 'Add and triage', handoff: 'Add and define', spike: 'Investigate' };
function startSheetHtml() {
  const st = S.ui.start;
  const o = (L() && L().opencode) || {};
  const f = flowById(startFlowOf(st));
  const head = `<div class="sheet-head"><h3 id="start-h">${f ? h(f.name) : 'Other flows'}</h3><button type="button" class="ibtn" data-close-sheet="1" aria-label="Close">${ICON.x}</button></div>`;
  let body, foot;
  if (!f) {
    // Loom 6.0.0: a build, a bug, a question or a hand-off starts from Lanes' drop box; these are the rest.
    body = '<p class="start-lead">Less common work. A story, an error log, a question or a hand-off goes in the drop box.</p>' +
      `<div class="fcards">${PICKER.filter(x => OTHER_FLOWS.includes(x.id)).map(flowCardHtml).join('')}</div>`;
    foot = '<span class="grow"></span><button type="button" class="btn" data-close-sheet="1">Cancel</button>';
  } else {
    const lane = f.id === 'bug' ? 'bug' : st.size === 'small' ? 'quick' : 'feature';
    const shown = flowById(f.id === 'docs' && st.type === 'tsd' ? 'tsd' : f.id === 'feature' && lane === 'quick' ? 'small' : f.id === 'bug' && startSrc(st) === 'log' ? 'diagnose' : f.id);
    const steps = shownSteps(stepsOf(shown, lane));
    const flowLine = `<div class="start-flow"><button type="button" class="lnk plain" data-flow="">&larr; All flows</button>` +
      `<ol class="fline">${steps.map(s => `<li class="${s.you === true ? 'you' : s.you ? 'maybe' : ''}">${h(s.name)}</li>`).join('')}</ol>` +
      (f.handsOff && shown.id !== 'diagnose' ? '<p class="note">Hands-off after you approve: <b>Approve</b> runs the tasks, review, UI checks and PR text, and stops only when it needs you. You publish it.</p>' : '') + '</div>';
    body = flowLine + `<form class="cfg" data-start-form="1" novalidate>${startFormHtml(f, st)}</form>` +
      (o.connected ? '' : '<p class="gmsg bad">opencode is not connected, so nothing can start.</p>') +
      (st.error ? `<p class="gmsg bad" role="status">${md(st.error)}</p>` : '');
    foot = '<span class="grow"></span><button type="button" class="btn" data-close-sheet="1">Cancel</button>' +
      `<button type="button" class="btn primary" data-start-go="1"${st.busy || (!o.connected && !f.board) ? ' disabled' : ''}>${st.busy ? 'Starting' : h(f.id === 'bug' && startSrc(st) === 'log' ? 'Diagnose' : GO_LABEL[f.id] || 'Start')}</button>`;
  }
  return `<div class="modal" data-sheet="1"><div class="backdrop" data-close-sheet="1"></div><div class="sheet${f ? '' : ' wide'}" role="dialog" aria-modal="true" aria-labelledby="start-h">${head}${body}<footer>${foot}</footer></div></div>`;
}

// --------------------------------------------------------- repos
// Add a repo (`repo.add`: git clone into the workspace and list it in the repo map), then offer to draft its
// guide (`repo.guide`: /onboard-repo). S.ui.repo: {busy, error, added: {folder, repoMap} | null}.
export function repoUrlCheck(raw) {
  const u = String(raw || '').trim();
  if (!u) return { error: 'Paste the repo\'s clone URL.' };
  if (/\s/.test(u)) return { error: 'A clone URL has no spaces.' };
  if (!/^(https?:\/\/[^/]+\/.+|ssh:\/\/[^/]+\/.+|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:.+)$/i.test(u)) return { error: 'That does not look like a git URL. Copy it from the repo\'s Clone button, for example https://github.com/owner/repo.git' };
  return { url: u };
}
// Category folders Add a repo can clone into: the parser's list, plus every parent folder in repo names
// ("Platform/Lighthouse/ui" gives Platform and Platform/Lighthouse).
export function repoCategories() {
  const set = new Set(((S.D && S.D.repoCategories) || []).filter(c => typeof c === 'string' && c));
  ((S.D && S.D.repos) || []).forEach(r => {
    const parts = String(r.folder || '').split('/');
    for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join('/'));
  });
  return [...set].sort((a, b) => a.localeCompare(b));
}
export const NEW_CATEGORY = '__new';
// A category folder path: folder names separated by "/" (at most 3), each letters, numbers, spaces, dots,
// dashes and underscores, not starting with a dot or dash and no space at either end. Matches the connector.
const CAT_SEGMENT = /^[A-Za-z0-9_](?:[A-Za-z0-9._ -]{0,98}[A-Za-z0-9._-])?$/;
export function categoryPathOk(c) {
  const parts = String(c || '').replace(/\\/g, '/').split('/');
  return parts.length <= 3 && parts.every(p => CAT_SEGMENT.test(p));
}
// The category from the picker: '' for the top of the workspace, else a folder path such as Platform/Lighthouse.
export function repoCategoryCheck(pick, typed) {
  if (pick !== NEW_CATEGORY) return { category: pick || '' };
  const c = String(typed || '').trim().replace(/\\/g, '/');
  if (!c) return { error: 'Name the new category folder, or pick another one.' };
  if (!categoryPathOk(c)) return { error: 'A category is a folder name, or up to 3 separated by /, such as Platform or Platform/Lighthouse Edge. Letters, numbers, spaces, dots, dashes and underscores.' };
  return { category: c };
}
function repoSheetHtml() {
  const st = S.ui.repo;
  const head = `<div class="sheet-head"><h3 id="repo-h">${st.added ? 'Repo added' : 'Add a repo'}</h3><button type="button" class="ibtn" data-close-sheet="1" aria-label="Close">${ICON.x}</button></div>`;
  let body, foot;
  if (st.added) {
    const a = st.added;
    body = `<p><b>${h(a.folder)}</b> is in your workspace${a.repoMap === 'listed' ? '' : a.repoMap === 'created' ? ', and Loom started a repo map (<code>AGENTS.md</code> in the workspace) that lists it' : ', and it is listed in the repo map (<code>AGENTS.md</code> in the workspace)'}.</p>` +
      `<p>Next, draft its guide: an agent writes how to build, test and navigate it, and every task in this repo uses it. You review the draft first. Runs <code>/onboard-repo</code>.</p>`;
    foot = '<span class="grow"></span><button type="button" class="btn" data-close-sheet="1">Later</button>' +
      `<button type="button" class="btn primary" data-guide="${h(a.folder)}">Draft its guide</button>`;
  } else {
    body = `<p>Clones it into your workspace with the git sign-in on this computer.</p>` +
      `<form class="cfg" data-repo-form="1" novalidate>` +
      `<label class="cfg-row"><span class="cfg-t">Clone URL</span><input type="text" class="mono repo-url" data-draft="repo:url" value="${h(S.ui.drafts['repo:url'] || '')}" placeholder="https://github.com/owner/repo.git" spellcheck="false" autocomplete="off"></label>` +
      repoCategoryHtml() +
      `<label class="cfg-row"><span class="cfg-t">What it is, in one line (optional)</span><span class="cfg-d">Helps agents pick the right repo for a task.</span><input type="text" data-draft="repo:about" value="${h(S.ui.drafts['repo:about'] || '')}" placeholder="The web app customers use" maxlength="200" autocomplete="off"></label></form>` +
      `<p class="note">Already have the code on this computer? Move or clone the folder into your workspace (<code>${h(S.D && S.D.workspace)}</code>) and it shows up here.</p>` +
      (st.error ? `<p class="gmsg bad" role="status">${md(st.error)}</p>` : '');
    foot = '<span class="grow"></span><button type="button" class="btn" data-close-sheet="1">Cancel</button>' +
      `<button type="button" class="btn primary" data-repo-go="1"${st.busy ? ' disabled' : ''}>${st.busy ? 'Cloning' : 'Add repo'}</button>`;
  }
  return `<div class="modal" data-sheet="1"><div class="backdrop" data-close-sheet="1"></div><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="repo-h">${head}${body}<footer>${foot}</footer></div></div>`;
}

function repoCategoryHtml() {
  const cats = repoCategories();
  const pick = S.ui.drafts['repo:category'] || '';
  const opts = [`<option value=""${pick === '' ? ' selected' : ''}>None (top of the workspace)</option>`]
    .concat(cats.map(c => `<option value="${h(c)}"${c === pick ? ' selected' : ''}>${h(c)}</option>`))
    .concat([`<option value="${NEW_CATEGORY}"${pick === NEW_CATEGORY ? ' selected' : ''}>New category</option>`]);
  if (pick && pick !== NEW_CATEGORY && !cats.includes(pick)) opts.splice(1, 0, `<option value="${h(pick)}" selected>${h(pick)}</option>`);
  return `<label class="cfg-row"><span class="cfg-t">Category</span><span class="cfg-d">The folder in your workspace it goes in.</span><select data-draft="repo:category" data-repo-cat="1">${opts.join('')}</select></label>` +
    (pick === NEW_CATEGORY ? `<label class="cfg-row"><span class="cfg-t">New category folder</span><input type="text" class="mono repo-newcat" data-draft="repo:newcat" value="${h(S.ui.drafts['repo:newcat'] || '')}" placeholder="Platform or Platform/Lighthouse" maxlength="300" spellcheck="false" autocomplete="off"></label>` : '');
}

// --------------------------------------------------------- getting set up
// After Workshop is connected, three things stand between "installed" and "an agent is on my task": an AI
// provider in opencode, a repo in the workspace, and a first piece of work. This checklist shows until all
// three are done. AI status comes from the connector (liveMode.live.opencode.ai): {known, providers}.
export function aiState() {
  const ai = L() && L().opencode && L().opencode.ai;
  if (!ai || !ai.known) return 'unknown';
  return (ai.providers || []).length ? 'on' : 'off';
}
export const AI_LOGIN = 'opencode auth login';
function aiHelpHtml() {
  return `<p>Agents need an AI model. Open ${((S.setup && S.setup.os) || 'win') === 'win' ? 'PowerShell' : 'Terminal'}, run this, pick a provider and paste its API key:</p>` +
    `<div class="kit gcmd"><div class="kit-line"><code>${AI_LOGIN}</code>${copyBtn(AI_LOGIN)}</div></div>` +
    `<p class="note">For Claude, pick <b>Anthropic</b> and use an API key from <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a>. The key stays in opencode on this computer.</p>`;
}
export function onboardSteps() {
  const ai = aiState();
  const repos = ((S.D && S.D.repos) || []).length;
  const items = ((S.D && S.D.items) || []).length;
  return [
    { k: 'ai', done: ai !== 'off', title: ai === 'on' ? `AI connected: ${L().opencode.ai.providers.join(', ')}` : ai === 'unknown' ? 'Connect an AI model' : 'Connect an AI model' },
    { k: 'repo', done: repos > 0, title: repos ? `${plural(repos, 'repo')} in your workspace` : 'Add a repo' },
    { k: 'work', done: items > 0, title: 'Start your first piece of work' }
  ];
}
export function onboardHtml() {
  const steps = onboardSteps();
  if (steps.every(x => x.done)) return '';
  const open = (steps.find(x => !x.done) || {}).k;
  const ai = aiState();
  const bodies = {
    ai: aiHelpHtml() + `<div class="gacts"><button type="button" class="btn primary" data-ai-check="1">Check again</button></div>` +
      (ai === 'unknown' ? '<p class="note">This opencode version does not report providers, so Loom cannot check. Skip this if you already logged in.</p>' : ''),
    repo: `<p>Agents work in git repos in your workspace folder.</p><div class="gacts"><button type="button" class="btn primary" data-repo-open="1">Add a repo</button></div>`,
    work: `<p>Describe a change or ask a question about the code.</p><div class="gacts"><button type="button" class="btn primary" data-start-open="1">Start work</button></div>`
  };
  const li = steps.map((x, i) => `<li class="gstep${x.done ? ' done' : ''}${x.k === open ? ' open' : ''}"><div class="ghead"><span class="gnum" aria-hidden="true">${x.done ? CHECK_SVG : i + 1}</span><span class="gt">${h(x.title)}</span>${x.done ? '<span class="gstate">Done</span>' : ''}</div>` +
    (x.k === open ? `<div class="gbody">${bodies[x.k]}</div>` : '') + '</li>').join('');
  return `<section class="guide onboard" aria-label="Getting set up"><p class="eyebrow">Getting set up, ${steps.filter(x => x.done).length} of 3 done</p><ol class="gsteps">${li}</ol></section>`;
}

// --------------------------------------------------------- spikes and repo guides
// Sessions started from Dispatch that are not (yet) tied to a .work item: a spike before its folder exists,
// and repo guides (liveMode.live.others). Drawn like an item's agent box, with a Dismiss button once idle.
export function looseSessions() {
  if (!L() || !L().others) return [];
  return L().others.map(o => ({ ...o, s: L().sessions[o.session] })).filter(o => o.s && !o.s.folder);
}

function reposSheetHtml() {
  return `<div class="modal" data-sheet="1"><div class="backdrop" data-close-sheet="1"></div><div class="sheet wide" role="dialog" aria-modal="true" aria-labelledby="repos-h">` +
    reposPanel().replace('<section class="panel" aria-labelledby="repos-h"><h3 id="repos-h">', `<section class="panel" aria-labelledby="repos-h"><div class="sheet-head"><h3 id="repos-h">`).replace(/<\/h3>/, `</h3><button type="button" class="ibtn" data-close-sheet="1" aria-label="Close">${ICON.x}</button></div>`) +
    '<footer><span class="grow"></span><button type="button" class="btn" data-close-sheet="1">Close</button></footer></div></div>';
}

function overlaysHtml() {
  const ui = S.ui;
  return menuHtml() + (ui.project ? projectSheetHtml() : ui.move ? moveSheetHtml() : ui.projects ? projectsSheetHtml() : ui.repo ? repoSheetHtml() : ui.repos ? reposSheetHtml() : ui.start ? startSheetHtml() : ui.settings ? settingsSheetHtml() : ui.remove ? removeSheetHtml() : ui.file ? fileSheetHtml() : '');
}

/** The whole page: the header with its tabs, then the tab in view (pages.js). Resets the copy list, so call it
 *  once per paint. Before the connector is ready: what is wrong, and the hub's capture box under it (#hub-slot). */
// var, set before this module's body runs: pages.js (which this module imports) hands over the Lanes page.
var lanesView; // eslint-disable-line no-var
export function setLanesView(f) { lanesView = f; }
export function render() {
  S.copyStore = [];
  // The afternoon digest shows here too: with the opencode connector off it lists what other apps report.
  // Board and Health work without the agents: the tab bar over the board half's page (loom.js).
  // The tab bar is always there: Board and Health work without the agents (loom.js); the other tabs show the setup.
  const bar = `<header class="top">${brandHtml()}${tabsHtml()}</header>`;
  if ((!S.connector || S.connector.state !== 'ready' || !S.D) && BOARD_TABS.includes(S.ui.tab)) return bar + overlaysHtml();
  // Lanes without the agents (Loom 5.2.0): the board's own items, From ADO and the drop box still work; what is
  // missing for Tandem's runs folds into one line that opens.
  if ((!S.connector || S.connector.state !== 'ready' || !S.D) && S.ui.tab === 'lanes') {
    return bar + `<details class="ln-setup"><summary>Tandem is not connected, so runs can't start or show here. Set it up</summary>${setupHtml()}</details>` +
      `<div class="page" data-page="lanes">${lanesView ? lanesView() : ''}</div>` + overlaysHtml();
  }
  if (!S.connector || S.connector.state !== 'ready' || !S.D) return bar + (S.digestHtml ? S.digestHtml(h) : '') + setupHtml() + overlaysHtml();
  return headerHtml() + bannersHtml() + `<div class="page" data-page="${h(S.ui.tab)}">${pageHtml()}</div>` + (S.D.gitAvailable ? '' : '<p class="note">git was not found on PATH, so repo state is missing.</p>') + overlaysHtml();
}

/** Open prompts and questions, for the rail badge and alerts. */
export function prompts() {
  if (!L()) return [];
  return L().permissions.map(p => ({ id: p.id, sid: p.sessionID, folder: p.folder, text: 'Allow ' + p.permission + (p.title ? ': ' + p.title : '') }))
    .concat(L().questions.map(q => ({ id: q.id, sid: q.sessionID, folder: q.folder, text: ((q.questions || [])[0] || {}).question || 'The agent has a question' })));
}
