/* Slate: HTML for the board, the item panel and the dialogs. Pure: takes state, returns strings. Every value from
   data goes through esc(). Buttons carry data-act (and data-id); main.js handles the clicks. */
import { DEV_COLUMNS, LEVELS, LEVEL_NAME, PM_COLUMNS, changedInAdo, esc, parseRefine, parseTriage } from './model.js';

const chip = (text, cls = '') => `<span class="chip ${cls}">${esc(text)}</span>`;
const btn = (act, label, { id = '', primary = false, extra = '', title = '' } = {}) =>
  `<button type="button" class="btn${primary ? ' primary' : ''}" data-act="${esc(act)}"${id ? ` data-id="${esc(id)}"` : ''}${title ? ` title="${esc(title)}"` : ''}${extra}>${esc(label)}</button>`;

/* ---------- top bar ---------- */

export function topHtml(ui, notes) {
  const tab = (key, label) => `<button type="button" class="tab${ui.tab === key ? ' on' : ''}" role="tab" aria-selected="${ui.tab === key}" data-act="tab" data-id="${key}">${label}</button>`;
  const lane = (key, label) => `<button type="button" class="seg${ui.lane === key ? ' on' : ''}" aria-pressed="${ui.lane === key}" data-act="lane" data-id="${key}">${label}</button>`;
  const board = ui.tab === 'board';
  return `<div class="top">
    <div class="tabs" role="tablist" aria-label="Slate">${tab('board', 'Board')}${tab('roadmaps', 'Roadmaps')}${tab('sprints', 'Sprints')}${tab('health', 'Health')}</div>
    ${board ? `<div class="segs" role="group" aria-label="Lane">${lane('pm', 'PM')}${lane('dev', 'Dev')}</div>
    <label class="sr" for="q">Search</label><input id="q" class="q" type="search" placeholder="Search titles and #ids" value="${esc(ui.q)}" autocomplete="off">
    <label class="sr" for="lvl">Level</label><select id="lvl" class="lvl"><option value="">All levels</option>${LEVELS.map(l => `<option value="${l}"${ui.level === l ? ' selected' : ''}>${LEVEL_NAME[l]}</option>`).join('')}</select>
    <span class="grow"></span>
    ${btn('refresh', 'Refresh', { title: 'Read ADO and Tandem again' })}
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
  if (c.ado) meta.push(`#${c.ado.id}`);
  if (c.triage && c.triage.size) meta.push(`Size ${c.triage.size}`);
  if (c.route) meta.push(c.route === 'delegate' ? 'Delegate' : 'Myself');
  if (c.assigneeName) meta.push(c.assigneeName);
  if (c.requester) meta.push(`from ${c.requester}`);
  if (!c.virtual && c.age) meta.push(`${c.age}d`);
  const flags = [];
  if (c.stale) flags.push(chip('Stale', 'warn'));
  if (changedInAdo(c)) flags.push(chip('Changed in ADO', 'warn'));
  if (c.virtual) flags.push(chip('In ADO', 'soft'));
  return `<li><button type="button" class="card${s.open === c.id ? ' open' : ''}" data-act="open" data-id="${esc(c.id)}">
    <span class="row1">${chip(LEVEL_NAME[c.level] || 'Story', `lv-${c.level}`)}${flags.join('')}</span>
    <span class="title">${esc(c.title)}</span>
    <span class="meta">${esc(meta.join(' · '))}</span>
    ${c.agent ? `<span class="agent">${agentLine(c.agent)}</span>` : ''}
  </button></li>`;
}

