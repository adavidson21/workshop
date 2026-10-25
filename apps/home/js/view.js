/* Home: the numbers and the HTML. Pure functions with no DOM or SDK, so Node tests can import them.
   Home reads other apps' data read-only (docs/sdk.md, ws.data.get with {app}). It does not import
   their code (docs/app-manifest.md, Rules), so the few Prioritizer rules it needs are repeated here
   and named after the function they mirror in apps/prioritizer/js/model.js. */

export const TASKS_VERSION = 3; // prioritizer.tasks: the version Home knows how to read
const WINDOW = { 4: 2, 3: 4, 2: 7, 1: 14 }; // implied due window in days, by value (Prioritizer's WINDOW)

const pad = n => String(n).padStart(2, '0');
export const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return dateStr(d); };
const daysBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / 864e5);
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// Prioritizer's isTriaged and isStale
const isTriaged = t => t.value != null && t.effort != null;
const isStale = (t, today) => !t.done && !t.due && !!t.value && isDate(t.ageFrom) && daysBetween(t.ageFrom, today) >= 2 * WINDOW[t.value];

/* Everything the page shows from Prioritizer's board. `tasks`, `lists` and `people` are the envelopes'
   items (or empty arrays). */
export function summarize({ tasks = [], lists = [], people = [] }, today) {
  const listName = new Map(lists.map(l => [l.id, l.name]));
  const known = new Set(lists.map(l => l.id));
  const all = tasks.filter(t => t && known.has(t.listId));
  const open = all.filter(t => !t.done);
  const weekEnd = addDays(today, 7);
  // Prioritizer's isFocus: on Today, and open or finished today
  const focus = all.filter(t => t.focusOn === today && (!t.done || (!t.wontDo && t.doneAt === today)));
  const upNext = open.filter(t => !t.waiting).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)).slice(0, 3)
    .map(t => ({ id: t.id, title: t.title, list: lists.length > 1 ? listName.get(t.listId) : '', due: isDate(t.due) ? t.due : null, people: Array.isArray(t.people) ? t.people : [] }));
  const names = people.map(p => p.name).filter(n => typeof n === 'string' && n.trim());
  const team = names.map(name => {
    const mine = open.filter(t => Array.isArray(t.people) && t.people.some(p => String(p).toLowerCase() === name.toLowerCase()));
    return { name, open: mine.length, waiting: mine.filter(t => t.waiting).length };
  }).sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
  return {
    total: all.length,
    open: open.length,
    focus: { total: focus.length, done: focus.filter(t => t.done).length },
    triage: open.filter(t => !isTriaged(t) || isStale(t, today)).length,
    overdue: open.filter(t => isDate(t.due) && t.due < today).length,
    dueWeek: open.filter(t => isDate(t.due) && t.due >= today && t.due <= weekEnd).length,
    upNext,
    team
  };
}

/* From the opencode connector's `state` result: prompts waiting for you, and sessions working. */
export function agentCounts(state) {
  const live = state && state.liveMode && state.liveMode.live;
  if (!live) return { needYou: 0, working: 0 };
  const needYou = (live.permissions || []).length + (live.questions || []).length;
  const working = Object.values(live.sessions || {}).filter(s => s && s.status && s.status !== 'idle').length;
  return { needYou, working };
}

