/* Slate: HTML for the board, the item panel and the dialogs. Pure: takes state, returns strings. Every value from
   data goes through esc(). Buttons carry data-act (and data-id); main.js handles the clicks. */
import { outsideBanner, outsideMark } from '../../../shared/outside.js';
import { BOARD_COLUMNS, CARD_FIELDS, DETAIL_FIELDS, LEVELS, LEVEL_NAME, STAGE_TITLE, areaOf, changedInAdo, detailRows, esc, parseBrief, parseRefine, parseTriage, releaseGroups } from './model.js';

const chip = (text, cls = '') => `<span class="chip ${cls}">${esc(text)}</span>`;
// out: 'ado' when the action changes Azure DevOps (after a confirm): the button carries the mark (shared/outside.js).
const btn = (act, label, { id = '', primary = false, extra = '', title = '', out = '' } = {}) =>
  `<button type="button" class="btn${primary ? ' primary' : ''}" data-act="${esc(act)}"${id ? ` data-id="${esc(id)}"` : ''}${title ? ` title="${esc(title)}"` : ''}${out ? ' data-out' : ''}${extra}>${esc(label)}${out ? ' ' + outsideMark(out) : ''}</button>`;

/* ---------- top bar ---------- */

/* A note above the board: text, or {text, acts: [{act, label}]} for one with buttons (How to set it up, Got it). */
const noteHtml = (n) => typeof n === 'string' ? `<p class="note">${esc(n)}</p>`
  : `<p class="note">${esc(n.text)}${(n.acts || []).map(a => ` ${btn(a.act, a.label, { extra: ' data-small' })}`).join('')}</p>`;

export function topHtml(ui, notes, areas = []) {
  const tab = (key, label) => `<button type="button" class="tab${ui.tab === key ? ' on' : ''}" role="tab" aria-selected="${ui.tab === key}" data-act="tab" data-id="${key}">${label}</button>`;
  const board = ui.tab === 'board';
  return `<div class="top">
    <div class="tabs" role="tablist" aria-label="Slate">${tab('board', 'Board')}${tab('health', 'Health')}</div>
    ${board ? `<label class="sr" for="q">Search</label><input id="q" class="q" type="search" placeholder="${ui.noAdo ? 'Search titles' : 'Search titles and #ids'}" value="${esc(ui.q)}" autocomplete="off">
    <label class="sr" for="lvl">Level</label><select id="lvl" class="lvl"><option value="">All levels</option>${LEVELS.map(l => `<option value="${l}"${ui.level === l ? ' selected' : ''}>${LEVEL_NAME[l]}</option>`).join('')}</select>
    ${areas.length ? `<label class="sr" for="area">Area path</label><select id="area" class="area" title="Show one area path and everything under it"><option value="">All areas</option>${areas.map(a => `<option value="${esc(a.path)}"${ui.area === a.path ? ' selected' : ''}>${'\u00a0\u00a0'.repeat(a.depth)}${esc(a.label)} (${a.count})</option>`).join('')}</select>` : ''}
    <span class="grow"></span>
    ${ui.canRuns ? btn('runs', 'All runs', { title: 'Every Tandem run in one list, with flow and project filters' }) : ''}
    ${btn('fields', 'Fields', { title: 'Which ADO fields cards and the panel show' })}
    ${btn('refresh', 'Refresh', { title: 'Read Azure DevOps and Tandem again' })}
    ${btn('new-idea', 'New idea', { title: 'Your own idea: an agent interviews you to shape it' })}
    ${btn('new', 'New request', { primary: true })}` : '<span class="grow"></span>'}
  </div>${notesHtml(notes, ui.notesOpen)}`;
}

/* Errors and status lines stay in view. Two or more setup notes (the ones with buttons) fold into one line that
   opens (docs/layout.md, .ws-notices), so the board keeps its height. */
export function notesHtml(notes, open = false) {
  if (!notes.length) return '';
  const setup = notes.filter(n => typeof n !== 'string'), plain = notes.filter(n => typeof n === 'string');
  const fold = setup.length >= 2;
  return `${plain.length || !fold ? `<div class="notes">${(fold ? plain : notes).map(noteHtml).join('')}</div>` : ''}${fold
    ? `<details class="ws-notices slate-notices"${open ? ' open' : ''}><summary>${setup.length} setup notes</summary>${setup.map(n => `<div class="ws-note">${noteHtml(n)}</div>`).join('')}</details>` : ''}`;
}

/* ---------- board ---------- */

function agentLine(a) {
  if (!a) return '';
  if (a.waiting) return `<span class="dot wait" aria-hidden="true"></span><span class="warn">Waiting on you</span>`;
  if (a.busy) return `<span class="dot busy" aria-hidden="true"></span>Agent working`;
  if (a.error) return `<span class="bad">${esc(a.error)}</span>`;
  return '';
}

function card(c, s) {
  const meta = [];
  if (c.fromRunway) meta.push('From Runway');
  if (c.ado) meta.push(`#${c.ado.id}`);
  if (c.triage && c.triage.size) meta.push(`Size ${c.triage.size}`);
  if (c.route) meta.push(c.route === 'delegate' ? 'Delegate' : 'Myself');
  if (c.assigneeName && c.stage !== 'delegated') meta.push(c.assigneeName);
  if (c.requester) meta.push(`from ${c.requester}`);
  if (!c.virtual && c.age) meta.push(`${c.age}d`);
  const flags = [];
  if (c.step) flags.push(chip(c.step, c.step === 'Waiting on you' ? 'warn' : 'step'));
  if (c.noAdo) flags.push(chip('No ADO item', 'warn'));
  if (c.ado && c.ado.choices && c.ado.choices.length > 1) flags.push(chip('Which collection?', 'warn'));
  if (c.fromLoom) flags.push(chip('From a run', 'soft'));
  if (c.stale) flags.push(chip('Stale', 'warn'));
  if (changedInAdo(c)) flags.push(chip('Changed in ADO', 'warn'));
  if (c.virtual && c.ado) flags.push(chip('In ADO', 'soft'));
  if (c.kind === 'idea' || c.fromRunway || c.runwayPending) flags.push(chip('Idea', 'soft'));
  if (c.skipped) flags.push(chip('Skipped shaping', 'soft'));
  return `<li><button type="button" class="card${s.open === c.id ? ' open' : ''}" data-act="open" data-id="${esc(c.id)}">
    <span class="row1">${chip(typeLabel(c), `lv-${c.level}`)}${flags.join('')}</span>
    <span class="title">${esc(c.title)}</span>
    <span class="meta">${esc(meta.join(' · '))}</span>
    ${c.facts && c.facts.facts.length ? `<span class="ado">${c.facts.facts.map(f => `<span class="f-${esc(f.key)}"${f.title ? ` title="${esc(f.title)}"` : ''}>${esc(f.text)}</span>`).join('')}</span>` : ''}
    ${c.facts && c.facts.tags.length ? `<span class="tags">${c.facts.tags.map(t => chip(t, 'tag')).join('')}</span>` : ''}
    ${c.agent ? `<span class="agent">${agentLine(c.agent)}</span>` : c.shapeAsking ? `<span class="agent"><span class="dot wait" aria-hidden="true"></span><span class="warn">Your turn: round ${esc(c.shapeRound || 1)}</span></span>` : ''}
  </button></li>`;
}

// Column hints without Azure DevOps: nothing is published or resolved there.
const NO_ADO_HINT = {
  shape: 'Requests, ideas and runs, then triage, the interview or a brief. The card says which.',
  decide: 'The story or stories and their acceptance criteria, written and approved here, then who builds it.',
  done: 'Done, waiting for a release. Mark it closed when it ships.'
};

