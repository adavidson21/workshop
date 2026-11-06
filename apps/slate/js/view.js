/* Slate: HTML for the board, the item panel and the dialogs. Pure: takes state, returns strings. Every value from
   data goes through esc(). Buttons carry data-act (and data-id); main.js handles the clicks. */
import { CARD_FIELDS, DETAIL_FIELDS, DEV_COLUMNS, LEVELS, LEVEL_NAME, PM_COLUMNS, SHAPE_COLUMNS, SKIP_FROM, STAGE_TITLE, changedInAdo, detailRows, esc, parseBrief, parseRefine, parseTriage } from './model.js';

const chip = (text, cls = '') => `<span class="chip ${cls}">${esc(text)}</span>`;
const btn = (act, label, { id = '', primary = false, extra = '', title = '' } = {}) =>
  `<button type="button" class="btn${primary ? ' primary' : ''}" data-act="${esc(act)}"${id ? ` data-id="${esc(id)}"` : ''}${title ? ` title="${esc(title)}"` : ''}${extra}>${esc(label)}</button>`;

/* ---------- top bar ---------- */

export function topHtml(ui, notes, areas = []) {
  const tab = (key, label) => `<button type="button" class="tab${ui.tab === key ? ' on' : ''}" role="tab" aria-selected="${ui.tab === key}" data-act="tab" data-id="${key}">${label}</button>`;
  const lane = (key, label) => `<button type="button" class="seg${ui.lane === key ? ' on' : ''}" aria-pressed="${ui.lane === key}" data-act="lane" data-id="${key}">${label}</button>`;
  const board = ui.tab === 'board';
  return `<div class="top">
    <div class="tabs" role="tablist" aria-label="Slate">${tab('board', 'Board')}${tab('roadmaps', 'Roadmaps')}${tab('sprints', 'Sprints')}${tab('health', 'Health')}</div>
    ${board ? `<div class="segs" role="group" aria-label="Lane">${lane('shape', 'Shape')}${lane('pm', 'PM')}${lane('dev', 'Dev')}</div>
    <label class="sr" for="q">Search</label><input id="q" class="q" type="search" placeholder="Search titles and #ids" value="${esc(ui.q)}" autocomplete="off">
    <label class="sr" for="lvl">Level</label><select id="lvl" class="lvl"><option value="">All levels</option>${LEVELS.map(l => `<option value="${l}"${ui.level === l ? ' selected' : ''}>${LEVEL_NAME[l]}</option>`).join('')}</select>
    ${areas.length ? `<label class="sr" for="area">Area path</label><select id="area" class="area" title="Show one area path and everything under it"><option value="">All areas</option>${areas.map(a => `<option value="${esc(a.path)}"${ui.area === a.path ? ' selected' : ''}>${'\u00a0\u00a0'.repeat(a.depth)}${esc(a.label)} (${a.count})</option>`).join('')}</select>` : ''}
    <span class="grow"></span>
    ${btn('fields', 'Fields', { title: 'Which ADO fields cards and the panel show' })}
    ${btn('refresh', 'Refresh', { title: 'Read ADO and Tandem again' })}
    ${btn('new-idea', 'New idea', { title: 'Your own idea: an agent interviews you to shape it' })}
    ${btn('new', 'New request', { primary: true })}` : '<span class="grow"></span>'}
  </div>${notes.length ? `<div class="notes">${notes.map(n => `<p class="note">${esc(n)}</p>`).join('')}</div>` : ''}`;
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
  if (c.assigneeName) meta.push(c.assigneeName);
  if (c.requester) meta.push(`from ${c.requester}`);
  if (!c.virtual && c.age) meta.push(`${c.age}d`);
  const flags = [];
  if (c.stale) flags.push(chip('Stale', 'warn'));
  if (changedInAdo(c)) flags.push(chip('Changed in ADO', 'warn'));
  if (c.virtual && c.ado) flags.push(chip('In ADO', 'soft'));
  if (c.kind === 'idea' || c.fromRunway || c.runwayPending) flags.push(chip('Idea', 'soft'));
  if (c.skipped) flags.push(chip('Skipped shaping', 'soft'));
  return `<li><button type="button" class="card${s.open === c.id ? ' open' : ''}" data-act="open" data-id="${esc(c.id)}">
    <span class="row1">${chip(LEVEL_NAME[c.level] || 'Story', `lv-${c.level}`)}${flags.join('')}</span>
    <span class="title">${esc(c.title)}</span>
    <span class="meta">${esc(meta.join(' · '))}</span>
    ${c.facts && c.facts.facts.length ? `<span class="ado">${c.facts.facts.map(f => `<span class="f-${esc(f.key)}"${f.title ? ` title="${esc(f.title)}"` : ''}>${esc(f.text)}</span>`).join('')}</span>` : ''}
    ${c.facts && c.facts.tags.length ? `<span class="tags">${c.facts.tags.map(t => chip(t, 'tag')).join('')}</span>` : ''}
    ${c.agent ? `<span class="agent">${agentLine(c.agent)}</span>` : c.shapeAsking ? `<span class="agent"><span class="dot wait" aria-hidden="true"></span><span class="warn">Your turn: round ${esc(c.shapeRound || 1)}</span></span>` : ''}
  </button></li>`;
}