export function greeting(now) {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

const fmtDue = (d, today) => {
  if (d === today) return 'Due today';
  const n = daysBetween(today, d);
  if (n === 1) return 'Due tomorrow';
  if (n < 0) return n === -1 ? 'Due yesterday' : `${-n} days overdue`;
  return 'Due ' + parseD(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

const tile = (n, label, sub, tone) => `<button class="tile${tone ? ' ' + tone : ''}" data-open="prioritizer">
  <span class="n num">${n}</span><span class="lbl">${label}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</button>`;

/* The whole page. `v` is {now, profile, board, boardNote, agents}:
   profile {name, role}; board = summarize() or null; boardNote = why there is no board (string) or '';
   agents = {state: 'ready' | 'off' | 'browser' | 'loading', needYou, working, message}. */
export function render(v) {
  const today = dateStr(v.now);
  const p = v.profile || {};
  const name = (p.name || '').trim(), role = (p.role || '').trim();
  const head = `<header class="hello">
    <div class="who">
      <h1>${greeting(v.now)}${name ? ', ' + esc(name.split(/\s+/)[0]) : ''}</h1>
      <p class="meta">${role ? esc(role) + ' · ' : ''}${v.now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
    </div>
    <button class="btn ghost" data-edit-profile>${name ? 'Edit profile' : 'Add your name'}</button>
  </header>`;

  if (!v.board) {
    return head + `<section class="card note"><h2>Prioritizer</h2><p>${esc(v.boardNote || 'Loading your board.')}</p></section>` + agentsCard(v.agents);
  }
  const b = v.board;
  if (!b.total) {
    return head + `<section class="card note"><h2>No tasks yet</h2><p>Add a few in Prioritizer and they show up here.</p>
      <p><button class="btn primary" data-open="prioritizer">Open Prioritizer</button></p></section>` + agentsCard(v.agents);
  }

  const tiles = `<section class="tiles" aria-label="Today at a glance">
    ${tile(b.focus.total ? `${b.focus.done}<small>/${b.focus.total}</small>` : '0', 'On Today', b.focus.total && b.focus.done === b.focus.total ? 'All done' : '', '')}
    ${tile(b.triage, 'To triage', '', b.triage ? 'warn' : '')}
    ${tile(b.overdue, 'Overdue', '', b.overdue ? 'danger' : '')}
    ${tile(b.dueWeek, 'Due this week', `${plural(b.open, 'open task')}`, '')}
  </section>`;

  const next = `<section class="card">
    <div class="ch"><h2>Up next</h2><button class="lnk" data-open="prioritizer">All tasks</button></div>
    ${b.upNext.length ? `<ol class="next">${b.upNext.map((t, i) => `<li><button class="nrow" data-task="${esc(t.id)}">
      <span class="rk num">${i + 1}</span><span class="tt">${esc(t.title)}</span>
      <span class="tm">${[t.due ? `<span class="${t.due < today ? 'late' : ''}">${fmtDue(t.due, today)}</span>` : '', t.list ? esc(t.list) : '', t.people.length ? esc(t.people.join(', ')) : ''].filter(Boolean).join(' · ')}</span>
    </button></li>`).join('')}</ol>` : `<p class="soft">Nothing open that isn't waiting on someone.</p>`}
  </section>`;

  const team = `<section class="card">
    <div class="ch"><h2>People</h2></div>
    ${b.team.length ? `<ul class="team">${b.team.slice(0, 8).map(m => `<li><span class="av" aria-hidden="true">${esc(m.name.trim()[0].toUpperCase())}</span><span class="nm">${esc(m.name)}</span>
      <span class="ct">${m.open ? `${m.open} open` : 'Nothing open'}${m.waiting ? ` · ${m.waiting} waiting` : ''}</span></li>`).join('')}</ul>`
      : `<p class="soft">Add people in Prioritizer to see who has what.</p>`}
  </section>`;

  return head + tiles + `<div class="cols">${next}<div class="stack">${team}${agentsCard(v.agents)}</div></div>`;
}

function agentsCard(a) {
  a = a || { state: 'loading' };
  let body;
  if (a.state === 'ready') {
    body = `<div class="pair">
      <button class="stat${a.needYou ? ' warn' : ''}" data-open="agents"><span class="n num">${a.needYou}</span><span class="lbl">Need you</span></button>
      <button class="stat" data-open="agents"><span class="n num">${a.working}</span><span class="lbl">Working</span></button></div>`;
  } else if (a.state === 'browser') body = '<p class="soft">Agents need Workshop running on this computer.</p>';
  else if (a.state === 'off') body = `<p class="soft">${esc(a.message || 'The opencode connector is off. Turn it on in Settings.')}</p>`;
  else body = '<p class="soft">Checking…</p>';
  return `<section class="card"><div class="ch"><h2>Agents</h2><button class="lnk" data-open="agents">Open</button></div>${body}</section>`;
}

export function profileForm(p) {
  p = p || {};
  return `<form class="pform" data-profile-form>
    <h2>Your profile</h2>
    <label>Name<input name="name" maxlength="80" autocomplete="name" value="${esc(p.name || '')}"></label>
    <label>Role<input name="role" maxlength="80" placeholder="Engineering Manager" value="${esc(p.role || '')}"></label>
    <p class="soft">Saved in your Workshop data on this computer. Only used for this page.</p>
    <div class="acts"><button type="button" class="btn ghost" data-cancel>Cancel</button><button class="btn primary">Save</button></div>
  </form>`;
}
