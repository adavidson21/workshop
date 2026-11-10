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
  doc: svg('<path d="M5.5 2.8h6l3.5 3.5v10.9H5.5z"/><path d="M11.5 2.8v3.5H15M8 10h5M8 13h5"/>'),
  dots: '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="10" r="1.4"/><circle cx="10" cy="10" r="1.4"/><circle cx="15" cy="10" r="1.4"/></svg>'
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
    total: d.total | 0, open: d.open | 0, focus: { total: (d.focus && d.focus.total) | 0, done: (d.focus && d.focus.done) | 0,
      tasks: (d.focus && Array.isArray(d.focus.tasks) ? d.focus.tasks : []).filter(t => t && typeof t.title === 'string').slice(0, 10).map(t => ({ id: String(t.id || ''), title: t.title.slice(0, 200), done: !!t.done })) },
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

// "Morning, Sam" with a name; "Good morning" without one.
export function greeting(now, named = false) {
  const h = now.getHours();
  const part = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  return named ? part[0].toUpperCase() + part.slice(1) : 'Good ' + part;
}


/* ---------- Needs you, and the week ---------- */

// Order in the inbox: what blocks someone first, then decisions, then upkeep.
const RANK = { urgent: 0, '': 1, waiting: 2 };

/**
 * One list of what needs you, from every app: each app's summary `needs` card (docs/summaries.md, Docket's
 * included from Docket 7.0.0) and agents waiting for an answer. byApp: [{app, name, cards: Map | null}].
 * Rows: [{app, appName, id, title, note, route, flag}], urgent first, at most 12.
 */
