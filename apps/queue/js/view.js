/* Queue: the HTML. Pure functions with no DOM or SDK, so Node tests can import them. Every string from ADO
   or the person is escaped with esc(); ADO's rich text goes through sanitize() (sanitize.js). */
import { BUILT_IN_VIEWS, DEFAULT_TYPES, ago, assigneeKey, categoryOf, changedSinceSeen, esc, facets, isStale, leaf, meOf, projectOf, teamRows, viewCounts, visible } from './model.js';
import { sanitize } from './sanitize.js';

const opt = (value, label, sel) => `<option value="${esc(value)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Everything the list needs from the page state. */
export function listModel(v, ui, now) {
  const me = meOf(v.settings, v.snap.me);
  const ctx = { me, people: v.settings.people, currentIterations: v.snap.currentIterations };
  const saved = v.views.find(x => x.id === ui.view);
  const viewId = saved ? saved.base : ui.view;
  const filters = saved && !ui.filtersTouched ? saved.filters : ui.filters;
  const sort = saved && !ui.filtersTouched ? saved.sort : ui.sort;
  const rows = visible(v.items, { viewId, filters, sort, ctx, staleDays: v.settings.staleDays, now });
  return { me, ctx, viewId, filters, sort, rows, counts: viewCounts(v.items, ctx), changed: changedSinceSeen(v.items, v.seen), facets: facets(v.items) };
}

/** Shown instead of the queue when it cannot work yet. Returns '' when the queue can show. */
export function setupCard(v, embedded) {
  if (v.waiting) {
    return `<section class="engcard" role="status"><h2>Allow Workshop to use your folder to see the queue</h2>
      <p>${embedded ? 'Click <b>Allow</b> in the bar at the top of Workshop.' : 'Open Workshop and click <b>Allow</b> in the bar at the top.'} Chrome asks again after it restarts.</p></section>`;
  }
  if (v.newer) return `<section class="engcard"><h2>Saved by a newer Queue</h2><p>Update Workshop to use the queue here. Nothing was changed.</p></section>`;
  if (!v.items.length && v.ado.state === 'browser') {
    return `<section class="engcard"><h2>The queue needs Workshop on this computer</h2>
      <p>The queue reads your team's work from Azure DevOps through Workshop on this computer. Start Workshop, then click <b>Connect</b> on the rail.</p></section>`;
  }
  if (!v.items.length && v.ado.state === 'off') {
    return `<section class="engcard"><h2>Turn on the ADO connector</h2><p>${esc(v.ado.message)}</p>
      <p>In Settings, add your ADO connection and turn the connector on. The queue uses the same PAT as Docket's sync; changing items needs <b>Work Items (Read &amp; Write)</b>.</p>
      <p><button class="btn primary" data-open-app="settings">Open Settings</button></p></section>`;
  }
  if (!v.settings.areas.length) {
    return `<section class="engcard"><h2>Which area paths are your team's?</h2>
      <p>The queue shows open work items under the area paths you add, and lets you assign them to the people you list.</p>
      <p><button class="btn primary" data-route="settings">Set up the queue</button></p></section>`;
  }
  return '';
}

function statusLine(v, now) {
  const bits = [];
  if (v.refreshing) bits.push('Refreshing…');
  else if (v.snap.fetchedAt) bits.push(`Updated ${ago(v.snap.fetchedAt, now)}`);
  if (v.ado.state !== 'ready' && v.items.length) bits.push(v.ado.state === 'browser' ? 'Showing the last copy: Workshop on this computer is not connected' : `Showing the last copy: ${v.ado.message}`);
  if (v.snap.truncated) bits.push(`Showing the newest ${v.items.length} of ${v.snap.total}`);
  return `<p class="status${v.refreshError ? ' bad' : ''}" role="status">${esc(bits.join(' · '))}${v.refreshError ? ` <span>${esc(v.refreshError)}</span>` : ''}</p>`;
}

function tabs(v, ui, m) {
  const builtIn = BUILT_IN_VIEWS.map(b => `<button class="tab${ui.view === b.id ? ' on' : ''}" data-view="${b.id}" role="tab" aria-selected="${ui.view === b.id}">${esc(b.name)} <span class="num">${m.counts[b.id]}</span></button>`).join('');
  const saved = v.views.map(s => `<button class="tab saved${ui.view === s.id ? ' on' : ''}" data-view="${esc(s.id)}" role="tab" aria-selected="${ui.view === s.id}">${esc(s.name)}</button>`).join('');
  return `<nav class="tabs" role="tablist" aria-label="Views">${builtIn}${saved}</nav>`;
}