const EMPTY = {
  shape: ['Nothing to shape yet', 'Add an idea or a request, or set your team\'s area paths in People so Slate can list your ADO backlog. Ideas waiting in Runway show here too.'],
  pm: ['Nothing to define yet', 'Items move here from Shape when you send them to Define.'],
  dev: ['Nothing to build yet', 'Items you choose to build yourself, and Tandem runs from Dispatch, show here.']
};
export function boardHtml(columns, s) {
  const defs = s.lane === 'dev' ? DEV_COLUMNS : s.lane === 'pm' ? PM_COLUMNS : SHAPE_COLUMNS;
  const total = defs.reduce((n, d) => n + (columns[d.key] || []).length, 0);
  if (!total && s.filtered) {
    return `<div class="empty"><h2>Nothing here</h2><p>No cards in this lane match the area path, level or search you picked.</p></div>`;
  }
  if (!total) {
    const [h, p] = EMPTY[s.lane] || EMPTY.shape;
    return `<div class="empty"><h2>${h}</h2>
      <p>${esc(s.lane === 'shape' && s.backlogNote ? s.backlogNote : p)}</p>
      ${s.lane === 'shape' ? `${btn('new-idea', 'New idea')}${btn('new', 'New request', { primary: true })}` : ''}</div>`;
  }
  return `<div class="board" style="--cols:${defs.length}">${defs.map(d => {
    const list = columns[d.key] || [];
    return `<section class="col" aria-label="${esc(d.title)}"><header><h2>${esc(d.title)}${d.hint && globalThis.WorkshopTheme?.hints ? globalThis.WorkshopTheme?.hints.html('slate.' + d.key, d.hint, 'About ' + d.title) : ''}</h2><span class="count">${list.length}</span></header>
      <ul>${list.map(c => card(c, s)).join('')}</ul></section>`;
  }).join('')}</div>`;
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
  } else body = '<p class="soft">The agent has not written it yet.</p>';
  return section(`Draft: ${d.file}${d.status ? ` (${d.status.toLowerCase()})` : ''}`, `${body}${file ? `<div class="acts">${btn('edit-draft', 'Edit')}</div>` : ''}`);
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