export function boardHtml(columns, s) {
  const total = BOARD_COLUMNS.reduce((n, d) => n + (columns[d.key] || []).length, 0);
  if (!total && s.filtered) {
    return `<div class="empty"><h2>Nothing here</h2><p>No cards match the area path, level or search you picked.</p></div>`;
  }
  if (!total) {
    return `<div class="empty"><h2>Nothing on the board yet</h2>
      <p>${esc(s.backlogNote || (s.noAdo ? 'Add an idea or a request. Ideas waiting in Runway, and requests you capture on Home with s, show here too.' : 'Add an idea or a request, or set your team\'s area paths in Settings, People and teams, so Slate can list your ADO backlog. Ideas waiting in Runway show here too.'))}</p>
      ${btn('new-idea', 'New idea')}${btn('new', 'New request', { primary: true })}</div>`;
  }
  // Empty columns take a narrow strip so the full ones get the width; each still takes drops.
  const tracks = BOARD_COLUMNS.map(d => (columns[d.key] || []).length ? 'minmax(13.75rem,1fr)' : 'minmax(8.5rem,.45fr)').join(' ');
  const minW = BOARD_COLUMNS.reduce((n, d) => n + ((columns[d.key] || []).length ? 13.75 : 8.5), 0);
  return `<div class="board" style="--cols:${BOARD_COLUMNS.length};grid-template-columns:${tracks};min-width:${minW}rem">${BOARD_COLUMNS.map(d => {
    const list = columns[d.key] || [];
    const body = d.key === 'done' ? resolvedGroups(list, s) : `<ul>${list.map(c => card(c, s)).join('')}</ul>`;
    const hint = s.noAdo && NO_ADO_HINT[d.key] || d.hint;
    return `<section class="col${list.length ? '' : ' empty-col'}" aria-label="${esc(d.title)}" data-col="${esc(d.key)}"><header><h2>${esc(d.title)}${hint && globalThis.WorkshopTheme?.hints ? globalThis.WorkshopTheme?.hints.html('slate.' + d.key + (s.noAdo && NO_ADO_HINT[d.key] ? '-local' : ''), hint, 'About ' + d.title) : ''}</h2><span class="count">${list.length}</span></header>
      ${body}</section>`;
  }).join('')}</div>`;
}

/** The Resolved column: one group per area path, each with its count, Copy release notes and Close as released. */
function resolvedGroups(list, s) {
  if (!list.length) return '<ul></ul>';
  return releaseGroups(list).map(g => {
    const key = g.area.toLowerCase();
    const linked = g.items.filter(it => it.ado).length;
    return `<div class="rgroup"><div class="rhead"><span class="rarea" title="${esc(g.area || 'No area path')}">${esc(g.area ? g.area.split('\\').pop() : g.label)}</span><span class="count">${g.items.length}</span></div>
      <div class="racts">${btn('copy-notes', 'Copy release notes', { extra: ` data-area="${esc(key)}"`, title: 'Titles, ADO links and release notes, as Markdown' })}${linked ? btn('close-group', 'Close as released', { out: 'ado', extra: ` data-area="${esc(key)}"`, title: `Close the ${linked} ADO item${linked === 1 ? '' : 's'} here, after a confirm` }) : ''}</div>
      <ul>${g.items.map(c => card(c, s)).join('')}</ul></div>`;
  }).join('');
}

/* ---------- item panel ---------- */

const section = (title, body) => body ? `<section class="ps"><h3>${esc(title)}</h3>${body}</section>` : '';

