/* Home: the numbers and the HTML. Pure functions with no DOM or SDK, so Node tests can import them.
   Home reads other apps only through their summaries (docs/summaries.md) and never their own collections
   or code, so Docket's rules for counts, the day plan and Wrap up stay in Docket. Names come from the people
   directory (shared/people.js). */
import { label } from '../../../shared/people.js';

const pad = n => String(n).padStart(2, '0');
export const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const daysBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / 864e5);
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
  x: svg('<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>', 1.6)
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
   The board, the block on now and Wrap up from the `board` and `day` cards' entries for today. Names for the
   ids in `upNext.who` and `team` come from the people directory (withNames). */
export function boardFromSummary(card, today) {
  const d = card && card.days && card.days[today];
  if (!d) return null;
  return {
    total: d.total | 0, open: d.open | 0, focus: { total: (d.focus && d.focus.total) | 0, done: (d.focus && d.focus.done) | 0 },
    triage: d.triage | 0, overdue: d.overdue | 0, dueWeek: d.dueWeek | 0,
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
export function nowFromDay(day, nowMin) {
  const blocks = (day && Array.isArray(day.blocks) ? day.blocks : []).filter(b => b && isTime(b.at)).slice().sort((a, b) => toMin(a.at) - toMin(b.at));
  let current = null, next = null;
  for (let i = 0; i < blocks.length; i++) {
    const at = toMin(blocks[i].at), until = isTime(blocks[i].until) ? toMin(blocks[i].until) : at + 60;
    if (nowMin >= at && nowMin < until) { current = blocks[i]; next = blocks[i + 1] || null; break; }
    if (nowMin < at) { next = blocks[i]; break; }
  }
  if (!current && !next) return null;
  const brief = b => b ? { name: b.name || 'Untitled', at: b.at, tasks: Array.isArray(b.tasks) ? b.tasks : [] } : null;
  return { current: current ? Object.assign(brief(current), { until: current.until }) : null, next: brief(next) };
}
export function wrapFromDay(day, nowMin) {
  return { wrapped: !!(day && day.wrapped), due: !!(day && isTime(day.wrapAt) && nowMin >= toMin(day.wrapAt)), receipts: day && Number.isInteger(day.offered) ? day.offered : 0 };
}

function nowCard(n) {
  if (!n) return '';
  const rows = list => list.length ? `<ul class="blk">${list.slice(0, 5).map(t => `<li><button class="nrow${t.done ? ' done' : ''}" data-task="${esc(t.id)}"><span class="tt">${esc(t.title)}</span></button></li>`).join('')}</ul>` : '';
  const c = n.current;
  const body = c
    ? `<p class="blkname"><b>${esc(c.name)}</b> <span class="soft mono">until ${esc(fmt12(c.until))}</span></p>${rows(c.tasks) || '<p class="soft">Nothing planned in this block.</p>'}
       ${n.next ? `<p class="soft">Next: ${esc(n.next.name)} at ${esc(fmt12(n.next.at))}</p>` : ''}`
    : `<p class="blkname"><b>${esc(n.next.name)}</b> <span class="soft mono">at ${esc(fmt12(n.next.at))}</span></p>${rows(n.next.tasks)}`;
  return `<section class="card now"><div class="ch"><h2>${c ? 'Now' : 'Next block'}</h2><button class="lnk" data-open="prioritizer" data-path="day/today">Open Day</button></div>${body}</section>`;
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
// The short label on a due pill: Today, Tomorrow, Yesterday, a weekday this week, else Nov 14.
const dueShort = (d, today) => {
  const n = daysBetween(today, d);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return parseD(d).toLocaleDateString(undefined, { weekday: 'short' });
  return parseD(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const sig = (icon, tip, cls = '', text = '') => `<span class="sig${cls ? ' ' + cls : ''}${text ? ' txt' : ''}" role="img" aria-label="${esc(tip)}" title="${esc(tip)}">${icon}${text ? `<b>${esc(text)}</b>` : ''}</span>`;

const tile = (icon, n, label, sub, tone, path, tip = label) => `<button class="tile${tone ? ' ' + tone : ''}" data-open="prioritizer" data-path="${path}" title="${esc(tip)}">
  <span class="n num">${n}</span><span class="lbl">${icon}${label}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</button>`;

/* The whole page. `v` is {now, profile, board, boardNote, noSummary, agents, waiting, embedded}:
   profile {name, role}; board = withNames(boardFromSummary()) or null; boardNote = why there is no board (string) or '';
   agents = {state: 'ready' | 'off' | 'browser' | 'loading', needYou, working, message};
   waiting = true while the browser's folder store needs Allow (data.js); embedded = inside the shell. */
export function render(v) {
  const today = dateStr(v.now);
  const p = v.profile || {};
  const name = (p.name || '').trim(), role = (p.role || '').trim();
  const b = v.board && v.board.total ? v.board : null;
  // The day's actions are round icons in the header: plan the day, then wrap up (the primary one from an hour
  // before the Day view's day end, from Docket's summary; a check once wrapped). Triage is its tile.
  const w = v.wrap || { wrapped: false, due: v.now.getHours() >= 15, receipts: 0 };
  const offered = w.receipts ? ` ${plural(w.receipts, 'receipt')} offered to Rapport today.` : '';
  const dayTools = b ? hbtn(ICON.day, b.focus.total ? 'Plan today' : "Pick today's tasks", `data-open="prioritizer" data-path="${b.focus.total ? 'day/today' : 'today'}"`, !b.triage && !b.focus.total ? 'primary' : '')
    + (w.wrapped ? hbtn(ICON.check, 'Day wrapped', 'data-open="prioritizer" data-path="shutdown"', 'done', 'Day wrapped.' + offered)
      : hbtn(ICON.moon, 'Wrap up the day', 'data-open="prioritizer" data-path="shutdown"', w.due ? 'primary' : '', "Wrap up the day: breadcrumbs and tomorrow's top 3." + offered)) : '';
  const head = `<header class="hello">
    <div class="who">
      <p class="meta">${role ? esc(role) + ' · ' : ''}${v.now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      <h1>${greeting(v.now)}${name ? ', ' + esc(name.split(/\s+/)[0]) : ''}</h1>
    </div>
    ${v.waiting ? '' : `<div class="htools">${dayTools}${hbtn(ICON.pencil, name ? 'Edit profile' : 'Add your name', 'data-edit-profile')}</div>`}
  </header>`;

  if (v.waiting) return head + waitingCard(v.embedded);

  if (!v.board) {
    return head + `<section class="card note"><h2>Docket</h2><p>${esc(v.boardNote || 'Loading your board.')}</p></section>` + agentsCard(v.agents);
  }
  if (!b && v.noSummary) {
    // No summary yet: a new board, or Docket not opened since an update (Home reads only its summary).
    return head + `<section class="card note"><h2>Nothing from Docket yet</h2><p>Open Docket once and your board shows up here. New to Docket? Add a few tasks there.</p>
      <p><button class="btn primary" data-open="prioritizer">Open Docket</button></p></section>` + agentsCard(v.agents);
  }
  if (!b) {
    return head + `<section class="card note"><h2>No tasks yet</h2><p>Add a few in Docket and they show up here.</p>
      <p><button class="btn primary" data-open="prioritizer">Open Docket</button></p></section>` + agentsCard(v.agents);
  }

  const allDone = b.focus.total && b.focus.done === b.focus.total;
  const tiles = `<section class="tiles" aria-label="Today">
    ${tile(ICON.sun, b.focus.total ? `${b.focus.done}<small>/${b.focus.total}</small>` : '0', 'Today', allDone ? 'All done' : '', b.focus.total ? (allDone ? 'good' : '') : 'zero', 'today', b.focus.total ? `${b.focus.done} of ${b.focus.total} on Today done` : 'Nothing on Today yet. Pick 3 to 5.')}
    ${tile(ICON.triage, b.triage, 'Triage', '', b.triage ? 'warn' : 'zero', 'triage', b.triage ? `${plural(b.triage, 'task')} to sort` : 'Nothing to triage')}
    ${tile(ICON.overdue, b.overdue, 'Overdue', '', b.overdue ? 'danger' : 'zero', 'prioritize')}
    ${tile(ICON.cal, b.dueWeek, 'This week', `${plural(b.open, 'open task')}`, b.dueWeek ? '' : 'zero', 'prioritize', 'Due in the next 7 days')}
  </section>`;

  const next = `<section class="card">
    <div class="ch"><h2>Up next</h2><button class="lnk" data-open="prioritizer" data-path="prioritize">All tasks</button></div>
    ${b.upNext.length ? `<ol class="next">${b.upNext.map((t, i) => {
      const meta = (t.due ? sig(ICON.cal, (t.due < today ? 'Overdue. ' : '') + fmtDue(t.due, today), t.due < today ? 'danger' : daysBetween(today, t.due) <= 3 ? 'soon' : '', dueShort(t.due, today)) : '')
        + (t.triaged === false ? sig(ICON.noest, 'No estimate yet', 'quiet') : '')
        + (t.people.length ? `<span class="ppl" role="img" aria-label="${esc(t.people.join(', '))}" title="${esc(t.people.join(', '))}">${t.people.slice(0, 2).map(n => `<i class="av">${esc(initials(n))}</i>`).join('')}${t.people.length > 2 ? `<i class="av">+${t.people.length - 2}</i>` : ''}</span>` : '')
        + (t.list ? `<span class="lst" role="img" aria-label="List: ${esc(t.list)}" title="${esc(t.list)}"><i class="lc${listColor(t.listId)}"></i></span>` : '');
      return `<li><button class="nrow" data-task="${esc(t.id)}"><span class="rk num">${i + 1}</span><span class="tt">${esc(t.title)}</span><span class="tm">${meta}</span></button></li>`;
    }).join('')}</ol>` : `<p class="soft">Nothing open. Everything left is waiting on someone.</p>`}
  </section>`;

  // People with something open; the rest are in Docket's People.
  const busy = b.team.filter(m => m.open);
  const team = `<section class="card">
    <div class="ch"><h2>People</h2><button class="lnk" data-open="prioritizer" data-path="people">All people</button></div>
    ${busy.length ? `<ul class="team">${busy.slice(0, 8).map(m => `<li><span class="av" aria-hidden="true">${esc(initials(m.name))}</span><span class="nm">${esc(m.name)}</span>
      <span class="ct">${sig(ICON.open, plural(m.open, 'open task'), '', String(m.open))}${m.waiting ? sig(ICON.wait, `${m.waiting} waiting on ${m.name}`, '', String(m.waiting)) : ''}</span></li>`).join('')}</ul>`
      : b.team.length ? '<p class="soft">Nothing open with anyone.</p>'
      : `<p class="soft">No people yet. Add them in <button class="lnk" data-open="prioritizer" data-path="people">Docket, People</button>.</p>`}
  </section>`;

  return head + tiles + `<div class="cols">${next}<div class="stack">${nowCard(v.dayNow)}${team}${agentsCard(v.agents)}</div></div>`;
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