function filterBar(v, ui, m) {
  const f = m.filters;
  const sel = (name, label, values, cur) => `<label class="fl"><span class="sr">${label}</span><select name="${name}" data-filter="${name}">
    ${opt('', label, !cur)}${values.map(x => (typeof x === 'string' ? opt(x, x, cur === x) : opt(x.key, x.name, cur === x.key))).join('')}</select></label>`;
  const saved = v.views.find(x => x.id === ui.view);
  return `<div class="filters">
    <label class="fl q"><span class="sr">Search</span><input type="search" data-filter="q" placeholder="Filter  /" value="${esc(f.q)}" autocomplete="off"></label>
    ${sel('type', 'Type', m.facets.types, f.type)}
    ${sel('state', 'State', m.facets.states, f.state)}
    ${sel('assignee', 'Assigned to', [{ key: '-', name: 'Unassigned' }, ...m.facets.assignees], f.assignee)}
    ${sel('priority', 'Priority', ['1', '2', '3', '4'], f.priority)}
    ${sel('tag', 'Tag', m.facets.tags, f.tag)}
    ${sel('area', 'Area', m.facets.areas, f.area)}
    <label class="chk"><input type="checkbox" data-filter="stale"${f.stale ? ' checked' : ''}> Stale</label>
    <label class="fl"><span class="sr">Sort</span><select data-sort>${[['changed', 'Last changed'], ['priority', 'Priority'], ['id', 'Newest'], ['state', 'State']].map(([k, l]) => opt(k, l, m.sort === k)).join('')}</select></label>
    <span class="grow"></span>
    ${ui.filtersTouched || saved ? `<button class="lnk" data-save-view>${saved ? 'Save view' : 'Save as view'}</button>` : ''}
    ${saved ? `<button class="lnk" data-delete-view="${esc(saved.id)}">Delete view</button>` : ''}
    ${ui.filtersTouched ? '<button class="lnk" data-clear-filters>Clear</button>' : ''}
  </div>`;
}