function triageSection(t) {
  if (!t) return '';
  return section('Triage', `${t.summary ? `<p>${esc(t.summary)}</p>` : ''}
    <dl class="kv">${t.route ? `<dt>Suggested route</dt><dd>${esc(t.route === 'delegate' ? 'Delegate' : t.route === 'myself' ? 'Do it myself' : 'Undecided')}</dd>` : ''}${t.size ? `<dt>Size</dt><dd>${esc(t.size)}</dd>` : ''}</dl>
    ${t.repos.length ? `<p class="lbl">Products and repos</p><ul>${t.repos.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
    ${t.questions.length ? `<p class="lbl">Questions for the requester</p><ol class="qs">${t.questions.map(q => `<li>${esc(q)}</li>`).join('')}</ol>` : '<p class="soft">Nothing is missing.</p>'}`);
}

function draftSection(p) {
  const d = p.draft;
  if (!d.kind) return '';
  const file = p.files[d.file];
  if (p.editing) {
    return section(`Draft: ${d.file}`, `<label class="sr" for="draft">${esc(d.file)}</label><textarea id="draft" class="draft" spellcheck="true">${esc(file || '')}</textarea>
      <div class="acts">${btn('save-draft', 'Save', { primary: true })}${btn('cancel-edit', 'Cancel')}</div>`);
  }
  let body = '';
  if (d.kind === 'refine' && file) {
    const r = parseRefine(file);
    body = `<p class="lbl">Description</p><pre class="txt">${esc(r.description)}</pre><p class="lbl">Acceptance criteria</p><pre class="txt">${esc(r.acceptance)}</pre>
      ${r.open.length ? `<p class="lbl warn">Open questions</p><ul>${r.open.map(q => `<li>${esc(q)}</li>`).join('')}</ul>` : ''}`;
  } else if (file) {
    body = `<pre class="txt">${esc(file.length > 6000 ? file.slice(0, 6000) + '\n…' : file)}</pre>`;
  } else body = `<p class="soft">${d.manual ? 'Nothing written yet. Edit to start.' : 'The agent has not written it yet.'}</p>`;
  return section(`${d.manual ? 'Your draft' : 'Draft'}: ${d.file}${d.status ? ` (${d.status.toLowerCase()})` : ''}`, `${body}${file || d.manual ? `<div class="acts">${btn('edit-draft', 'Edit')}</div>` : ''}`);
}

/** The interview's running picture (understanding.md), with Edit. */
function understandingSection(p) {
  const text = p.files['understanding.md'];
  if (p.shapeEditing === 'understanding.md') {
    return section('What the agent understands', `<label class="sr" for="shapeEdit">understanding.md</label><textarea id="shapeEdit" class="draft" spellcheck="true">${esc(text || '')}</textarea>
      <p class="soft small">Your lines win: the agent keeps them in the next round.</p>
      <div class="acts">${btn('save-shape-file', 'Save', { primary: true })}${btn('cancel-edit', 'Cancel')}</div>`);
  }
  if (!text) return '';
  return section('What the agent understands', `<pre class="txt">${esc(text.length > 6000 ? text.slice(0, 6000) + '\n…' : text)}</pre><div class="acts">${btn('edit-understanding', 'Edit')}</div>`);
}

/** The brief (brief.md), with Edit. */
function briefSection(p) {
  const text = p.files['brief.md'];
  if (p.shapeEditing === 'brief.md') {
    return section('Brief', `<label class="sr" for="shapeEdit">brief.md</label><textarea id="shapeEdit" class="draft" spellcheck="true">${esc(text || '')}</textarea>
      <div class="acts">${btn('save-shape-file', 'Save', { primary: true })}${btn('cancel-edit', 'Cancel')}</div>`);
  }
  if (!text) return '';
  const b = parseBrief(text);
  const kv = [['Product', b.product], ['Level', b.level ? LEVEL_NAME[b.level] : ''], ['Size', b.size]].filter(([, v]) => v);
  return section('Brief', `${kv.length ? `<dl class="kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
    <pre class="txt">${esc(text.length > 8000 ? text.slice(0, 8000) + '\n…' : text)}</pre><div class="acts">${btn('edit-brief', 'Edit')}</div>`);
}

/** A round of interview questions as a form: an option, Other with text, or Skip, per question, and notes. */
function interviewForm(q) {
  const qs = q.questions.map(x => {
    const name = `qa-${x.n}`;
    const opts = x.options.map(o => `<label class="opt"><input type="radio" name="${name}" value="${esc(o.key)}"${o.key === x.recommended ? ' data-rec' : ''}> <span><b>${esc(o.key)})</b> ${esc(o.text)}${o.key === x.recommended ? ' <span class="chip soft">Recommended</span>' : ''}</span></label>`).join('');
    return `<fieldset class="iq" data-q="${x.n}"><legend>Q${x.n}. ${esc(x.text)}</legend>${opts}
      <label class="opt"><input type="radio" name="${name}" value="other"> <span>Other</span></label>
      <label class="sr" for="qo-${x.n}">Your answer to Q${x.n}</label><input id="qo-${x.n}" class="qo" data-other="${x.n}" placeholder="Your own answer, or a note on the option" maxlength="2000" autocomplete="off">
      <label class="opt"><input type="radio" name="${name}" value="skip"> <span>Skip</span></label>
      ${x.why ? `<p class="soft small">Why ${x.recommended ? `${esc(x.recommended)}` : 'this'}: ${esc(x.why)}</p>` : ''}</fieldset>`;
  }).join('');
  return `<div class="interview" id="interview">${qs}
    <label class="lbl" for="qnotes">Anything else the agent should know</label><textarea id="qnotes" class="answers" rows="3" maxlength="8000"></textarea>
    <div class="acts">${btn('send-answers', 'Send answers', { primary: true })}${btn('use-recommended', 'Use the recommendations')}${btn('write-brief', 'Write the brief now', { primary: (q.round || 1) >= 4 })}</div></div>`;
}

/* ---------- the ADO section of the panel ---------- */

const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
const empty = (field) => `<p class="soft small">Empty in ADO${field ? ` (<span class="mono">${esc(field)}</span>)` : ''}.</p>`;

function linksHtml(l) {
  const out = [];
  for (const i of l.items || []) {
    const u = safeUrl(i.url);
    const text = `${i.name ? `${i.name}: ` : ''}#${i.id}${i.title ? ` ${i.title}` : ''}`;
    out.push(`<li>${u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : esc(text)}${i.type || i.state ? ` <span class="soft small">${esc([i.type, i.state].filter(Boolean).join(', '))}</span>` : ''}</li>`);
  }
  for (const h of l.hyperlinks || []) { const u = safeUrl(h.url); if (u) out.push(`<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(h.comment || u)}</a></li>`); }
  for (const a of l.attachments || []) { const u = safeUrl(a.url); out.push(`<li>${u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(a.name)}</a>` : esc(a.name)} <span class="soft small">attachment</span></li>`); }
  if (l.pullRequests) out.push(`<li>${l.pullRequests} pull request${l.pullRequests === 1 ? '' : 's'}</li>`);
  return out.length ? `<ul class="links-list">${out.join('')}</ul>` : '<p class="soft small">No links.</p>';
}

function commentsHtml(count, d) {
  if (d.comments) {
    if (!d.comments.length) return '<p class="soft small">No comments.</p>';
    return `<ol class="comments">${d.comments.map(c => `<li><p class="soft small">${esc((c.by && c.by.name) || 'Someone')}${c.date ? `, ${esc(String(c.date).slice(0, 10))}` : ''}${c.edited ? ' (edited)' : ''}</p><pre class="txt">${esc(c.text)}</pre></li>`).join('')}</ol>`;
  }
  const n = count == null ? 'Comments' : count === 0 ? 'No comments' : `${count} comment${count === 1 ? '' : 's'}`;
  return `<p class="small">${n}.${count !== 0 ? ` ${btn('comments', d.commentsLoading ? 'Loading…' : 'Show comments', { extra: d.commentsLoading ? ' disabled' : '' })}` : ''}</p>${d.commentsError ? `<p class="bad small">${esc(d.commentsError)}</p>` : ''}`;
}

/** Assigned to, state, iteration, area and tags, then the level's fields from Fields settings. */
function adoSection(it, d, prefs) {
  if (!it.ado) return '';
  const now = it.adoNow || {};
  const w = d && d.data;
  const assignee = (w && w.assignee) || now.assignee;
  const tags = w ? String(w.tags || '').split(';').map(t => t.trim()).filter(Boolean) : (now.tags || []);
  const kv = [
    ['State', (w && w.state) || now.state || it.ado.state],
    ['Assigned to', assignee && assignee.name ? assignee.name : 'Unassigned'],
    ['Iteration', (w && w.iteration) || now.iteration],
    ['Area path', (w && w.area) || now.area || it.ado.area]
  ];
  const rows = w ? detailRows(w, it.level, prefs) : [];
  const values = rows.filter(r => r.kind === 'value');
  let body = `<dl class="kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v ? esc(v) : '<span class="soft">None</span>'}</dd>`).join('')}
    ${values.map(r => `<dt>${esc(r.label)}</dt><dd>${r.value ? esc(r.value) : '<span class="soft">Empty</span>'}</dd>`).join('')}
    <dt>Tags</dt><dd>${tags.length ? tags.map(t => chip(t, 'tag')).join(' ') : '<span class="soft">None</span>'}</dd></dl>`;
  if (!d || d.loading) body += '<p class="soft small">Reading the item from ADO…</p>';
  if (d && d.error) body += `<p class="bad small">${esc(d.error)}</p>`;
  for (const r of rows) {
    if (r.kind === 'value') continue;
    body += `<p class="lbl">${esc(r.label)}</p>`;
    if (r.kind === 'text') body += r.value ? `<pre class="txt">${esc(r.value)}</pre>` : empty(r.field);
    else if (r.kind === 'links') body += linksHtml(r.value);
    else if (r.kind === 'comments') body += commentsHtml(r.value, d);
  }
  return section('Azure DevOps', body);
}

/* ---------- what the agent is asking, answered in the panel (opencode connector `answer` and `reply`) ---------- */

function permHtml(p) {
  const what = p.title || (p.patterns || []).join(', ');
  const always = (p.always || []).length ? ` (${(p.always || []).join(', ')})` : '';
  return `<div class="ask"><p class="ask-q">Allow <strong>${esc(p.permission)}</strong>${what ? `: <code>${esc(what)}</code>` : ''}</p>
    <div class="acts">${btn('perm', 'Allow once', { primary: true, extra: ` data-perm="${esc(p.id)}" data-answer="once"` })}${btn('perm', 'Always allow', { extra: ` data-perm="${esc(p.id)}" data-answer="always"`, title: `Stop asking for this in this session${always}` })}${btn('perm', 'Reject', { extra: ` data-perm="${esc(p.id)}" data-answer="reject"` })}</div></div>`;
}

function questionHtml(q, ui) {
  const picks = (ui.picks || {})[q.id] || {};
  let out = `<div class="ask" data-qform="${esc(q.id)}">`;
  (q.questions || []).forEach((qq, i) => {
    const chosen = picks[i] || [];
    const typedKey = `q:${q.id}:${i}`;
    out += `${qq.header ? `<p class="q-h">${esc(qq.header)}</p>` : ''}<p class="ask-q">${esc(qq.question)}</p><div class="opts">`;
    for (const o of qq.options || []) {
      out += `<label class="opt"><input type="${qq.multiple ? 'checkbox' : 'radio'}" name="${esc(`${q.id}-${i}`)}" value="${esc(o.label)}" data-qpick="${esc(q.id)}" data-qi="${i}"${chosen.includes(o.label) ? ' checked' : ''}>
        <span>${esc(o.label)}${o.description ? ` <span class="soft small">${esc(o.description)}</span>` : ''}</span></label>`;
    }
    if (qq.custom !== false) out += `<label class="sr" for="${esc(`qa-${q.id}-${i}`)}">Your own answer</label><input type="text" id="${esc(`qa-${q.id}-${i}`)}" class="qtype" placeholder="${(qq.options || []).length ? 'Or type your own answer' : 'Your answer'}" data-draft="${esc(typedKey)}" value="${esc((ui.drafts || {})[typedKey] || '')}" autocomplete="off">`;
    out += '</div>';
  });
  return `${out}<div class="acts">${btn('qsend', 'Answer', { primary: true, extra: ` data-q="${esc(q.id)}"` })}${btn('qreject', 'Dismiss', { extra: ` data-q="${esc(q.id)}"`, title: 'Tell the agent you will not answer this one' })}</div></div>`;
}

/** Every prompt and question for the item, in the panel's "next" box. Open in Dispatch is in More. */
function asksHtml(p) {
  const a = p.asks;
  return `<div class="next asking"><p><span class="dot wait" aria-hidden="true"></span> The agent is asking you ${a.count === 1 ? 'something' : `${a.count} things`}. Answer here; it carries on right away.</p>
    ${a.permissions.map(permHtml).join('')}${a.questions.map(q => questionHtml(q, p.ui)).join('')}</div>`;
}

/** The item's current agent session: what it last said, and a reply box once it stops (for questions asked in plain text). */
function agentSection(p) {
  const ses = p.session;
  if (!ses || (!ses.text && !ses.error)) return '';
  const busy = !!(p.agent && p.agent.busy);
  const key = `r:${ses.id}`;
  const remembered = (p.ui.agentOpen || {})[ses.id];
  const open = remembered !== undefined ? remembered : p.asks.count || (!busy && /\?\s*$/.test(ses.text || '')) || ((p.ui.drafts || {})[key] || '').trim();
  const reply = busy || p.asks.count ? '' : `<label class="sr" for="${esc(`reply-${ses.id}`)}">Reply to the agent</label><textarea id="${esc(`reply-${ses.id}`)}" class="reply" rows="3" data-draft="${esc(key)}" placeholder="Reply to the agent. Ctrl+Enter sends.">${esc((p.ui.drafts || {})[key] || '')}</textarea>
    <div class="acts">${btn('reply', 'Send', { primary: true, extra: ` data-sid="${esc(ses.id)}"` })}</div>`;
  return `<details class="ps agent-box" data-sid="${esc(ses.id)}"${open ? ' open' : ''}><summary><h3>Agent${ses.command ? ` <span class="mono soft">${esc(ses.command)}</span>` : ''}</h3><span class="soft small">${busy ? 'Working' : ses.error ? 'Stopped' : 'Said'}</span></summary>
    ${ses.error ? `<p class="bad small">${esc(ses.error)}</p>` : ''}${ses.text ? `<pre class="txt say">${esc(ses.text)}</pre>` : ''}${reply}</details>`;
}

/* ---------- the next step: up to 3 buttons, the rest in More ---------- */

/** Most buttons a step shows in its "next" box. Everything else is in the panel's More menu. */
export const MAX_SHOWN = 3;

const step = (text, shown = [], more = [], extra = '') => ({ text, shown, more, extra });

/**
 * The step's next move: a sentence, the buttons shown (main one first, at most MAX_SHOWN), the buttons for More,
 * and any form that goes with it. Agent questions and the interview form take the box over.
 */
/* Buttons that start or talk to a Tandem agent. With the opencode connector off they stay visible, disabled, with
   the reason as their tooltip, so the step still says what comes next. */
export const AGENT_ACTS = new Set(['triage', 'shape', 'define', 'refine', 'scope', 'slice', 'approve', 'approve-publish', 'approve-build', 'revise', 'write-brief', 'keep-going', 'send-define', 'answers', 'myself', 'build-local', 'start', 'run-next', 'publish-build']);
const gate = (p, html) => {
  if (!p.tandemOff) return html;
  return html.map(h => {
    const m = /data-act="([^"]+)"/.exec(h);
    if (!m || !AGENT_ACTS.has(m[1]) || / disabled/.test(h)) return h;
    const tip = esc(`Needs Tandem: ${p.tandemOff}`);
    return h.replace(/ title="[^"]*"/, '').replace('<button ', `<button disabled title="${tip}" `);
  });
};

/** The chip on a card: the ADO work item type when there is one (Issue, User Story), else the level. */
export const typeLabel = (c) => (c && c.ado && c.ado.type) ? String(c.ado.type).slice(0, 30) : (LEVEL_NAME[c && c.level] || 'Story');

export function nextOf(p) {
  const n = nextRaw(p);
  if (!p.tandemOff || n.html) return n;
  const shown = gate(p, n.shown || []);
  const more = gate(p, n.more || []);
  const blocked = (n.shown || []).some(h => { const m = /data-act="([^"]+)"/.exec(h); return m && AGENT_ACTS.has(m[1]); });
  const text = blocked ? `${n.text} <span class="soft">Agent steps need Tandem, which is not set up here.${(n.more || []).some(h => /data-act="(write-myself|write-refine|write-scope)"/.test(h)) ? ' Write it myself (More) works without it.' : ''} Move to (More) still works.</span>` : n.text;
  return { ...n, text, shown, more };
}

function nextRaw(p) {
  const it = p.item;
  const a = p.agent;
  if (p.asks && p.asks.count) return { html: asksHtml(p), more: [btn('dispatch', 'Open the run', { title: 'See the whole session' })] };
  if (a && a.waiting) return step('The agent is asking you something.', [btn('dispatch', 'Answer it', { primary: true })]);
  if (a && a.busy) return step('The agent is working on it.', [btn('dispatch', 'Follow the run')]);
  if (p.dev) return devNext(p);
  const build = buildBtns(p);
  switch (p.column) {
    case 'new':
      // Without Dispatch: write the definition yourself, or send it straight on.
      if (p.tandemOff) return step(`${it.kind === 'idea' || it.fromRunway || it.runwayPending ? 'Your idea.' : 'A request.'} Write the story or stories yourself in Define, or send it straight to Who builds it?.`,
        [btn('write-myself', 'Write it myself', { primary: true }), btn('to-decide', 'Who builds it?')],
        [...(it.fromRunway ? [btn('dismiss', 'Hide from Slate', { title: 'Hides it here. It stays in Runway.' })] : [btn('roadmap-add', 'Add to roadmap')])]);
      if (it.kind === 'idea' || it.fromRunway || it.runwayPending) return step('Your idea. An agent interviews you, a round of questions at a time, until it is understood, then writes a brief.',
        [btn('shape', 'Shape it', { primary: true }), it.fromRunway ? btn('dismiss', 'Hide from Slate', { title: 'Hides it here. It stays in Runway.' }) : btn('roadmap-add', 'Add to roadmap')], build);
      return step('Start with a triage: an agent reads the request and the code, and says what is missing and who should build it. Or skip to an interview with you.',
        [btn('triage', 'Triage', { primary: true }), btn('shape', 'Interview me')],
        [btn('define', 'Define now', { title: 'Skip triage and start the draft' }), ...build, btn('roadmap-add', 'Add to roadmap')]);
    case 'triage':
      if (!p.triage) return step('Waiting for triage.md.', [btn('dispatch', 'Open the run')], build);
      if (p.triage.questions.length) {
        const q = `${p.triage.questions.length} question${p.triage.questions.length === 1 ? '' : 's'} for the requester.`;
        if (it.ado && p.canAdo) return step(`${q} Post them on #${it.ado.id} so whoever asked can answer there, or copy them to send another way.`,
          [btn('post-questions', `Post on #${it.ado.id}`, { primary: true, out: 'ado', title: 'Adds them as a comment on the ADO item, after you confirm' }), btn('ask', 'Copy questions and wait'), btn('define', 'Define')], [btn('shape', 'Interview me'), ...build]);
        return step(q, [btn('ask', 'Copy questions and wait', { primary: true }), btn('define', 'Define')], [btn('shape', 'Interview me'), ...build]);
      }
      return step(`Nothing is missing. Define it next, or dig in yourself first.${p.suggestScope && p.triage.size ? ` Triage sized it ${esc(p.triage.size)}, so Define scopes and slices it.` : ''}`, [btn('define', 'Define', { primary: true }), btn('shape', 'Interview me')], build);
    case 'interview': {
      const sh = p.shape || {};
      if (sh.asking) return { html: `<div class="next"><p>Round ${esc(sh.round || 1)}. Pick an answer for each question, write your own, or skip it. The agent asks again until it has enough.</p>${interviewForm(sh.q)}</div>`, more: build };
      if (sh.ready) return step('The brief is written.', [btn('to-brief', 'Read the brief', { primary: true })]);
      return step('Waiting for the agent\'s questions.', [btn('dispatch', 'Open the run'), btn('write-brief', 'Write the brief now')], build);
    }
    case 'brief': {
      const b = parseBrief(p.files['brief.md']);
      const to = b && (b.level === 'story' || b.level === 'bug') ? 'refine (one story)' : 'scope and slice';
      return step(b ? `Read the brief. Send to Define runs ${to} from it, asking only what it leaves open.` : 'Waiting for brief.md.',
        [...(b ? [btn('send-define', 'Send to Define', { primary: true })] : []), btn('keep-going', 'Keep going')], build,
        '<label class="lbl" for="bnotes">To keep going, say what to dig into (optional)</label><textarea id="bnotes" class="answers" rows="2" maxlength="8000"></textarea>');
    }
    case 'waiting': return step(it.asked && it.ado ? `The questions are on #${it.ado.id}. Read replies brings in comments posted since; check them, then triage again.` : 'Paste the requester\'s answers. Triage runs again with them.',
      [btn('answers', 'Save answers and triage again', { primary: true }), ...(it.asked && it.ado && p.canAdo ? [btn('read-replies', `Read replies from #${it.ado.id}`)] : []), btn('define', 'Define anyway')], [],
      `<label class="sr" for="answers">Answers</label><textarea id="answers" class="answers" placeholder="Their answers, in their words">${esc(p.files['answers.md'] || '')}</textarea>`);
    case 'define': {
      const d = p.draft;
      if (!d.kind) {
        const big = p.suggestScope !== undefined ? !!p.suggestScope : it.level === 'epic' || it.level === 'feature';
        const why = big && p.triage && (p.triage.size === 'L' || p.triage.size === 'XL') && it.level !== 'epic' && it.level !== 'feature' ? ` Triage sized it ${esc(p.triage.size)}: scope and slice is suggested.` : '';
        if (p.tandemOff) return step(`Write it yourself.${why} One story: a description and acceptance criteria. Bigger: an epic with features and stories.`,
          [btn('write-refine', 'Write one story', { primary: !big }), btn('write-scope', 'Write an epic with stories', { primary: big })]);
        return step(`Pick how to define it.${why}`, [btn('refine', 'One story: refine', { primary: !big }), btn('scope', 'Bigger: scope and slice', { primary: big })], [...build, btn('write-refine', 'Write one story myself'), btn('write-scope', 'Write an epic myself')]);
      }
      if (d.manual) {
        if (d.ready) return step(p.canAdo ? 'Your draft is approved.' : 'Your draft is approved. Without Azure DevOps it stays here in Slate.', [btn('to-decide', 'Who builds it?', { primary: true }), btn('unapprove-manual', 'Edit again')]);
        return step(`Your draft. Edit it until it is right, then approve it.${p.canAdo ? ' Approve and publish creates the ADO items (you confirm the list first).' : ''}`,
          p.canAdo ? [btn('approve-manual-publish', 'Approve and publish', { primary: true, out: 'ado' }), btn('edit-draft', 'Edit'), btn('approve-manual', 'Approve only')] : [btn('approve-manual', 'Approve', { primary: true }), btn('edit-draft', 'Edit')]);
      }
      if (d.step === 'approve' || d.step === 'approve-milestones') return step('Read the draft. Approve and publish creates the ADO items as soon as it is approved (you confirm the list first). Or edit it and ask the agent to revise.',
        [btn('approve-publish', 'Approve and publish', { primary: true, out: 'ado' }), btn('revise', 'Revise with my edits')], [btn('approve-build', 'Approve, publish and build it myself', { out: 'ado' }), btn('approve', 'Approve only')]);
      if (d.step === 'approve-stories') return step('Read the stories. Approve them, then slice them into build order. Or edit them and ask the agent to revise.', [btn('approve', 'Approve', { primary: true }), btn('revise', 'Revise with my edits')]);
      if (d.ready) return step('Back in Define, and the draft is still approved. Edit it and ask the agent to revise, or send it on as it is.', [btn('revise', 'Revise with my edits', { primary: true }), btn('keep', 'Keep it approved')]);
      if (d.step === 'slice') return step('Stories approved. Slice them into build order, mapped to the code.', [btn('slice', 'Slice into stories', { primary: true })]);
      return step('Waiting for the draft.', [btn('dispatch', 'Open the run')], build);
    }
    case 'publish':
      if (!p.canAdo) return step('Approved. Without Azure DevOps it stays here in Slate.', [btn('to-decide', 'Who builds it?', { primary: true })]);
      return step(`Approved, not in ADO yet. ${it.ado && p.draft.kind === 'refine' ? `Publish updates #${it.ado.id} with the description and acceptance criteria.` : 'Publish creates the work items.'}`,
      [btn('publish', 'Publish to ADO', { primary: true, out: 'ado' }), btn('publish-build', 'Publish and build it myself', { out: 'ado' })], it.ado ? [] : [btn('build-local', 'Build it myself, skip ADO')]);
    case 'decide': return step(`Who builds it?${p.owners && p.owners.length ? ` ${esc(p.owners[0].name)} owns ${esc(p.owners[0].hits.join(', '))}.` : ''}`,
      [btn('delegate', 'Delegate', { primary: p.item.route === 'delegate' }), decideBuild(p)]);
    case 'delegated': return step(`With ${esc(p.assigneeName || 'a teammate')}.${it.work.handoff ? ' The brief is in the handoff folder.' : ''}`,
      [btn('take-back', 'Take it back'), ...(it.ado ? [btn('ado', 'Open in ADO')] : [btn('mark-resolved', 'Mark resolved', { title: 'Done, waiting for a release' })])]);
    default: return step('');
  }
}