export function inboxRows(byApp, { agents = null } = {}) {
  const out = [];
  if (agents && agents.state === 'ready' && agents.needYou) out.push({ app: 'agents', appName: 'Dispatch', title: `${plural(agents.needYou, 'agent')} waiting for an answer`, note: '', route: '', flag: 'urgent' });
  for (const a of byApp) {
    const c = a.cards && a.cards.get('needs');
    if (!c || c.kind !== 'list' || !Array.isArray(c.rows)) continue;
    for (const r of c.rows.slice(0, 20)) {
      if (!r || typeof r.title !== 'string') continue;
      out.push({ app: a.app, appName: a.name, id: typeof r.id === 'string' ? r.id : '', title: r.title.slice(0, 200), note: typeof r.note === 'string' ? r.note.slice(0, 200) : '', route: typeof r.route === 'string' ? r.route : '', flag: ['urgent', 'waiting'].includes(r.flag) ? r.flag : '' });
    }
  }
  // One row for pull requests: Docket's "PRs blocked on you" (from Docket 7.0.0) keeps its place and takes
  // Dispatch's "waiting for your review" count as its note, instead of two rows about the same reviews.
  const docketPrs = out.find(r => r.app === 'prioritizer' && r.id === 'prs');
  const agentPrs = out.findIndex(r => r.app === 'agents' && r.id === 'prs');
  if (docketPrs && agentPrs >= 0) {
    docketPrs.note = `${out[agentPrs].title} in Dispatch`.slice(0, 200);
    out.splice(agentPrs, 1);
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

/**
 * Coming up, from each app's `upcoming` list card (docs/summaries.md): dated things in the next 14 days and up to
 * 7 days late, soonest first, at most 12. Rows: [{app, appName, title, note, route, due}].
 */
export function upcomingRows(byApp, today) {
  const out = [];
  const lo = addDays(today, -7), hi = addDays(today, 14);
  for (const a of byApp) {
    const c = a.cards && a.cards.get('upcoming');
    if (!c || c.kind !== 'list' || !Array.isArray(c.rows)) continue;
    for (const r of c.rows.slice(0, 20)) {
      if (!r || typeof r.title !== 'string' || !isDay(r.due) || r.due < lo || r.due > hi) continue;
      out.push({ app: a.app, appName: a.name, title: r.title.slice(0, 200), note: typeof r.note === 'string' ? r.note.slice(0, 80) : '', route: typeof r.route === 'string' ? r.route : '', due: r.due });
    }
  }
  return out.map((r, i) => [r.due, i, r]).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] - y[1])).map(x => x[2]).slice(0, 12);
}
const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
function addDays(day, n) { const [y, m, d] = day.split('-').map(Number); return dateStr(new Date(y, m - 1, d + n)); }
/** "Today", "Tomorrow", "Thu", or "Nov 24" past a week; "3 days late" before today. */
export function dueLabel(due, today) {
  const [y, m, d] = due.split('-').map(Number), [ty, tm, td] = today.split('-').map(Number);
  const diff = Math.round((new Date(y, m - 1, d) - new Date(ty, tm - 1, td)) / 864e5);
  if (diff < 0) return diff === -1 ? 'Yesterday' : `${-diff} days late`;
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  const dt = new Date(y, m - 1, d);
  return diff < 7 ? dt.toLocaleDateString(undefined, { weekday: 'short' }) : dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Today's Day plan blocks from Docket's `day` card: [{name, at, until, tasks, now, past}] with now marked. */
export function dayBlocks(day, nowMin) {
  if (!day || !Array.isArray(day.blocks)) return [];
  return day.blocks.filter(b => b && typeof b.name === 'string' && isTime(b.at)).slice(0, 24).map(b => {
    const at = toMin(b.at), until = isTime(b.until) ? toMin(b.until) : at;
    return { name: b.name.slice(0, 80), at: b.at, until: isTime(b.until) ? b.until : '', now: nowMin >= at && nowMin < until, past: nowMin >= until,
      tasks: (Array.isArray(b.tasks) ? b.tasks : []).filter(t => t && typeof t.title === 'string').slice(0, 10).map(t => ({ id: String(t.id || ''), title: t.title.slice(0, 200), done: !!t.done })) };
  });
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

/**
 * Needs you during focus hours (docs/focus.md): during focus only blocking pull requests show and the rest folds
 * to "N held until 12:00"; during lunch everything folds. Outside a block (or with focus hours off): the rows.
 * focus: resolveFocus() or null. blocking: Docket's `blocking` rows as inbox rows.
 */
export function heldInbox(rows, focus, blocking = []) {
  const state = focus && focus.state;
  if (state !== 'focus' && state !== 'lunch') return { rows, held: 0, until: '' };
  const until = focus.span ? focus.span.end : focus.until;
  if (state === 'lunch') return { rows: [], held: rows.length + blocking.length, until };
  return { rows: blocking, held: rows.length, until };
}

/** Docket's `blocking` card (PRs blocked on you) as inbox rows. */
export function blockingRows(cards) {
  const c = cards && cards.get('blocking');
  if (!c || c.kind !== 'list' || !Array.isArray(c.rows)) return [];
  return c.rows.filter(r => r && typeof r.title === 'string').slice(0, 12).map(r => ({ app: 'prioritizer', appName: 'Docket', title: r.title.slice(0, 200), note: typeof r.note === 'string' ? r.note.slice(0, 200) : 'Blocked on you', route: typeof r.route === 'string' ? r.route : '', flag: 'urgent' }));
}

const fmtUntil = s => { const h = +String(s).slice(0, 2); return Number.isFinite(h) ? `${h % 12 || 12}:${String(s).slice(3, 5)}` : ''; };
function inboxCard(rowsIn, focus, blocking) {
  const { rows, held, until } = heldInbox(rowsIn, focus, blocking);
  const heldLine = held ? `<p class="soft held-line">${plural(held, 'item')} held until ${esc(fmtUntil(until))}.</p>` : '';
  if (focus && (focus.state === 'focus' || focus.state === 'lunch') && !rows.length) {
    return `<section class="card inbox"><div class="ch"><h2>Needs you</h2></div>${heldLine || `<p class="soft">Nothing needs you right now.</p>`}</section>`;
  }
  return `<section class="card inbox"><div class="ch"><h2>Needs you</h2></div>${heldLine}
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
  // Your name from People (relation You) first: every app knows it. Home's own profile name is the fallback.
  const me = v.dir && Array.isArray(v.dir.people) ? v.dir.people.find(x => !x.archived && x.relation === 'self') : null;
  const name = ((me && me.name) || p.name || '').trim(), role = (p.role || (me && me.role) || '').trim();
  const b = v.board && v.board.total ? v.board : null;
  // The header is the greeting and one More menu (Home 3.0.0). The day's actions (pick, plan, wrap up) are on the
  // Your day card. The weekly status draft is in the menu, and a labeled button on Friday afternoons.
  const friday = v.now.getDay() === 5 && v.now.getHours() >= 12;
  const more = `<details class="hmore" data-more><summary class="hbtn" aria-label="More" title="More">${ICON.dots}</summary>
      <div class="hmenu" role="menu"><button class="mi" role="menuitem" data-status>${ICON.doc}Weekly status</button>
        <button class="mi" role="menuitem" data-edit-profile>${ICON.pencil}${name ? 'Edit profile' : 'Add your name'}</button></div></details>`;
  const head = `<header class="hello">
    <div class="who">
      <p class="meta">${role ? esc(role) + ' · ' : ''}${v.now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      <h1>${greeting(v.now, !!name)}${name ? ', ' + esc(name.split(/\s+/)[0]) : ''}</h1>
    </div>
    ${v.waiting ? '' : `<div class="htools">${friday ? `<button class="btn" data-status>${ICON.doc}Weekly status</button>` : ''}${more}</div>`}
  </header>`;

  if (v.waiting) return head + waitingCard(v.embedded);

  /* The dashboard (docs/layout.md, .dash): one column in half a screen, two on a laptop, three from 1600px.
     Home shows and links; sorting, ranking and planning happen in each app (Docket's Today for the day). */
  const today = dateStr(v.now);
  const rest = inboxCard(v.inbox || [], v.focus, v.blocking || [])
    + upcomingCard(v.upcoming, today) + notesCard(v.notes) + agentsCard(v.agents) + weekCard(v.week);
  let first;
  if (!v.board) first = `<section class="card note w2"><h2>Docket</h2><p>${esc(v.boardNote || 'Loading your board.')}</p></section>`;
  else if (!b && v.noSummary) {
    // No summary yet: a new board, or Docket not opened since an update (Home reads only its summary).
    first = `<section class="card note w2"><h2>Nothing from Docket yet</h2><p>Open Docket once and your day shows up here. New to Docket? Add a few tasks there.</p>
      <p><button class="btn primary" data-open="prioritizer">Open Docket</button></p></section>`;
  } else if (!b) {
    const empty = v.adoReady
      ? '<h2>Your ADO work items are waiting in Docket</h2><p>Azure DevOps is connected. Open Docket to bring in the items assigned to you; they show up here after that.</p>'
      : '<h2>No tasks yet</h2><p>Add a few in Docket and they show up here.</p>';
    first = `<section class="card note w2">${empty}
      <p><button class="btn primary" data-open="prioritizer">Open Docket</button></p></section>`;
  } else first = yourDayCard(b, v.day, v.now, v.wrap);
  return head + `<div class="dash cols">${first}${rest}</div>`;
}

/* Coming up across apps: each app's `upcoming` card (1:1s, milestones, review dates). */
export function upcomingCard(rows, today) {
  if (!Array.isArray(rows) || !rows.length) return '';
  return `<section class="card upcoming"><div class="ch"><h2>Coming up</h2></div>
    <ul class="uplist">${rows.map(r => `<li><button class="urow" data-open="${esc(r.app)}"${r.route ? ` data-path="${esc(r.route)}"` : ''}><span class="ud num${r.due < today ? ' late' : r.due === today ? ' today' : ''}">${esc(dueLabel(r.due, today))}</span><span class="ut">${esc(r.title)}</span><span class="un">${esc(r.note || r.appName)}</span></button></li>`).join('')}</ul></section>`;
}

/* This week: what you finished, decided and shipped, from every app's `done-week` card. */
export function weekCard(week) {
  if (!Array.isArray(week) || !week.length) return '';
  return `<section class="card week w2"><div class="ch"><h2>This week</h2><button class="lnk" data-status>Weekly status</button></div>
    <div class="weekcols">${week.map(w => `<div class="wk"><p class="wkh">${esc(w.title)} <span class="num">${w.count}</span></p><ul>${w.rows.slice(0, 4).map(r => `<li>${esc(r.title)}</li>`).join('')}${w.count > 4 ? `<li class="soft">and ${w.count - Math.min(4, w.rows.length)} more</li>` : ''}</ul></div>`).join('')}</div></section>`;
}

/* Your day (Home 3.0.0), from Docket's `board` and `day` cards: one line for the block on now and the next, Today's
   tasks grouped under their blocks when there is a Day plan (then Not scheduled), and one line of what is left to
   sort or late. One button: pick today's tasks when Today is empty, Wrap up from its time, else Open Docket.
   Everything opens Docket's Today, where the day happens; Home never sorts or plans. */
const MAX_TASKS = 8;
export function nowLine(blocks) {
  const i = blocks.findIndex(x => x.now), cur = blocks[i], next = blocks.slice(i + 1).find(x => !x.past) || (i < 0 ? blocks.find(x => !x.past) : null);
  if (cur) return `<b>${esc(cur.name)}</b>${cur.until ? ` until ${esc(fmt12(cur.until))}` : ''}${next ? `, then ${esc(next.name)}` : ''}`;
  if (next) return `Next: <b>${esc(next.name)}</b> at ${esc(fmt12(next.at))}`;
  return 'Your blocks are done for today';
}
export function yourDayCard(b, day, now, wrap) {
  const blocks = dayBlocks(day, now.getHours() * 60 + now.getMinutes());
  const tasks = (b.focus.tasks || []);
  const allDone = b.focus.total && b.focus.done === b.focus.total;
  const w = wrap || { wrapped: false, due: now.getHours() >= 15, receipts: 0 };
  const offered = w.receipts ? ` ${plural(w.receipts, 'receipt')} offered to Rapport today.` : '';
  const btn = w.wrapped ? `<button class="btn ghost" data-open="prioritizer" data-path="shutdown" title="Day wrapped.${esc(offered)}">${ICON.check}Day wrapped</button>`
    : w.due ? `<button class="btn primary" data-open="prioritizer" data-path="shutdown" title="Wrap up: breadcrumbs and tomorrow's top 3.${esc(offered)}">${ICON.moon}Wrap up</button>`
    : !b.focus.total ? `<button class="btn primary" data-open="prioritizer" data-path="today">${ICON.sun}Pick today's tasks</button>`
    : `<button class="btn primary" data-open="prioritizer" data-path="today">Open Docket</button>`;
  const line = blocks.length ? `<p class="ydnow">${blocks.some(x => x.now) ? '<span class="nowtag">Now</span>' : ''}${nowLine(blocks)}</p>`
    : `<p class="ydnow soft">No plan today. <button class="lnk" data-open="prioritizer" data-path="day/today">Plan the day</button></p>`;
  // Today's tasks, grouped under the blocks they are in; the rest are Not scheduled. At most MAX_TASKS rows.
  const li = t => `<li class="${t.done ? 'done' : ''}"><button class="lnk" data-open="prioritizer" data-path="task/${esc(t.id)}">${esc(t.title)}</button></li>`;
  let shown = 0, list = '';
  const take = ts => { const out = ts.slice(0, Math.max(0, MAX_TASKS - shown)); shown += out.length; return out; };
  if (blocks.length) {
    const inBlock = new Set();
    for (const x of blocks) {
      x.tasks.forEach(t => inBlock.add(t.id));
      if (!x.tasks.length || x.past && x.tasks.every(t => t.done)) continue;
      const ts = take(x.tasks);
      if (ts.length) list += `<li class="ydblk${x.now ? ' now' : ''}"><span class="num">${esc(fmt12(x.at))}</span>${esc(x.name)}</li>${ts.map(li).join('')}`;
    }
    const loose = take(tasks.filter(t => !inBlock.has(t.id)));
    if (loose.length) list += `<li class="ydblk">Not scheduled</li>${loose.map(li).join('')}`;
  } else list = take(tasks).map(li).join('');
  const total = new Set([...tasks.map(t => t.id), ...blocks.flatMap(x => x.tasks.map(t => t.id))]).size;
  const moreN = total - shown;
  const foot = [b.triage ? `${b.triage} to sort` : '', b.overdue ? `<span class="late">${b.overdue} overdue</span>` : '', b.dueWeek ? `${b.dueWeek} due this week` : '']
    .filter(Boolean).map(x => `<button class="lnk" data-open="prioritizer" data-path="today">${x}</button>`).join('<span aria-hidden="true"> · </span>');
  return `<section class="card yourday w2"><div class="ch"><h2>Your day</h2>${b.focus.total ? `<span class="ydcount num" title="${b.focus.done} of ${b.focus.total} on Today done">${allDone ? 'All done' : `${b.focus.done} of ${b.focus.total} done`}</span>` : ''}${btn}</div>
    ${line}
    ${list ? `<ol class="ydtasks" aria-label="On Today">${list}</ol>${moreN > 0 ? `<p class="soft"><button class="lnk" data-open="prioritizer" data-path="today">and ${moreN} more</button></p>` : ''}`
      : `<p class="soft">Nothing on Today yet. Pick 3 to 5 in Docket.</p>`}
    ${foot ? `<p class="ydfoot">${foot}</p>` : ''}
  </section>`;
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
    <p class="soft">Your name in People (Settings) wins everywhere; this one is used on this page when People has no "you". Role shows above the greeting.</p>
    <div class="acts"><button type="button" class="btn ghost" data-cancel>Cancel</button><button class="btn primary">Save</button></div>
  </form>`;
}