function teamTable(v, now) {
  if (!v.settings.people.length) return v.directory
    ? `<p class="soft team-note">No one is marked as on your team. Mark them in <button class="lnk" data-open-people>People in Settings</button> to see who has what.</p>`
    : `<p class="soft team-note">Add your people in <button class="lnk" data-route="settings">Queue settings</button> to see who has what.</p>`;
  const rows = teamRows(v.items, { people: v.settings.people, categories: v.snap.categories, staleDays: v.settings.staleDays, now });
  return `<table class="team"><thead><tr><th>Person</th><th class="n">Open</th><th class="n">In progress</th><th class="n">Stale</th><th>Last change</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><button class="lnk" data-person="${esc(r.key)}">${esc(r.label)}</button></td><td class="n num">${r.open}</td><td class="n num">${r.inProgress}</td>
      <td class="n num${r.stale ? ' warn' : ''}">${r.stale}</td><td class="soft">${esc(r.changed ? ago(r.changed, now) : '')}</td></tr>`).join('')}
  </tbody></table>`;
}

export function rowHtml(item, { selected, changed, stale, cat }) {
  const tags = item.tags.slice(0, 3).map(t => `<span class="tag">${esc(t)}</span>`).join('');
  return `<li><button class="row${selected ? ' on' : ''}" data-item="${item.id}" aria-current="${selected ? 'true' : 'false'}">
    <span class="pri p${item.priority ?? 0}" title="Priority ${esc(item.priority ?? 'none')}">${esc(item.priority ?? '·')}</span>
    <span class="main"><span class="tt">${changed ? '<span class="dot" title="Changed since you looked"></span>' : ''}${esc(item.title)}</span>
      <span class="meta"><span class="num">#${item.id}</span> · ${esc(item.type)} · <span class="st c-${esc(cat || 'none')}">${esc(item.state)}</span>${item.iteration ? ` · ${esc(leaf(item.iteration))}` : ''}${stale ? ' · <span class="warn">stale</span>' : ''} ${tags}</span></span>
    <span class="who">${item.assignee ? esc(item.assignee.name || item.assignee.email) : '<span class="soft">Unassigned</span>'}</span>
  </button></li>`;
}

/** The queue page: header, tabs, filters, team table, list. The detail pane is drawn separately. */
export function render(v, ui, now, embedded) {
  const setup = setupCard(v, embedded);
  const head = `<header class="qhead">
    <div><p class="eyebrow">Azure DevOps</p><h1 class="page-title">Queue</h1></div>
    <div class="acts">
      ${v.ado.state === 'ready' && v.settings.areas.length ? `<button class="btn" data-refresh${v.refreshing ? ' disabled' : ''}>Refresh</button><button class="btn primary" data-new>New item</button>` : ''}
      <button class="ibtn" data-route="settings" title="Queue settings" aria-label="Queue settings"><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 6h12M4 14h12"/><circle cx="8" cy="6" r="2" fill="var(--bg)"/><circle cx="12.5" cy="14" r="2" fill="var(--bg)"/></svg></button>
    </div></header>`;
  if (setup) return head + setup;
  const m = listModel(v, ui, now);
  const list = m.rows.length
    ? `<ul class="list" role="list">${m.rows.map(i => rowHtml(i, { selected: ui.selected === i.id, changed: m.changed.has(i.id), stale: isStale(i, v.settings.staleDays, now), cat: categoryOf(i, v.snap.categories) })).join('')}</ul>`
    : `<p class="soft empty">${v.items.length ? 'Nothing matches this view.' : 'No open items in your team\'s areas.'}</p>`;
  return head + statusLine(v, now) + tabs(v, ui, m) + filterBar(v, ui, m) + (m.viewId === 'team' ? teamTable(v, now) : '') +
    `<p class="count soft">${plural(m.rows.length, 'item')}</p>` + list;
}

/* ---------- detail pane ---------- */

function peopleOptions(v, item) {
  const me = meOf(v.settings, v.snap.me);
  const list = [...v.settings.people];
  if (me && me.email && !list.some(p => p.email === me.email)) list.unshift({ name: me.name || 'Me', email: me.email });
  if (item.assignee && !list.some(p => assigneeKey(p) === assigneeKey(item.assignee))) list.push({ name: item.assignee.name, email: item.assignee.email });
  return list;
}

/** Who to send to ADO for a person: "Name <email>" when both are known, else whichever is. */
export const identity = p => (p.email ? (p.name && p.name !== p.email ? `${p.name} <${p.email}>` : p.email) : p.name);

function editor(v, item, pending) {
  const types = v.snap.categories[item.type] ? Object.keys(v.snap.categories[item.type]) : [];
  const states = types.includes(item.state) ? types : [item.state, ...types];
  const iters = (v.snap.iterations[item.project] || []).filter(x => x.path !== item.project);
  const people = peopleOptions(v, item);
  const cur = item.assignee ? assigneeKey(item.assignee) : '';
  const busy = pending ? ' disabled' : '';
  return `<div class="edit" aria-label="Change this item">
    <label>State<select data-change="state"${busy}>${states.map(s => opt(s, s, s === item.state)).join('')}</select></label>
    <label>Assigned to<select data-change="assignedTo"${busy}>${opt('', 'Unassigned', !cur)}${people.map(p => `<option value="${esc(identity(p))}"${assigneeKey(p) === cur ? ' selected' : ''}>${esc(p.label || p.name || p.email)}</option>`).join('')}</select></label>
    <label>Priority<select data-change="priority"${busy}>${item.priority == null ? opt('', 'None', true) : ''}${[1, 2, 3, 4].map(n => opt(n, String(n), n === item.priority)).join('')}</select></label>
    <label>Sprint<select data-change="iteration"${busy}>${iters.some(x => x.path === item.iteration) ? '' : opt(item.iteration, leaf(item.iteration) || 'None', true)}${iters.map(x => opt(x.path, x.name + (x.current ? ' (current)' : ''), x.path === item.iteration)).join('')}</select></label>
    <div class="tags">${item.tags.map(t => `<span class="tag">${esc(t)}<button data-tag-remove="${esc(t)}" aria-label="Remove tag ${esc(t)}"${busy}>×</button></span>`).join('')}
      <form data-tag-add><input name="tag" maxlength="100" placeholder="Add tag" aria-label="Add tag"${busy}></form></div>
  </div>`;
}

function section(title, html) {
  return html && html.replace(/<[^>]+>/g, '').trim() ? `<section class="rich"><h3 class="section-label">${title}</h3><div class="body">${html}</div></section>` : '';
}

function historyHtml(h, now) {
  if (!h || !h.length) return '';
  return `<section><h3 class="section-label">History</h3><ol class="hist">${h.slice(0, 20).map(x => `<li><span class="soft">${esc(ago(x.date, now))} · ${esc(x.by ? x.by.name : '')}</span>
    ${x.changes.length ? x.changes.map(c => `<span>${esc(c.field)}: ${esc(c.from ?? 'none')} to ${esc(c.to ?? 'none')}</span>`).join('') : '<span>Created</span>'}</li>`).join('')}</ol></section>`;
}

/**
 * The detail pane. `d` is {item, details (workitem.get result) | null, loading, error, pending (a failed
 * write to retry) | null, note (plain-word message) | ''}.
 */
export function detail(v, d, now) {
  if (!d || !d.item) return '';
  const it = d.item;
  const x = d.details;
  const me = meOf(v.settings, v.snap.me);
  const mine = me && it.assignee && ((me.email && it.assignee.email === me.email) || it.assignee.name === me.name);
  const canWrite = v.ado.state === 'ready';
  return `<div class="dhead">
      <p class="eyebrow"><span class="num">#${it.id}</span> · ${esc(it.type)} · ${esc(it.project)}</p>
      <button class="ibtn" data-close aria-label="Close">×</button>
    </div>
    <h2 class="dtitle">${esc(it.title)}</h2>
    <p class="soft">${esc(leaf(it.area))} · changed ${esc(ago(it.changed, now))}</p>
    ${d.note ? `<p class="note" role="status">${esc(d.note)}</p>` : ''}
    ${d.pending ? `<p class="unsaved" role="alert">Not saved yet: ${esc(d.pending.error)} <button class="btn" data-retry>Retry</button> <button class="lnk" data-discard>Discard</button></p>` : ''}
    ${canWrite ? editor(v, it, d.pending) : '<p class="soft">Connect Workshop on this computer to change items.</p>'}
    <div class="dacts">
      ${canWrite && !mine && me ? `<button class="btn" data-assign-me title="Docket picks it up on its next sync">Assign to me (adds to Docket)</button>` : ''}
      ${canWrite && v.dispatch ? '<button class="btn" data-dispatch>Start in Dispatch</button>' : ''}
      <a class="btn" href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener noreferrer">Open in ADO</a>
    </div>
    ${d.loading ? '<p class="soft">Loading details…</p>' : ''}
    ${d.error ? `<p class="bad">${esc(d.error)}</p>` : ''}
    ${x ? section('Description', sanitize(x.html ? x.html.description : '')) + section('Acceptance criteria', sanitize(x.html ? x.html.acceptanceCriteria : '')) + section('Repro steps', sanitize(x.html ? x.html.reproSteps : '')) : ''}
    ${x && x.pullRequests && x.pullRequests.length ? `<section><h3 class="section-label">Pull requests</h3><p>${x.pullRequests.map(p => `<span class="num">PR ${esc(p.id)}</span>`).join(' · ')}</p></section>` : ''}
    ${x && x.related && x.related.length ? `<section><h3 class="section-label">Related</h3><ul class="rel">${x.related.map(r => `<li>${v.items.some(i => i.id === r.id) ? `<button class="lnk" data-item="${r.id}">#${r.id}</button>` : `<span class="num">#${esc(r.id)}</span>`} <span class="soft">${esc(r.name)}</span></li>`).join('')}</ul></section>` : ''}
    ${x ? `<section><h3 class="section-label">Comments</h3>${(x.comments || []).length ? `<ol class="comments">${x.comments.map(c => `<li><p class="soft">${esc(c.by ? c.by.name : '')} · ${esc(ago(c.date, now))}${c.edited ? ' · edited' : ''}</p><div class="body">${sanitize(c.html)}</div></li>`).join('')}</ol>` : '<p class="soft">No comments.</p>'}
      ${canWrite ? `<form class="cbox" data-comment><textarea name="text" rows="3" maxlength="20000" placeholder="Write a comment" aria-label="Comment"></textarea><button class="btn primary">Comment</button></form>` : ''}</section>` : ''}
    ${x ? historyHtml(x.history, now) : ''}`;
}

/** Only http(s) URLs reach an href. */
export function safeUrl(u) {
  return /^https?:\/\//i.test(String(u || '')) ? String(u) : '#';
}

/* ---------- dialogs ---------- */

/** The confirm step before any write: what, where, and the change. */
export function confirmHtml({ title, item, connection, lines, action }) {
  return `<form method="dialog" class="confirm">
    <h2>${esc(title)}</h2>
    ${item ? `<p><span class="num">#${item.id}</span> ${esc(item.title)}</p><p class="soft">${esc(item.project)} · connection ${esc(connection || item.connection)}</p>` : `<p class="soft">Connection ${esc(connection)}</p>`}
    <ul class="lines">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
    <p class="soft">This changes the item in Azure DevOps.</p>
    <div class="acts"><button class="btn" value="cancel">Cancel</button><button class="btn primary" value="ok" autofocus>${esc(action)}</button></div>
  </form>`;
}

export function newItemHtml(v) {
  const types = v.settings.types.length ? v.settings.types : DEFAULT_TYPES;
  const area = v.settings.areas[0] || '';
  const iters = v.snap.iterations[projectOf(area)] || [];
  const people = peopleOptions(v, { assignee: null });
  return `<form method="dialog" class="newitem" data-new-form>
    <h2>New work item</h2>
    <label>Type<select name="type">${types.map(t => opt(t, t, t === 'Issue')).join('')}</select></label>
    <label>Title<input name="title" required maxlength="255" autocomplete="off"></label>
    <label>Description<textarea name="description" rows="5" maxlength="20000"></textarea></label>
    <div class="two">
      <label>Area<select name="area">${v.settings.areas.map(a => opt(a, a, a === area)).join('')}</select></label>
      <label>Sprint<select name="iteration">${opt('', 'None', false)}${iters.map(x => opt(x.path, x.name + (x.current ? ' (current)' : ''), x.current)).join('')}</select></label>
      <label>Priority<select name="priority">${opt('', 'None', false)}${[1, 2, 3, 4].map(n => opt(n, String(n), n === 2)).join('')}</select></label>
      <label>Assigned to<select name="assignedTo">${opt('', 'Unassigned', true)}${people.map(p => opt(identity(p), p.label || p.name || p.email, false)).join('')}</select></label>
    </div>
    <p class="soft">A bug's description goes in Repro Steps.</p>
    <div class="acts"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Continue</button></div>
  </form>`;
}

export function settingsHtml(v) {
  const s = v.settings;
  return `<form class="settings" data-settings>
    <header class="qhead"><div><p class="eyebrow">Queue</p><h1 class="page-title">Settings</h1></div><div class="acts"><button type="button" class="btn" data-route="">Back</button></div></header>
    <label>Area paths, one per line<textarea name="areas" rows="4" placeholder="Project\\Team">${esc(s.areas.join('\n'))}</textarea>
      <span class="soft">Open items under these paths are your team's queue.</span></label>
    ${v.directory
    ? `<div class="from-people"><p><b>People</b></p><p class="soft">Your team comes from <button type="button" class="lnk" data-open-people>People in Workshop Settings</button>: everyone marked as on your team, matched by their Azure DevOps email or name.${v.settings.people.length ? ` Now: ${esc(v.settings.people.map(p => p.label || p.name).join(', '))}.` : ''}</p></div>`
    : `<label>People, one per line<textarea name="people" rows="6" placeholder="Name <name@example.com>">${esc(s.people.map(p => (p.email ? `${p.name} <${p.email}>` : p.name)).join('\n'))}</textarea>
      <span class="soft">Who you assign work to, and the rows of the Team view. Use the email ADO shows for them. Or keep one list for all apps in People in Workshop Settings.</span></label>`}
    <label>Work item types, comma separated<input name="types" value="${esc(s.types.join(', '))}" placeholder="Issue, Bug, User Story"></label>
    <div class="two">
      <label>Refresh every (minutes)<input name="refreshMinutes" type="number" min="5" max="240" value="${s.refreshMinutes}"></label>
      <label>Stale after (days without a change)<input name="staleDays" type="number" min="1" max="90" value="${s.staleDays}"></label>
    </div>
    <div class="two">
      <label>ADO connection name<input name="connection" value="${esc(s.connection)}" placeholder="Same as Docket's sync"></label>
      <label>My email in ADO<input name="meEmail" value="${esc(s.meEmail)}" placeholder="${esc(v.snap.me && v.snap.me.email ? v.snap.me.email : 'Read from ADO')}"></label>
    </div>
    <p class="soft">Saved in your Workshop folder. Your PAT stays in its environment variable; changing items needs Work Items (Read &amp; Write).</p>
    <div class="acts"><button class="btn primary">Save</button></div>
  </form>`;
}

/** "Name <email>" lines to people. */
export function parsePeople(text) {
  return String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const m = /^(.*?)\s*<([^>]+)>\s*$/.exec(l);
    if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim().toLowerCase() };
    return /@/.test(l) ? { name: l, email: l.toLowerCase() } : { name: l, email: '' };
  });
}