/** Build it myself, from Who builds it?. An approved draft not in ADO yet publishes first (main.js myself), so the
    button says so and carries the ADO mark; "skip ADO" never touches ADO. */
function decideBuild(p) {
  const it = p.item;
  const primary = it.route !== 'delegate';
  if (it.ado || !p.canAdo) return btn('myself', 'Build it myself', { primary, title: it.ado ? 'Starts Tandem on the ADO item' : 'Starts local work in Tandem' });
  if (p.draft && p.draft.ready) return btn('myself', 'Publish and build it myself', { primary, out: 'ado', title: 'Creates the ADO items after you confirm the list, then starts Tandem' });
  return btn('build-local', 'Build it myself, skip ADO', { primary, title: 'Starts local work in Tandem; link an ADO item later' });
}

/** Build it myself, as a skip ahead from Inbox, Shape and Define (in More). In ADO: Tandem on the item; else local work. */
function buildBtns(p) {
  const it = p.item;
  if (!p.canLocal && !it.ado) return [];
  if (it.ado) return [btn('myself', 'Build it myself', { title: `Skip ahead: start Tandem on #${it.ado.id} now` })];
  return [btn('build-local', 'Build it myself, skip ADO', { title: 'Skip ahead: start local work in Tandem now. Link an ADO item later; the PR needs one.' })];
}