export function boardHtml(columns, s) {
  const defs = s.lane === 'dev' ? DEV_COLUMNS : PM_COLUMNS;
  const total = defs.reduce((n, d) => n + (columns[d.key] || []).length, 0);
  if (!total) {
    return `<div class="empty"><h2>${s.lane === 'dev' ? 'Nothing to build yet' : 'No requests yet'}</h2>
      <p>${s.lane === 'dev' ? 'Items you choose to build yourself, and Tandem runs from Dispatch, show here.' : s.backlogNote || 'Add a request, or set your team\'s area paths in People so Slate can list your ADO backlog.'}</p>
      ${s.lane === 'pm' ? btn('new', 'New request', { primary: true }) : ''}</div>`;
  }
  return `<div class="board" style="--cols:${defs.length}">${defs.map(d => {
    const list = columns[d.key] || [];
    return `<section class="col" aria-label="${esc(d.title)}"><header><h2>${esc(d.title)}</h2><span class="count">${list.length}</span></header>
      <p class="hint">${esc(d.hint)}</p><ul>${list.map(c => card(c, s)).join('')}</ul></section>`;
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

/** The one thing to do next, as a sentence and buttons. */
function nextHtml(p) {
  const it = p.item;
  const a = p.agent;
  const out = (text, buttons) => `<div class="next"><p>${text}</p><div class="acts">${buttons.join('')}</div></div>`;
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
  switch (p.column) {
    case 'new': return out('Start with a triage: an agent reads the request and the code, and says what is missing and who should build it.', [
      btn('triage', 'Triage', { primary: true }), btn('define', 'Skip to define'), btn('roadmap-add', 'Add to roadmap')]);
    case 'triage': return p.triage ? out(p.triage.questions.length ? `${p.triage.questions.length} question${p.triage.questions.length === 1 ? '' : 's'} for the requester.` : 'Nothing is missing. Define it next.', [
      ...(p.triage.questions.length ? [btn('ask', 'Copy questions and wait', { primary: true })] : []), btn('define', 'Define', { primary: !p.triage.questions.length })])
      : out('Waiting for triage.md.', [btn('dispatch', 'Open in Dispatch')]);
    case 'waiting': return `<div class="next"><p>Paste the requester's answers. Triage runs again with them.</p>
      <label class="sr" for="answers">Answers</label><textarea id="answers" class="answers" placeholder="Their answers, in their words">${esc(p.files['answers.md'] || '')}</textarea>
      <div class="acts">${btn('answers', 'Save answers and triage again', { primary: true })}${btn('define', 'Define anyway')}</div></div>`;
    case 'define': {
      const d = p.draft;
      if (!d.kind) return out('Pick how to define it.', [btn('refine', 'One story: refine', { primary: it.level === 'story' || it.level === 'bug' }), btn('scope', 'Bigger: scope and slice', { primary: it.level === 'epic' || it.level === 'feature' })]);
      if (d.step === 'approve' || d.step === 'approve-stories' || d.step === 'approve-milestones') return out('Read the draft. Approve it, or edit it and ask the agent to revise.', [btn('approve', 'Approve', { primary: true }), btn('revise', 'Revise with my edits')]);
      if (d.step === 'slice') return out('Stories approved. Slice them into build order, mapped to the code.', [btn('slice', 'Slice into stories', { primary: true })]);
      return out('Waiting for the draft.', [btn('dispatch', 'Open in Dispatch')]);
    }
    case 'publish': return out(it.ado && p.draft.kind === 'refine' ? `Update #${it.ado.id} in ADO with the description and acceptance criteria.` : 'Create the work items in ADO.', [btn('publish', 'Publish to ADO', { primary: true })]);
    case 'decide': return out(`Who builds it?${p.owners && p.owners.length ? ` ${esc(p.owners[0].name)} owns ${esc(p.owners[0].hits.join(', '))}.` : ''}`, [btn('delegate', 'Delegate', { primary: p.item.route === 'delegate' }), btn('myself', 'Do it myself', { primary: p.item.route !== 'delegate' })]);
    case 'delegated': return out(`With ${esc(p.assigneeName || 'a teammate')}.${it.work.handoff ? ' The brief is in the handoff folder.' : ''}`, [btn('myself', 'Take it back'), ...(it.ado ? [btn('ado', 'Open in ADO')] : [])]);
    default: return '';
  }
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
      <div class="prow">${chip(LEVEL_NAME[it.level] || 'Story', `lv-${it.level}`)}${changedInAdo(it) ? chip('Changed in ADO', 'warn') : ''}<span class="grow"></span>${btn('close', 'Close', { extra: ' aria-label="Close"' })}</div>
      ${titleField}
      ${links.length ? `<p class="links">${links.join(' · ')}</p>` : ''}
      ${!it.ado && !it.virtual ? `<label class="lvl-in">Level <select data-f="level">${LEVELS.map(l => `<option value="${l}"${it.level === l ? ' selected' : ''}>${LEVEL_NAME[l]}</option>`).join('')}</select></label>` : ''}
    </div>
    ${nextHtml(p)}
    ${it.requester || p.age ? `<p class="soft small meta-line">${it.requester ? `Asked by ${esc(it.requester)}. ` : ''}${p.age ? `${p.age} day${p.age === 1 ? '' : 's'} in this stage.` : ''}</p>` : ''}
    ${it.description && !it.ado ? section('Request', `<pre class="txt">${esc(it.description)}</pre>`) : ''}
    ${p.owners && p.owners.length && p.lane === 'pm' ? section('Owners', `<ul>${p.owners.slice(0, 4).map(o => `<li>${esc(o.name)}: ${esc(o.hits.join(', '))}</li>`).join('')}</ul>`) : ''}
    ${triageSection(p.triage)}
    ${draftSection(p)}
    ${p.error ? `<p class="bad">${esc(p.error)}</p>` : ''}
    ${section('History', `<ol class="hist">${(it.history || []).slice().reverse().map(h => `<li><span class="mono">${esc(h.at)}</span> ${esc(h.stage)}</li>`).join('')}</ol>`)}
    ${!it.virtual ? `<div class="acts foot">${it.stage !== 'done' ? btn('done', 'Mark done') : ''}${btn('remove', 'Remove from Slate')}</div>` : ''}`;
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

export function confirmHtml(title, text, okLabel) {
  return `<form method="dialog" class="dlg" data-form="confirm"><h2>${esc(title)}</h2><p>${esc(text)}</p>
    <div class="acts">${btn('cancel', 'Cancel')}<button class="btn primary" type="submit" value="ok">${esc(okLabel)}</button></div></form>`;
}

export function roadmapHtml(state) {
  if (state === 'off') return `<div class="empty"><h2>Runway is off</h2><p>The Roadmap tab shows Runway. Turn Runway on in Settings, Apps.</p></div>`;
  return `<iframe id="runway" class="runway" title="Roadmap (Runway)" src="../runway/index.html"></iframe>`;
}