/** Every prompt and question for the item, in the panel's "next" box. */
function asksHtml(p) {
  const a = p.asks;
  return `<div class="next asking"><p><span class="dot wait" aria-hidden="true"></span> The agent is asking you ${a.count === 1 ? 'something' : `${a.count} things`}. Answer here; it carries on right away.</p>
    ${a.permissions.map(permHtml).join('')}${a.questions.map(q => questionHtml(q, p.ui)).join('')}
    <div class="acts">${btn('dispatch', 'Open in Dispatch', { title: 'See the whole session' })}</div></div>`;
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

/** The one thing to do next, as a sentence and buttons. */
function nextHtml(p) {
  const it = p.item;
  const a = p.agent;
  const out = (text, buttons) => `<div class="next"><p>${text}</p><div class="acts">${buttons.join('')}</div></div>`;
  if (p.asks && p.asks.count) return asksHtml(p);
  if (a && a.waiting) return out('The agent is asking you something.', [btn('dispatch', 'Answer in Dispatch', { primary: true })]);
  if (a && a.busy) return out('The agent is working on it.', [btn('dispatch', 'Follow in Dispatch')]);
  if (p.lane === 'dev') {
    const run = p.run;
    if (!run) return out(it.ado ? 'Start runs Tandem on the ADO item: brief, spec, plan, then the build.' : 'Publish it to ADO first, or start it as local work in Dispatch.', [it.ado ? btn('start', 'Start', { primary: true }) : btn('dispatch', 'Open Dispatch')]);
    const n = run.next || {};
    const bs = [];
    if (n.command && n.needsYou) bs.push(btn('run-next', n.command.startsWith('/approve') ? 'Approve' : `Run ${n.command}`, { primary: true }));
    bs.push(btn('dispatch', 'Open in Dispatch', { primary: !bs.length }));
    return out(esc(n.text || 'See where it is in Dispatch.'), bs);
  }
  const skip = SKIP_FROM.includes(it.stage || 'new') ? [btn('skip', 'Already shaped: who builds it?', { title: 'Skip the rest of Shape and Define. Nothing changes in ADO.' })] : [];
  switch (p.column) {
    case 'new':
      if (it.kind === 'idea' || it.fromRunway || it.runwayPending) return out('Your idea. An agent interviews you, a round of questions at a time, until it is understood, then writes a brief.', [
        btn('shape', 'Shape it', { primary: true }), ...skip, ...(it.fromRunway ? [btn('dismiss', 'Hide from Slate', { title: 'Hides it here. It stays in Runway.' })] : [btn('roadmap-add', 'Add to roadmap')])]);
      return out('Start with a triage: an agent reads the request and the code, and says what is missing and who should build it. Or skip to an interview with you.', [
        btn('triage', 'Triage', { primary: true }), btn('shape', 'Interview me'), btn('define', 'Skip to define'), ...skip, btn('roadmap-add', 'Add to roadmap')]);
    case 'triage': return p.triage ? out(p.triage.questions.length ? `${p.triage.questions.length} question${p.triage.questions.length === 1 ? '' : 's'} for the requester.` : 'Nothing is missing. Define it next, or dig in yourself first.', [
      ...(p.triage.questions.length ? [btn('ask', 'Copy questions and wait', { primary: true })] : []), btn('define', 'Define', { primary: !p.triage.questions.length }), btn('shape', 'Interview me'), ...skip])
      : out('Waiting for triage.md.', [btn('dispatch', 'Open in Dispatch')]);
    case 'interview': {
      const sh = p.shape || {};
      if (sh.asking) return `<div class="next"><p>Round ${esc(sh.round || 1)}. Pick an answer for each question, write your own, or skip it. The agent asks again until it has enough.</p>${interviewForm(sh.q)}<div class="acts">${skip.join('')}</div></div>`;
      if (sh.ready) return out('The brief is written.', [btn('to-brief', 'Read the brief', { primary: true })]);
      return out('Waiting for the agent\'s questions.', [btn('dispatch', 'Open in Dispatch'), btn('write-brief', 'Write the brief now'), ...skip]);
    }
    case 'brief': {
      const b = parseBrief(p.files['brief.md']);
      const to = b && (b.level === 'story' || b.level === 'bug') ? 'refine (one story)' : 'scope and slice';
      return `<div class="next"><p>${b ? `Read the brief. Send to Define runs ${to} from it, asking only what it leaves open.` : 'Waiting for brief.md.'}</p>
        <label class="lbl" for="bnotes">To keep going, say what to dig into (optional)</label><textarea id="bnotes" class="answers" rows="2" maxlength="8000"></textarea>
        <div class="acts">${b ? btn('send-define', 'Send to Define', { primary: true }) : ''}${btn('keep-going', 'Keep going')}${skip.join('')}</div></div>`;
    }
    case 'waiting': return `<div class="next"><p>Paste the requester's answers. Triage runs again with them.</p>
      <label class="sr" for="answers">Answers</label><textarea id="answers" class="answers" placeholder="Their answers, in their words">${esc(p.files['answers.md'] || '')}</textarea>
      <div class="acts">${btn('answers', 'Save answers and triage again', { primary: true })}${btn('define', 'Define anyway')}</div></div>`;
    case 'define': {
      const d = p.draft;
      if (!d.kind) return out('Pick how to define it.', [btn('refine', 'One story: refine', { primary: it.level === 'story' || it.level === 'bug' }), btn('scope', 'Bigger: scope and slice', { primary: it.level === 'epic' || it.level === 'feature' }), ...skip]);
      if (d.step === 'approve' || d.step === 'approve-stories' || d.step === 'approve-milestones') return out('Read the draft. Approve it, or edit it and ask the agent to revise.', [btn('approve', 'Approve', { primary: true }), btn('revise', 'Revise with my edits')]);
      if (d.ready) return out('Back in Define, and the draft is still approved. Edit it and ask the agent to revise, or send it on as it is.', [btn('revise', 'Revise with my edits', { primary: true }), btn('keep', 'Keep it approved')]);
      if (d.step === 'slice') return out('Stories approved. Slice them into build order, mapped to the code.', [btn('slice', 'Slice into stories', { primary: true })]);
      return out('Waiting for the draft.', [btn('dispatch', 'Open in Dispatch'), ...skip]);
    }
    case 'publish': return out(it.ado && p.draft.kind === 'refine' ? `Update #${it.ado.id} in ADO with the description and acceptance criteria.` : 'Create the work items in ADO.', [btn('publish', 'Publish to ADO', { primary: true })]);
    case 'decide': return out(`Who builds it?${p.owners && p.owners.length ? ` ${esc(p.owners[0].name)} owns ${esc(p.owners[0].hits.join(', '))}.` : ''}`, [btn('delegate', 'Delegate', { primary: p.item.route === 'delegate' }), btn('myself', 'Do it myself', { primary: p.item.route !== 'delegate' })]);
    case 'delegated': return out(`With ${esc(p.assigneeName || 'a teammate')}.${it.work.handoff ? ' The brief is in the handoff folder.' : ''}`, [btn('myself', 'Take it back'), ...(it.ado ? [btn('ado', 'Open in ADO')] : [])]);
    default: return '';
  }
}

/** Move to: a select of earlier stages (Move back) and later ones (Skip ahead), and a button. Off while an agent
    is running on the item. */
function backHtml(p) {
  const back = p.back || [], fwd = p.forward || [];
  if (!back.length && !fwd.length) return '';
  const running = !!(p.agent && p.agent.busy);
  const off = running ? ' disabled title="An agent is running on it. Move it when the run stops."' : '';
  const opts = (list) => list.map(st => `<option value="${esc(st)}">${esc(STAGE_TITLE[st] || st)}</option>`).join('');
  return `<span class="back"><label class="sr" for="backTo">Move to</label><select id="backTo"${off}>${fwd.length ? `<optgroup label="Skip ahead">${opts(fwd.slice().reverse())}</optgroup>` : ''}${back.length ? `<optgroup label="Move back">${opts(back.slice().reverse())}</optgroup>` : ''}</select>${btn('back', 'Move', { extra: off })}</span>`;
}

export function panelHtml(p) {
  const it = p.item;
  const links = [];
  if (it.ado) links.push(`<a href="${esc(it.ado.url)}" target="_blank" rel="noopener noreferrer">#${it.ado.id} in ADO</a>`);
  for (const [k, f] of Object.entries(it.work || {})) links.push(`<span class="mono" title="${esc(k)}">.work/${esc(f)}</span>`);
  const titleField = it.ado || it.virtual
    ? `<h2 class="ptitle">${esc(it.title)}</h2>`
    : `<label class="sr" for="ptitle">Title</label><input id="ptitle" class="ptitle-in" value="${esc(it.title)}" maxlength="255">`;
  return `<div class="phead">
      <div class="prow">${chip(LEVEL_NAME[it.level] || 'Story', `lv-${it.level}`)}${changedInAdo(it) ? chip('Changed in ADO', 'warn') : ''}<span class="grow"></span>${btn('wide', p.wide ? 'Narrow' : 'Expand', { title: p.wide ? 'Give the board more room' : 'Give the panel more room', extra: ` aria-pressed="${p.wide}"` })}${btn('close', 'Close', { extra: ' aria-label="Close"' })}</div>
      ${titleField}
      ${links.length ? `<p class="links">${links.join(' · ')}</p>` : ''}
      ${!it.ado && !it.virtual ? `<label class="lvl-in">Level <select data-f="level">${LEVELS.map(l => `<option value="${l}"${it.level === l ? ' selected' : ''}>${LEVEL_NAME[l]}</option>`).join('')}</select></label>` : ''}
    </div>
    ${nextHtml(p)}
    ${agentSection(p)}
    ${it.requester || p.age ? `<p class="soft small meta-line">${it.requester ? `Asked by ${esc(it.requester)}. ` : ''}${p.age ? `${p.age} day${p.age === 1 ? '' : 's'} in this stage.` : ''}</p>` : ''}
    ${adoSection(it, p.details, p.prefs)}
    ${it.description && !it.ado ? section(it.kind === 'idea' || it.fromRunway ? 'Idea' : 'Request', `<pre class="txt">${esc(it.description)}</pre>`) : ''}
    ${p.column === 'interview' || p.column === 'brief' || p.files['understanding.md'] ? understandingSection(p) : ''}
    ${briefSection(p)}
    ${p.owners && p.owners.length && p.lane !== 'dev' ? section('Owners', `<ul>${p.owners.slice(0, 4).map(o => `<li>${esc(o.name)}: ${esc(o.hits.join(', '))}</li>`).join('')}</ul>`) : ''}
    ${triageSection(p.triage)}
    ${draftSection(p)}
    ${p.error ? `<p class="bad">${esc(p.error)}</p>` : ''}
    ${section('History', `<ol class="hist">${(it.history || []).slice().reverse().map(h => `<li><span class="mono">${esc(h.at)}</span> ${esc(STAGE_TITLE[h.stage] || h.stage)}${h.skipped ? ' (skipped shaping)' : ''}</li>`).join('')}</ol>`)}
    ${!it.virtual ? `<div class="acts foot">${backHtml(p)}${it.stage !== 'done' ? btn('done', 'Mark done') : ''}${btn('remove', 'Remove from Slate')}</div>` : ''}`;
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

export function publishDialogHtml(plan, { area }) {
  const rows = plan.map(p => `<tr><td>${esc(p.op === 'create' ? 'Create' : p.op === 'update' ? `Update #${p.id}` : `Done (#${p.id})`)}</td><td>${esc(p.type || '')}</td><td>${esc(p.title)}</td></tr>`).join('');
  const n = plan.filter(p => p.op !== 'skip').length;
  return `<form method="dialog" class="dlg wide" data-form="publish"><h2>Publish to ADO</h2>
    <p>${n} change${n === 1 ? '' : 's'} in Azure DevOps${area ? `, in ${esc(area)}` : ''}. Items are tagged <span class="mono">slate</span>. Nothing is sent until you click Publish.</p>
    <table class="plan"><thead><tr><th>Change</th><th>Type</th><th>Title</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="acts">${btn('cancel', 'Cancel')}<button class="btn primary" type="submit" value="ok"${n ? '' : ' disabled'}>Publish</button></div></form>`;
}

export function delegateDialogHtml(people, { canBrief, canAssign, pick = '' }) {
  return `<form method="dialog" class="dlg" data-form="delegate"><h2>Delegate</h2>
    <label>To<select name="person" required><option value="">Pick someone</option>${people.map(p => `<option value="${esc(p.id)}"${p.id === pick ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    <p class="soft">Owners of what it touches come first (People, Owns).</p>
    ${people.length ? '' : '<p class="soft">Add your team in People first.</p>'}
    <label class="check"><input type="checkbox" name="brief"${canBrief ? ' checked' : ' disabled'}> Write a brief for them (/handoff; posts nothing)</label>
    <label class="check"><input type="checkbox" name="assign"${canAssign ? ' checked' : ' disabled'}> Assign it to them in ADO</label>
    <label class="check"><input type="checkbox" name="task" checked> Add a "waiting on" task in Docket</label>
    <div class="acts">${btn('cancel', 'Cancel')}<button class="btn primary" type="submit" value="ok">Delegate</button></div></form>`;
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

export function confirmHtml(title, text, okLabel) {
  return `<form method="dialog" class="dlg" data-form="confirm"><h2>${esc(title)}</h2><p>${esc(text)}</p>
    <div class="acts">${btn('cancel', 'Cancel')}<button class="btn primary" type="submit" value="ok">${esc(okLabel)}</button></div></form>`;
}

export function roadmapHtml(state) {
  if (state === 'off') return `<div class="empty"><h2>Runway is off</h2><p>The Roadmap tab shows Runway. Turn Runway on in Settings, Apps.</p></div>`;
  return `<iframe id="runway" class="runway" title="Roadmap (Runway)" src="../runway/index.html"></iframe>`;
}