/** In flight and Resolved, for work you build: Building (the Tandem run), Review and PR, Merged, Resolved, or closed. */
function devNext(p) {
  const it = p.item;
  const run = p.run;
  const n = (run && run.next) || {};
  const nextBtn = n.command && n.needsYou ? [btn('run-next', n.command.startsWith('/approve') ? 'Approve' : `Run ${n.command}`, { primary: true })] : [];
  const adoBtn = it.ado ? [btn('ado', 'Open in ADO')] : [];
  switch (p.column) {
    case 'done': return step('Closed. It is off the board; Health still counts it.', adoBtn);
    case 'resolved': return step(`Resolved: merged to main and waiting for a release, under ${esc(areaOf(it) || 'No area path')}. Close it as released when it ships, or close its whole area from the Resolved column.`,
      [...(it.ado ? [btn('close-one', 'Close as released', { primary: true, out: 'ado' })] : [btn('done', 'Mark closed', { primary: true })]), ...adoBtn]);
    case 'merged':
      if (!it.ado) return step(`${it.mergedHow === 'manual' ? 'Marked merged.' : 'Merged.'} Mark it resolved here, or link its ADO item below to resolve it there.`, [btn('mark-resolved', 'Mark resolved', { primary: true }), btn('unmerge', 'Not merged yet'), btn('done', 'Mark closed')]);
      return step(`${it.mergedHow === 'manual' ? 'Marked merged.' : 'Every linked pull request is merged.'} Mark it resolved: in main, waiting for the next release.`,
        [btn('mark-resolved', 'Mark resolved', { primary: true, out: 'ado', title: `Sets #${it.ado.id} to Resolved in Azure DevOps, after a confirm` }), btn('unmerge', 'Not merged yet')]);
    case 'review': {
      const prs = (it.prs && it.prs.list) || [];
      const done = prs.filter(x => x.status === 'completed').length;
      const text = !it.ado ? 'Link an ADO item below so Slate can follow the pull request, or mark it merged yourself.'
        : prs.length ? `${done} of ${prs.length} linked pull request${prs.length === 1 ? '' : 's'} merged. Slate checks again every 15 minutes.`
        : `${esc(n.text || 'Review the code, push and open the PR from the run.')} No pull request is linked to #${it.ado.id} yet.`;
      if (!it.ado) return step(text, [...nextBtn, btn('dispatch', 'Open the run', { primary: !nextBtn.length }), btn('mark-merged', 'Mark merged')]);
      return step(text, [...nextBtn, btn('dispatch', 'Open the run', { primary: !nextBtn.length }), btn('check-prs', 'Check pull requests')], [btn('mark-merged', 'Mark merged')]);
    }
    default: {
      if (!run && it.run) return step('Starting in Tandem. It shows here when its folder is ready.', [btn('dispatch', 'Open the run')]);
      if (!run) return step(it.ado ? 'Start runs Tandem on the ADO item: brief, spec, plan, then the build.' : 'Start runs Tandem as local work, from what Slate knows about it. Link an ADO item later; the PR needs one.',
        [btn('start', it.ado ? 'Start' : 'Start as local work', { primary: true })]);
      return step(esc(n.text || 'See where it is on the run.'), [...nextBtn, btn('dispatch', 'Open the run', { primary: !nextBtn.length })]);
    }
  }
}

