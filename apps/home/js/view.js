/* Home: the numbers and the HTML. Pure functions with no DOM or SDK, so Node tests can import them.
   Home reads other apps only through their summaries (docs/summaries.md) and never their own collections
   or code, so Docket's rules for counts, the day plan and Wrap up stay in Docket. Names come from the people
   directory (shared/people.js). */
import { label } from '../../../shared/people.js';

const pad = n => String(n).padStart(2, '0');
export const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/* Symbols, in the same line style as Docket's rows: color only when something needs you. */
const svg = (d, w = 1.5) => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON = {
  sun: svg('<circle cx="10" cy="10" r="3.2"/><path d="M10 2.6v1.7M10 15.7v1.7M2.6 10h1.7M15.7 10h1.7M4.8 4.8L6 6M14 14l1.2 1.2M4.8 15.2L6 14M14 6l1.2-1.2"/>'),
  triage: svg('<path d="M3 4.5h14l-5.3 6.3v4.4l-3.4 1.6v-6z"/>'),
  overdue: svg('<rect x="3" y="4.5" width="14" height="12" rx="2"/><path d="M3 8.5h14M7 2.8v3.2M13 2.8v3.2M10 10.5v2.3"/><circle cx="10" cy="14.6" r=".6" fill="currentColor" stroke="none"/>'),
  cal: svg('<rect x="3" y="4.5" width="14" height="12" rx="2"/><path d="M3 8.5h14M7 2.8v3.2M13 2.8v3.2"/>'),
  day: svg('<rect x="3" y="3.5" width="14" height="13" rx="2"/><path d="M6.5 7.5h7M6.5 10.5h4.5M6.5 13.5h6"/>'),
  moon: svg('<path d="M15.8 12.6A6.5 6.5 0 0 1 7.4 4.2a6.5 6.5 0 1 0 8.4 8.4z"/>'),
  check: svg('<path d="M4.5 10.5l3.5 3.5 7.5-8"/>', 1.8),
  pencil: svg('<path d="M12.8 3.7l3.5 3.5L7.5 16H4v-3.5z"/><path d="M11 5.5l3.5 3.5"/>'),
  ring: svg('<circle cx="10" cy="10" r="6.5"/><path d="M10 3.5a6.5 6.5 0 0 1 6.5 6.5H10z" fill="currentColor" stroke="none"/>'),
  open: svg('<circle cx="10" cy="10" r="6"/>'),
  wait: svg('<path d="M5.5 3h9M5.5 17h9M6.5 3c0 3.5 3.5 4.5 3.5 7s-3.5 3.5-3.5 7M13.5 3c0 3.5-3.5 4.5-3.5 7s3.5 3.5 3.5 7"/>'),
  noest: svg('<circle cx="10" cy="10" r="6" stroke-dasharray="2.2 2.2"/>'),
  bell: svg('<path d="M5.5 13.5V9a4.5 4.5 0 0 1 9 0v4.5l1.3 1.5H4.2z"/><path d="M8.3 17a1.8 1.8 0 0 0 3.4 0"/>'),
  play: svg('<path d="M6.5 4.3v11.4l9-5.7z"/>'),
  chev: svg('<path d="M5.5 8l4.5 4.5L14.5 8"/>', 1.6),
  x: svg('<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>', 1.6),
  doc: svg('<path d="M5.5 2.8h6l3.5 3.5v10.9H5.5z"/><path d="M11.5 2.8v3.5H15M8 10h5M8 13h5"/>')
};
// Round icon button; the tooltip (title) and aria-label carry the words.
export const hbtn = (icon, label, attrs, cls = '', tip = label) => `<button class="hbtn${cls ? ' ' + cls : ''}" ${attrs} aria-label="${esc(label)}" title="${esc(tip)}">${icon}</button>`;
// Same as Docket's listColor and initials, so a list keeps its dot color and a person their initials everywhere.
export const listColor = id => { let h = 0; for (const c of String(id || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 6; };
export function initials(name) {
  const s = String(name || '').trim(); if (!s) return '?';
  const words = s.split(/[\s._-]+/).filter(Boolean);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  const cap = [...s.slice(1)].find(c => c >= 'A' && c <= 'Z' || c >= '0' && c <= '9');
  return (s[0] + (cap || s[1] || '')).toUpperCase();
}

/* From the opencode connector's `state` result: prompts waiting for you, and sessions working. */
export function agentCounts(state) {
  const live = state && state.liveMode && state.liveMode.live;
  if (!live) return { needYou: 0, working: 0 };
  const needYou = (live.permissions || []).length + (live.questions || []).length;
  const working = Object.values(live.sessions || {}).filter(s => s && s.status && s.status !== 'idle').length;
  return { needYou, working };
}

/* Times are "HH:MM"; Workshop shows them on a 12-hour clock ("9:30 AM"). */
const isTime = s => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const toMin = s => isTime(s) ? +s.slice(0, 2) * 60 + +s.slice(3) : null;
export const fmt12 = s => isTime(s) ? `${+s.slice(0, 2) % 12 || 12}:${s.slice(3)} ${+s.slice(0, 2) < 12 ? 'AM' : 'PM'}` : (s || '');

/* ---------- from Docket's summary (docs/summaries.md) ----------
   Today's counts and Wrap up from the `board` and `day` cards' entries for today. Docket's Today is where the
   day happens, so Home shows only the counts and opens it. Names for the ids in `upNext.who` and `team` come
   from the people directory (withNames). */
export function boardFromSummary(card, today) {
  const d = card && card.days && card.days[today];
  if (!d) return null;
  return {
    total: d.total | 0, open: d.open | 0, focus: { total: (d.focus && d.focus.total) | 0, done: (d.focus && d.focus.done) | 0 },
    triage: d.triage | 0, overdue: d.overdue | 0, dueWeek: d.dueWeek | 0, nudges: d.nudges | 0, cameBack: d.cameBack | 0,
    upNext: Array.isArray(card.upNext) ? card.upNext.slice(0, 3) : [],
    team: Array.isArray(card.team) ? card.team : []
  };
}
/** The board with names from the people directory (shared/people.js): `people` (names) on each Up next row
    from its `who` ids, and `name` on each team row from its id. */
export function withNames(board, dir) {
  if (!board) return board;
  return {
    ...board,
    upNext: board.upNext.map(t => ({ ...t, people: (Array.isArray(t.who) ? t.who : []).map(id => label(dir, id)) })),
    team: board.team.filter(m => m && m.id).map(m => ({ ...m, name: label(dir, m.id, m.name || 'Unknown') }))
  };
}
export function wrapFromDay(day, nowMin) {
  return { wrapped: !!(day && day.wrapped), due: !!(day && isTime(day.wrapAt) && nowMin >= toMin(day.wrapAt)), receipts: day && Number.isInteger(day.offered) ? day.offered : 0 };
}

export function greeting(now) {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

const tile = (icon, n, label, sub, tone, path, tip = label) => `<button class="tile${tone ? ' ' + tone : ''}" data-open="prioritizer" data-path="${path}" title="${esc(tip)}">
  <span class="n num">${n}</span><span class="lbl">${icon}${label}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</button>`;

/* ---------- Needs you, and the week ---------- */

// Order in the inbox: what blocks someone first, then decisions, then upkeep.
const RANK = { urgent: 0, '': 1, waiting: 2 };

/**
 * One list of what needs you, from every app: each app's summary `needs` card (docs/summaries.md) and agents
 * waiting for an answer. Docket's own counts are on the Today card. byApp: [{app, name, cards: Map | null}].
 * Rows: [{app, appName, title, note, route, flag}], urgent first, at most 12.
 */
export function inboxRows(byApp, { agents = null } = {}) {
  const out = [];
  if (agents && agents.state === 'ready' && agents.needYou) out.push({ app: 'agents', appName: 'Dispatch', title: `${plural(agents.needYou, 'agent')} waiting for an answer`, note: '', route: '', flag: 'urgent' });
  for (const a of byApp) {
    const c = a.cards && a.cards.get('needs');
    if (!c || c.kind !== 'list' || !Array.isArray(c.rows)) continue;
    for (const r of c.rows.slice(0, 20)) {
      if (!r || typeof r.title !== 'string') continue;
      out.push({ app: a.app, appName: a.name, title: r.title.slice(0, 200), note: typeof r.note === 'string' ? r.note.slice(0, 200) : '', route: typeof r.route === 'string' ? r.route : '', flag: ['urgent', 'waiting'].includes(r.flag) ? r.flag : '' });
    }
  }
  return out.map((r, i) => [RANK[r.flag] ?? 1, i, r]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).map(x => x[2]).slice(0, 12);
}

/** The week's work, from each app's `done-week` list card: [{app, name, rows: [{title, note, due}]}]. */
export function weekRows(byApp) {
  const out = [];
  for (const a of byApp) {
    const c = a.cards && a.cards.get('done-week');
    if (!c || c.kind !== 'list' || !Array.isArray(c.rows) || !c.rows.length) continue;
    out.push({ app: a.app, name: a.name, title: typeof c.title === 'string' ? c.title : a.name, count: Number.isInteger(c.count) ? c.count : c.rows.length,
      rows: c.rows.filter(r => r && typeof r.title === 'string').slice(0, 20).map(r => ({ title: r.title, note: typeof r.note === 'string' ? r.note : '', due: typeof r.due === 'string' ? r.due : '' })) });
  }
  return out;
}

/** The weekly status draft, as Markdown to edit and paste: one section per app that has something to say. */
export function statusDraft(week, { name = '', now = new Date() } = {}) {
  const head = `# Weekly status${name ? `: ${name}` : ''}, week of ${new Date(now.getTime() - 6 * 864e5).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  if (!week.length) return `${head}

Nothing logged this week yet. Finish tasks in Docket, decide in Slate, ship with Dispatch, and it shows up here.
`;
  const parts = [head, ''];
  for (const w of week) {
    parts.push(`## ${w.title}`, '');
    for (const r of w.rows) parts.push(`- ${r.title}${r.note ? ` (${r.note})` : ''}`);
    if (w.count > w.rows.length) parts.push(`- and ${w.count - w.rows.length} more`);
    parts.push('');
  }
  parts.push('## Next week', '', '- ', '', '## Risks and asks', '', '- ');
  return parts.join('\n');
}

function inboxCard(rows) {
  return `<section class="card inbox"><div class="ch"><h2>Needs you</h2></div>
    ${rows.length ? `<ul class="inbox-list">${rows.map(r => `<li><button class="irow${r.flag ? ' ' + r.flag : ''}" data-open="${esc(r.app)}"${r.route ? ` data-path="${esc(r.route)}"` : ''}>
      <span class="iapp">${esc(r.appName)}</span><span class="it">${esc(r.title)}</span>${r.note ? `<span class="in">${esc(r.note)}</span>` : ''}</button></li>`).join('')}</ul>`
      : '<p class="soft">Nothing needs you right now.</p>'}
  </section>`;
}

/* The whole page. `v` is {now, profile, board, boardNote, noSummary, agents, waiting, embedded}:
   profile {name, role}; board = withNames(boardFromSummary()) or null; boardNote = why there is no board (string) or '';
   wrap = wrapFromDay() or null; inbox = inboxRows(); notes = Notes' recent rows;
   agents = {state: 'ready' | 'off' | 'browser' | 'loading', needYou, working, message};
   waiting = true while the browser's folder store needs Allow (data.js); embedded = inside the shell. */
export function render(v) {
  const p = v.profile || {};
  const name = (p.name || '').trim(), role = (p.role || '').trim();
  const b = v.board && v.board.total ? v.board : null;
  // The day's actions are round icons in the header: plan the day, then wrap up (the primary one from an hour
  // before the Day view's day end, from Docket's summary; a check once wrapped). Triage is its tile.
  const w = v.wrap || { wrapped: false, due: v.now.getHours() >= 15, receipts: 0 };
  // The weekly status draft: always one click away, the highlighted thing on Friday afternoons.
  const friday = v.now.getDay() === 5 && v.now.getHours() >= 12;
  const statusTool = hbtn(ICON.doc, 'Weekly status', 'data-status', friday ? 'primary' : '', 'Draft your weekly status from what you finished, decided and shipped.');
  const offered = w.receipts ? ` ${plural(w.receipts, 'receipt')} offered to Rapport today.` : '';
  const dayTools = b ? hbtn(ICON.day, b.focus.total ? 'Plan today' : "Pick today's tasks", `data-open="prioritizer" data-path="${b.focus.total ? 'day/today' : 'today'}"`, !b.triage && !b.focus.total ? 'primary' : '')
    + (w.wrapped ? hbtn(ICON.check, 'Day wrapped', 'data-open="prioritizer" data-path="shutdown"', 'done', 'Day wrapped.' + offered)
      : hbtn(ICON.moon, 'Wrap up the day', 'data-open="prioritizer" data-path="shutdown"', w.due ? 'primary' : '', "Wrap up the day: breadcrumbs and tomorrow's top 3." + offered)) : '';
  const head = `<header class="hello">
    <div class="who">
      <p class="meta">${role ? esc(role) + ' · ' : ''}${v.now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      <h1>${greeting(v.now)}${name ? ', ' + esc(name.split(/\s+/)[0]) : ''}</h1>
    </div>
    ${v.waiting ? '' : `<div class="htools">${dayTools}${statusTool}${hbtn(ICON.pencil, name ? 'Edit profile' : 'Add your name', 'data-edit-profile')}</div>`}
  </header>`;

  if (v.waiting) return head + waitingCard(v.embedded);

  if (!v.board) {
    return head + inboxCard(v.inbox || []) + `<section class="card note"><h2>Docket</h2><p>${esc(v.boardNote || 'Loading your board.')}</p></section>` + notesCard(v.notes) + agentsCard(v.agents);
  }
  if (!b && v.noSummary) {
    // No summary yet: a new board, or Docket not opened since an update (Home reads only its summary).
    return head + `<section class="card note"><h2>Nothing from Docket yet</h2><p>Open Docket once and your board shows up here. New to Docket? Add a few tasks there.</p>
      <p><button class="btn primary" data-open="prioritizer">Open Docket</button></p></section>` + inboxCard(v.inbox || []) + notesCard(v.notes) + agentsCard(v.agents);
  }
  if (!b) {
    return head + inboxCard(v.inbox || []) + `<section class="card note"><h2>No tasks yet</h2><p>Add a few in Docket and they show up here.</p>
      <p><button class="btn primary" data-open="prioritizer">Open Docket</button></p></section>` + notesCard(v.notes) + agentsCard(v.agents);
  }

  return head + `<div class="cols"><div class="stack">${todayCard(b)}${inboxCard(v.inbox || [])}</div><div class="stack">${notesCard(v.notes)}${agentsCard(v.agents)}</div></div>`;
}

/* Docket's Today, in counts: each opens Docket's Today, where the day happens (its Needs you strip handles them). */
export function todayCard(b) {
  const allDone = b.focus.total && b.focus.done === b.focus.total;
  return `<section class="card todaycard"><div class="ch"><h2>Today</h2><button class="btn primary" data-open="prioritizer" data-path="today">Open Today</button></div>
  <div class="tiles" aria-label="Today in Docket">
    ${tile(ICON.sun, b.focus.total ? `${b.focus.done}<small>/${b.focus.total}</small>` : '0', 'On Today', allDone ? 'All done' : `${plural(b.open, 'open task')}`, b.focus.total ? (allDone ? 'good' : '') : 'zero', 'today', b.focus.total ? `${b.focus.done} of ${b.focus.total} on Today done` : 'Nothing on Today yet. Pick 3 to 5.')}
    ${tile(ICON.triage, b.triage, 'Triage', '', b.triage ? 'warn' : 'zero', 'today', b.triage ? `${plural(b.triage, 'task')} to sort` : 'Nothing to triage')}
    ${tile(ICON.bell, b.nudges, 'Follow-ups', b.cameBack ? `${b.cameBack} came back` : '', b.nudges ? 'warn' : b.cameBack ? '' : 'zero', 'today', b.nudges ? `${plural(b.nudges, 'follow-up')} due on work you handed over` : 'No follow-ups due')}
    ${tile(ICON.overdue, b.overdue, 'Overdue', b.dueWeek ? `${b.dueWeek} due this week` : '', b.overdue ? 'danger' : 'zero', 'today')}
  </div></section>`;
}

/* Shown instead of the page while Chrome must be asked again for the data folder. Same words as Prioritizer. */
export function waitingCard(embedded) {
  return `<section class="card note waiting" role="status"><h2>Allow Workshop to use your folder to see your day</h2>
    <p>${embedded ? 'Click <b>Allow</b> in the bar at the top of Workshop. Chrome asks again after it restarts.'
      : 'Open Workshop and click <b>Allow</b> in the bar at the top. Chrome asks again after it restarts.'}</p>
    ${embedded ? '' : '<p><button class="btn primary" data-open="home">Open Workshop</button></p>'}</section>`;
}

const pill = (icon, n, label, tone, app) => `<button class="pill${n ? ' ' + tone : ' zero'}" data-open="${app}" aria-label="${n} ${esc(label)}" title="${esc(label)}">${icon}<b class="num">${n}</b></button>`;
/* Dispatch: only when it is connected. Its setup lives in Dispatch and Get started, not on Home. */
function agentsCard(a) {
  if (!a || a.state !== 'ready') return '';
  return `<section class="card"><div class="ch"><h2>Dispatch</h2><button class="lnk" data-open="agents">Open</button></div>
    <div class="pills">${pill(ICON.bell, a.needYou, 'Need you', 'warn', 'agents')}${pill(ICON.play, a.working, 'Working', 'acc', 'agents')}</div></section>`;
}

/* Recent notes from Notes' summary: only when there are some. */
export function notesCard(rows) {
  if (!Array.isArray(rows) || !rows.length) return '';
  return `<section class="card"><div class="ch"><h2>Recent notes</h2><button class="lnk" data-open="notes">All notes</button></div>
    <ul class="notes-recent">${rows.map(r => `<li><button class="lnk" data-open="notes" data-path="${esc(r.route)}">${esc(r.title)}</button></li>`).join('')}</ul></section>`;
}

export function profileForm(p) {
  p = p || {};
  return `<form class="pform" data-profile-form>
    <h2>Your profile</h2>
    <label>Name<input name="name" maxlength="80" autocomplete="name" value="${esc(p.name || '')}"></label>
    <label>Role<input name="role" maxlength="80" placeholder="Engineering Manager" value="${esc(p.role || '')}"></label>
    <p class="soft">Only used on this page.</p>
    <div class="acts"><button type="button" class="btn ghost" data-cancel>Cancel</button><button class="btn primary">Save</button></div>
  </form>`;
}