function nextHtml(n) {
  if (n.html) return n.html;
  if (!n.text && !n.shown.length && !n.extra) return '';
  return `<div class="next"><p>${n.text}</p>${n.extra || ''}<div class="acts">${n.shown.slice(0, MAX_SHOWN).join('')}</div></div>`;
}

/** Link an ADO item to a card with none (In flight): the pull request needs one, and Merged and Resolved read it. */
function linkSection(p) {
  const it = p.item;
  if (it.ado || it.virtual || !p.dev || p.column === 'done') return '';
  return section('Azure DevOps', `<p class="small">No ADO item yet. The pull request needs one, and Slate reads Merged and Resolved from it.</p>
    <div class="acts"><label class="sr" for="linkAdo">Work item number</label><input id="linkAdo" class="link-in" inputmode="numeric" placeholder="12345" maxlength="11" autocomplete="off">${btn('link-ado', 'Link ADO item', { primary: true, extra: p.canAdo ? '' : ' disabled title="Turn on the Azure DevOps connector"' })}</div>`);
}

/** The whole journey, oldest first (model.js timeline). */
function timelineBody(p) {
  const rows = p.timeline || [];
  if (!rows.length) return '';
  const safe = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
  return `<ol class="hist">${rows.map(r => {
    const u = safe(r.url);
    const text = u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(r.text)}</a>` : r.run ? `<button type="button" class="linkish" data-act="dispatch">${esc(r.text)}</button>` : esc(r.text);
    return `<li>${r.at ? `<span class="mono">${esc(r.at)}</span> ` : ''}${text}</li>`;
  }).join('')}</ol>`;
}

/**
 * The More menu: the step's other buttons, then Move to (earlier stages and skip ahead, one list), Open in ADO,
 * Mark closed and Remove from Slate.
 */
function moreHtml(p, extra, shown) {
  const it = p.item;
  const items = [...extra];
  const has = (act) => [...shown, ...items].some(h => h.includes(`data-act="${act}"`));
  const back = p.back || [], fwd = p.forward || [];
  let move = '';
  if (back.length || fwd.length) {
    const running = !!(p.agent && p.agent.busy);
    const off = running ? ' disabled title="An agent is running on it. Move it when the run stops."' : '';
    const opts = (list) => list.map(st => `<option value="${esc(st)}">${esc(STAGE_TITLE[st] || st)}</option>`).join('');
    move = `<div class="move"><label for="backTo">Move to</label><select id="backTo"${off}>${fwd.length ? `<optgroup label="Skip ahead">${opts(fwd.slice().reverse())}</optgroup>` : ''}${back.length ? `<optgroup label="Move back">${opts(back.slice().reverse())}</optgroup>` : ''}</select>${btn('back', 'Move', { extra: off })}</div>`;
  }
  if (it.ado && !has('ado')) items.push(btn('ado', 'Open in ADO'));
  if (!it.virtual && it.stage !== 'done' && !has('done')) items.push(btn('done', 'Mark closed', { title: 'Off the board without changing ADO' }));
  if (!it.virtual) items.push(btn('remove', 'Remove from Slate'));
  if (!items.length && !move) return '';
  return `<details class="more"><summary class="btn">More</summary><div class="menu" role="group" aria-label="More">${items.join('')}${move}</div></details>`;
}

/** A section that folds. `open` is the default; `remembered` (from browser storage) wins when set. */
function fold(key, title, body, open, remembered) {
  if (!body) return '';
  const isOpen = remembered !== undefined ? remembered : open;
  return `<details class="ps fold" data-fold="${esc(key)}"${isOpen ? ' open' : ''}><summary><h3>${esc(title)}</h3></summary>${body}</details>`;
}

export function panelHtml(p) {
  const it = p.item;
  const links = [];
  if (it.ado) links.push(`<a href="${esc(it.ado.url)}" target="_blank" rel="noopener noreferrer">#${it.ado.id} in ADO</a>`);
  for (const [k, f] of Object.entries(it.work || {})) links.push(`<span class="mono" title="${esc(k)}">.work/${esc(f)}</span>`);
  const titleField = it.ado || it.virtual
    ? `<h2 class="ptitle">${esc(it.title)}</h2>`
    : `<label class="sr" for="ptitle">Title</label><input id="ptitle" class="ptitle-in" value="${esc(it.title)}" maxlength="255">`;
  const n = nextOf(p);
  const shown = n.shown || [];
  const folds = (p.ui && p.ui.folds) || {};
  const col = p.column;
  // The current step's file is open; earlier steps' files are there, closed.
  const files = [
    p.column === 'interview' || p.column === 'brief' || p.files['understanding.md'] ? wrapOpen(understandingSection(p), col === 'interview' || p.shapeEditing === 'understanding.md') : '',
    wrapOpen(briefSection(p), col === 'brief' || col === 'interview' || p.shapeEditing === 'brief.md'),
    wrapOpen(triageSection(p.triage), col === 'triage' || col === 'waiting' || col === 'new'),
    wrapOpen(draftSection(p), col === 'define' || col === 'publish' || p.editing)
  ].join('');
  const meta = [it.requester ? `Asked by ${esc(it.requester)}.` : '', p.age ? `${p.age} day${p.age === 1 ? '' : 's'} in this stage.` : ''].filter(Boolean).join(' ');
  const details = [
    meta ? `<p class="soft small meta-line">${meta}</p>` : '',
    adoSection(it, p.details, p.prefs),
    it.description ? section(it.ado ? 'Your notes' : it.kind === 'idea' || it.fromRunway ? 'Idea' : 'Request', `<pre class="txt">${esc(it.description)}</pre>`) : '',
    p.owners && p.owners.length && !p.dev ? section('Owners', `<ul>${p.owners.slice(0, 4).map(o => `<li>${esc(o.name)}: ${esc(o.hits.join(', '))}</li>`).join('')}</ul>`) : ''
  ].join('');
  return `<div class="phead">
      <div class="prow">${chip(typeLabel(it), `lv-${it.level}`)}${changedInAdo(it) ? chip('Changed in ADO', 'warn') : ''}<span class="grow"></span>${moreHtml(p, n.more || [], shown)}${btn('wide', p.wide ? 'Narrow' : 'Expand', { title: p.wide ? 'Give the board more room' : 'Give the panel more room', extra: ` aria-pressed="${p.wide}"` })}${btn('close', 'Close', { extra: ' aria-label="Close"' })}</div>
      ${titleField}
      ${links.length ? `<p class="links">${links.join(' · ')}</p>` : ''}
      ${!it.ado && !it.virtual ? `<label class="lvl-in">Level <select data-f="level">${LEVELS.map(l => `<option value="${l}"${it.level === l ? ' selected' : ''}>${LEVEL_NAME[l]}</option>`).join('')}</select></label>` : ''}
    </div>
    ${pickSection(p)}
    ${p.runHtml && p.column === 'building' ? '' : nextHtml(n)}
    ${p.error ? `<p class="bad">${esc(p.error)}</p>` : ''}
    ${runSection(p)}
    ${agentSection(p)}
    ${linkSection(p)}
    ${files}
    ${fold('details', 'Details', details, false, folds.details)}
    ${fold('timeline', 'Timeline', timelineBody(p), false, folds.timeline)}`;
}

/** Loom: the card's Tandem run, drawn by the runs half (p.runHtml: its step, file and buttons), and its full page. */
function runSection(p) {
  if (!p.runHtml) return '';
  return `<section class="ps run-in"><div class="run-h"><h3>Run</h3>${btn('dispatch', 'Open the run', { title: 'The whole run: every step, its files and activity' })}</div><div class="loom-run" data-folder="${esc(p.runFolder || '')}">${p.runHtml}</div></section>`;
}

/** Turn a plain section into a folding one, open or closed. */
function wrapOpen(html, open) {
  if (!html) return '';
  return html.replace(/^<section class="ps"><h3>([\s\S]*?)<\/h3>/, (m, h) => `<details class="ps fold"${open ? ' open' : ''}><summary><h3>${h}</h3></summary>`).replace(/<\/section>$/, '</details>');
}

/* ---------- dialogs ---------- */

export function newDialogHtml(names = []) {
  return `<form method="dialog" class="dlg" data-form="new"><h2>New request</h2>
    <label>Title<input name="title" required maxlength="255" autocomplete="off"></label>
    <label>Asked by<input name="requester" list="slatePeople" maxlength="200" autocomplete="off" placeholder="A name, a team, or a customer"></label>
    <datalist id="slatePeople">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    <label>What is being asked, and by whom<textarea name="description" rows="5" maxlength="32000"></textarea></label>
    <label>Level<select name="level">${LEVELS.map(l => `<option value="${l}"${l === 'story' ? ' selected' : ''}>${LEVEL_NAME[l]}</option>`).join('')}</select></label>
    <div class="acts">${btn('cancel', 'Cancel')}<button class="btn primary" type="submit" value="ok">Add</button></div></form>`;
}

export function newIdeaDialogHtml() {
  return `<form method="dialog" class="dlg" data-form="idea"><h2>New idea</h2>
    <p class="soft">Yours. An agent interviews you to shape it.</p>
    <label>Idea<input name="title" required maxlength="255" autocomplete="off" placeholder="A few words"></label>
    <label>What you have in mind so far<textarea name="description" rows="5" maxlength="32000"></textarea></label>
    <div class="acts">${btn('cancel', 'Cancel')}<button class="btn primary" type="submit" value="ok">Add</button></div></form>`;
}

export function publishDialogHtml(plan, { area, build = false, connection = '' }) {
  const label = (p) => p.op === 'create' ? 'Create' : p.op === 'update' ? `Update #${p.id}` : p.op === 'link' ? `Link #${p.id}` : `Done (#${p.id})`;
  const what = (p) => p.op === 'link' ? `${p.title}: a Related link to the new ${p.toType || 'item'} (${p.toTitle || ''}) and a comment saying where the work went. Slate then follows the new ${p.toType || 'item'}.` : p.title;
  const rows = plan.map(p => `<tr><td>${esc(label(p))}</td><td>${esc(p.type || '')}</td><td>${esc(what(p))}</td></tr>`).join('');
  const n = plan.filter(p => p.op !== 'skip').length;
  const withNote = plan.find(p => p.op === 'create' && p.fields && p.fields.custom);
  const rnKey = withNote ? Object.keys(withNote.fields.custom)[0] : '';
  return `<form method="dialog" class="dlg wide" data-form="publish"><h2>Publish to ADO</h2>
    ${outsideBanner('ado', `${n} change${n === 1 ? '' : 's'}${area ? `, in ${area}` : ''}${connection ? ` on the ${connection} connection` : ''}. Nothing is sent until you click Publish.`)}
    <p>Items are tagged <span class="mono">slate</span>.${rnKey ? ` Features carry their release note in <span class="mono">${esc(rnKey)}</span>.` : ''}</p>
    <table class="plan"><thead><tr><th>Change</th><th>Type</th><th>Title</th></tr></thead><tbody>${rows}</tbody></table>
    ${build ? '<p>Then it moves to In flight and Tandem starts on it (Build it myself).</p>' : ''}
    <div class="acts">${btn('cancel', 'Cancel')}<button class="btn primary" type="submit" value="ok" data-out-ok${n ? '' : ' disabled'}>${build ? 'Publish and build' : 'Publish'} ${outsideMark('ado')}</button></div></form>`;
}

export function delegateDialogHtml(people, { canBrief, canAssign, pick = '' }) {
  return `<form method="dialog" class="dlg" data-form="delegate"><h2>Delegate</h2>
    <label>To<select name="person" required><option value="">Pick someone</option>${people.map(p => `<option value="${esc(p.id)}"${p.id === pick ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    <p class="soft">Owners of what it touches come first (People, Owns).</p>
    ${people.length ? '' : '<p class="soft">Add your team in People first.</p>'}
    <label class="check"><input type="checkbox" name="brief"${canBrief ? ' checked' : ' disabled'}> Write a brief for them (an agent drafts it; nothing is posted)</label>
    <label class="check"><input type="checkbox" name="task" checked> Add a "waiting on" task in Docket</label>
    <label class="check"><input type="checkbox" name="assign"${canAssign ? '' : ' disabled'}> Also assign it to them in Azure DevOps ${outsideMark('ado')}</label>
    ${canAssign ? outsideBanner('ado', 'Delegate will set Assigned To on the ADO item. Everything else here stays on this computer.', { cls: 'when-assign' }) : ''}
    <div class="acts">${btn('cancel', 'Cancel')}<button class="btn primary" type="submit" value="ok">Delegate<span class="when-assign">and assign in ADO ${outsideMark('ado')}</span></button></div></form>`;
}

export function fieldsDialogHtml(prefs) {
  const box = (name, key, label, on) => `<label class="check"><input type="checkbox" name="${esc(name)}" value="${esc(key)}"${on ? ' checked' : ''}> ${esc(label)}</label>`;
  return `<form method="dialog" class="dlg wide fields" data-form="fields"><h2>Fields</h2>
    <p class="soft">Which Azure DevOps fields Slate shows. The panel always shows state, assigned to, iteration, area path and tags.</p>
    <fieldset><legend>On cards</legend><div class="checks">${CARD_FIELDS.map(f => box('card', f.key, f.label, prefs.card.includes(f.key))).join('')}</div></fieldset>
    <div class="levels">${LEVELS.map(l => `<fieldset><legend>${esc(LEVEL_NAME[l])} panel</legend>
      <div class="checks">${DETAIL_FIELDS.map(f => box(`detail-${l}`, f.key, f.label, prefs.detail[l].includes(f.key))).join('')}</div>
      <label>Custom fields<input name="custom-${l}" value="${esc(prefs.custom[l].join(', '))}" placeholder="Custom.Field, Other.Field" autocomplete="off" spellcheck="false"></label></fieldset>`).join('')}</div>
    <fieldset><legend>Field names in your ADO</legend>
      <label>Release notes field<input name="releaseNotesField" value="${esc(prefs.releaseNotesField)}" placeholder="Custom.ReleaseNotes" autocomplete="off" spellcheck="false"></label>
      <label>Story points fields, first one set wins<input name="pointsFields" value="${esc(prefs.pointsFields.join(', '))}" autocomplete="off" spellcheck="false"></label>
      <p class="soft small">Reference names, as ADO's process settings show them (for example <span class="mono">Microsoft.VSTS.Scheduling.StoryPoints</span>).</p></fieldset>
    <div class="acts"><button type="button" class="btn" data-reset>Defaults</button><span class="grow"></span>${btn('cancel', 'Cancel')}<button class="btn primary" type="submit" value="ok">Save</button></div></form>`;
}

/** The Fields form as settings (cleanPrefs cleans it). */
export function readFieldsForm(form) {
  const checked = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map(i => i.value);
  const out = { card: checked('card'), detail: {}, custom: {}, releaseNotesField: form.releaseNotesField.value.trim(), pointsFields: form.pointsFields.value };
  for (const l of LEVELS) { out.detail[l] = checked(`detail-${l}`); out.custom[l] = form[`custom-${l}`].value; }
  return out;
}

/** Link an ADO item: what was found, before it is saved on the card. */
export function linkAdoDialogHtml(w) {
  return `<form method="dialog" class="dlg" data-form="link"><h2>Link #${esc(w.id)}?</h2>
    <dl class="kv"><dt>Title</dt><dd>${esc(w.title)}</dd><dt>Type</dt><dd>${esc(w.type || 'Unknown')}</dd><dt>State</dt><dd>${esc(w.state || 'Unknown')}</dd><dt>Project</dt><dd>${esc(w.project || '')}</dd>${w.area ? `<dt>Area path</dt><dd>${esc(w.area)}</dd>` : ''}</dl>
    <p class="soft">Saved on the card only. Nothing changes in ADO.</p>
    <div class="acts">${btn('cancel', 'Cancel')}<button class="btn primary" type="submit" value="ok">Link it</button></div></form>`;
}

/** Link ADO item when the id is in more than one collection: pick which one. */
export function linkPickDialogHtml(id, matches) {
  const rows = matches.map((m, i) => `<label class="pick-row"><input type="radio" name="conn" value="${esc(m.connection)}"${i === 0 ? ' checked' : ''}>
    <span><strong>${esc(m.connection)}</strong>: ${esc(m.title)} <span class="soft">(${esc(m.type || 'Unknown')}, ${esc(m.project || 'no project')}${m.state ? `, ${esc(m.state)}` : ''})</span></span></label>`).join('');
  return `<form method="dialog" class="dlg" data-form="link-pick"><h2>Which #${esc(id)}?</h2>
    <p>Work item ids repeat across collections, and #${esc(id)} is in more than one of yours.</p>
    <div class="pick-list">${rows}</div>
    <p class="soft">Saved on the card only. Nothing changes in ADO.</p>
    <div class="acts">${btn('cancel', 'Cancel')}<button class="btn primary" type="submit" value="ok">Link it</button></div></form>`;
}

/** A card whose id is in more than one collection: a button per match, until you pick. */
function pickSection(p) {
  const it = p.item;
  const m = (it.ado && it.ado.choices) || [];
  if (m.length < 2) return '';
  return `<div class="next"><p>#${esc(it.ado.id)} is in more than one collection. Which one is it?</p>
    <div class="acts pick-acts">${m.map(x => btn('pick-conn', `${x.connection}: ${x.title || 'Untitled'}`, { extra: ` data-conn="${esc(x.connection)}"`, title: `${x.type || 'Item'} in ${x.project || 'its project'}${x.state ? `, ${x.state}` : ''}` })).join('')}</div></div>`;
}

/** Close as released: every ADO item that will be set to Closed. */
export function closeGroupDialogHtml(items, label) {
  return `<form method="dialog" class="dlg wide" data-form="close"><h2>Close as released?</h2>
    ${outsideBanner('ado', `Sets ${items.length === 1 ? 'this item' : `these ${items.length} items`} in ${label} to Closed, one at a time.`)}
    <p>${items.length === 1 ? 'It leaves' : 'They leave'} the board; Health still counts ${items.length === 1 ? 'it' : 'them'}.</p>
    <ul>${items.map(it => `<li>#${esc(it.ado.id)} ${esc(it.title)}</li>`).join('')}</ul>
    <div class="acts">${btn('cancel', 'Cancel')}<button class="btn primary" type="submit" value="ok" data-out-ok>Close ${items.length === 1 ? 'it' : `all ${items.length}`} ${outsideMark('ado')}</button></div></form>`;
}

export function confirmHtml(title, text, okLabel) {
  return `<form method="dialog" class="dlg" data-form="confirm"><h2>${esc(title)}</h2><p${String(text).includes('\n') ? ' class="pre-line"' : ''}>${esc(text)}</p>
    <div class="acts">${btn('cancel', 'Cancel')}<button class="btn primary" type="submit" value="ok">${esc(okLabel)}</button></div></form>`;
}

export function roadmapHtml(state) {
  if (state === 'off') return `<div class="empty"><h2>Runway is off</h2><p>The Roadmap tab shows Runway. Turn Runway on in Settings, Apps.</p></div>`;
  return `<iframe id="runway" class="runway" title="Roadmap (Runway)" src="../runway/index.html"></iframe>`;
}

