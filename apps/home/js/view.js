/* Home: the numbers and the HTML. Pure functions with no DOM or SDK, so Node tests can import them.
   Home reads other apps' data read-only (docs/sdk.md, ws.data.get with {app}). It does not import
   their code (docs/app-manifest.md, Rules), so the few Prioritizer rules it needs are repeated here
   and named after the function they mirror in Docket's js/model.js (adavidson21/docket). */

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
  unassigned: svg('<circle cx="8" cy="7" r="2.8"/><path d="M3 16c.8-2.6 2.7-4 5-4 1 0 1.9.3 2.7.8M14.5 11.5a1.8 1.8 0 1 1 1.8 2c-.5.2-.8.6-.8 1.2M15.5 17.2v.1"/>'),
  stale: svg('<path d="M3.5 10a6.5 6.5 0 1 0 2-4.7"/><path d="M3.2 3.3v3.2h3.2"/><path d="M10 6.5V10l2.3 1.6"/>'),
  changed: svg('<path d="M4 10a6 6 0 0 1 10.3-4.2M16 10a6 6 0 0 1-10.3 4.2"/><path d="M14.6 2.8v3.3h-3.3M5.4 17.2v-3.3h3.3"/>'),
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
    .map(t => ({ id: t.id, title: t.title, list: lists.length > 1 ? listName.get(t.listId) : '', listId: t.listId, due: isDate(t.due) ? t.due : null, people: Array.isArray(t.people) ? t.people : [], triaged: isTriaged(t) }));
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

/* From the Queue app's collections (queue.settings, queue.snapshot, queue.seen, all version 1; see
   apps/queue/README.md): items nobody owns, stale items, and items assigned to you that changed in ADO since
   you last opened them. null until the queue has area paths, so Home shows no card for an unused Queue.
   Mirrors isMine and isStale in apps/queue/js/model.js. */
export const QUEUE_VERSION = 1;
export function queueSummary({ settings, snapshot, seen }, now) {
  const ok = e => e && e.version === QUEUE_VERSION;
  const m = ok(settings) && settings.meta || {};
  if (!Array.isArray(m.areas) || !m.areas.length) return null;
  const items = ok(snapshot) && Array.isArray(snapshot.items) ? snapshot.items : [];
  const sm = ok(snapshot) && snapshot.meta || {};
  const meEmail = String(m.meEmail || (sm.me && sm.me.email) || '').toLowerCase();
  const meName = m.meEmail ? '' : String((sm.me && sm.me.name) || '');
  const revs = new Map((ok(seen) && Array.isArray(seen.items) ? seen.items : []).map(x => [String(x.id), Number(x.rev) || 0]));
  const staleDays = Number.isInteger(m.staleDays) && m.staleDays >= 1 && m.staleDays <= 90 ? m.staleDays : 7;
  const mine = i => i.assignee && ((meEmail && String(i.assignee.email || '').toLowerCase() === meEmail) || (!meEmail && meName && i.assignee.name === meName));
  const stale = i => { const t = Date.parse(i.changed || ''); return Number.isFinite(t) && Math.floor((now - t) / 864e5) >= staleDays; };
  return {
    fetchedAt: sm.fetchedAt || null,
    total: items.length,
    unassigned: items.filter(i => !i.assignee).length,
    stale: items.filter(stale).length,
    changedMine: items.filter(i => mine(i) && revs.has(String(i.id)) && revs.get(String(i.id)) < i.rev).length
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

/* ---------- Day plan: the block on now ----------
   Docket's Day view rules, repeated here (Home does not import Docket's code). Each mirrors the function of the
   same name in Docket's js/dayplan-model.js. dayplan collections are read only at version 1. */
export const DAYPLAN_VERSION = 1;
const isTime = s => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const toMin = s => isTime(s) ? +s.slice(0, 2) * 60 + +s.slice(3) : null;
const pad2 = n => String(n).padStart(2, '0');
const fromMin = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`; };
function cleanSprint(sp) {
  const o = Object.assign({}, sp);
  if (!isDate(o.anchor)) return null;
  o.lengthWeeks = Number.isInteger(+o.lengthWeeks) && +o.lengthWeeks >= 1 && +o.lengthWeeks <= 8 ? +o.lengthWeeks : 2;
  o.workdays = Array.isArray(o.workdays) && o.workdays.length ? o.workdays.map(Number) : [1, 2, 3, 4, 5];
  o.holidays = Array.isArray(o.holidays) ? o.holidays.filter(isDate) : [];
  return o;
}
const isWorkday = (sp, d) => sp.workdays.includes(parseD(d).getDay()) && !sp.holidays.includes(d);
function sprintInfo(sp, date) {
  const len = sp.lengthWeeks * 7, idx = Math.floor(daysBetween(sp.anchor, date) / len), start = addDays(sp.anchor, idx * len);
  let total = 0, day = null;
  for (let d = start, end = addDays(start, len - 1); d <= end; d = addDays(d, 1)) { if (!isWorkday(sp, d)) continue; total++; if (d === date) day = total; }
  return { day, total, last: day != null && day === total };
}
function templateFor(templates, info) {
  if (info.day == null) return null;
  const lasts = info.last ? templates.filter(t => t && t.last) : [];
  const pool = lasts.length ? lasts : templates.filter(t => t && Array.isArray(t.days) && t.days.includes(info.day));
  return pool[0] || null;
}
function currentSection(sections, nowMin) {
  const timed = sections.filter(s => s && !s.lost && isTime(s.around)).map(s => ({ s, at: toMin(s.around) })).sort((a, b) => a.at - b.at);
  let cur = null, next = null, curEnd = null;
  for (let i = 0; i < timed.length; i++) {
    const end = timed[i].s.minutes ? timed[i].at + timed[i].s.minutes : (timed[i + 1] ? timed[i + 1].at : timed[i].at + 60);
    if (nowMin >= timed[i].at && nowMin < end) { cur = timed[i].s; curEnd = end; next = timed[i + 1] ? timed[i + 1].s : null; break; }
    if (nowMin < timed[i].at) { next = timed[i].s; break; }
  }
  return { current: cur, next, end: curEnd };
}

/* Wrap up, from Docket's focus log (js/focus-model.js) and Day view settings: whether the day is wrapped, whether
   it is time (an hour before the Day view's day end on a working day; 15:00 with no sprint set), and how many
   receipts were offered today (prioritizer.handoffs). day: today's focus/days record or null; settings and offers:
   envelopes at version 1, or null. */
export function wrapState({ day = null, settings = null, offers = null }, today, nowMin) {
  const sp = cleanSprint(settings && settings.meta && settings.meta.sprint);
  const end = sp ? toMin(settings.meta.sprint.dayEnd) ?? 17 * 60 : null;
  const events = day && Array.isArray(day.events) ? day.events : [];
  return {
    wrapped: events.some(e => e && e.type === 'shutdown'),
    due: sp ? isWorkday(sp, today) && nowMin >= end - 60 : nowMin >= 15 * 60,
    receipts: (offers && Array.isArray(offers.items) ? offers.items : []).filter(h => h && h.to === 'receipts' && h.date === today).length
  };
}

/* The block on now and the next one, from Docket's day plan. `day` is {settings, templates, days} (envelopes or
   null). Returns null when there is nothing to show: no sprint set, a day off, or the day's blocks are over. */
export function dayNow(day, tasks, now) {
  if (!day) return null;
  const sp = cleanSprint(day.settings && day.settings.meta && day.settings.meta.sprint);
  if (!sp) return null;
  const today = dateStr(now);
  const rec = (day.days && day.days.items || []).find(r => r && r.id === today);
  let sections;
  if (rec) sections = Array.isArray(rec.sections) ? rec.sections : [];
  else {
    const info = sprintInfo(sp, today);
    const t = templateFor(day.templates && day.templates.items || [], info);
    sections = t && Array.isArray(t.sections) ? t.sections.map(s => Object.assign({}, s, { lost: false })) : [];
  }
  const { current, next, end } = currentSection(sections, now.getHours() * 60 + now.getMinutes());
  if (!current && !next) return null;
  const byId = new Map(tasks.map(t => [t.id, t]));
  const slots = rec && Array.isArray(rec.slots) ? rec.slots : [];
  const inBlock = sec => sec ? slots.filter(s => s.sectionId === sec.id && byId.has(s.taskId)).map(s => byId.get(s.taskId))
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)).map(t => ({ id: t.id, title: t.title, done: !!t.done })) : [];
  const brief = sec => sec ? { name: sec.name || 'Untitled', at: sec.around, tasks: inBlock(sec) } : null;
  return { current: current ? Object.assign(brief(current), { until: fromMin(end) }) : null, next: brief(next) };
}

function nowCard(n) {
  if (!n) return '';
  const rows = list => list.length ? `<ul class="blk">${list.slice(0, 5).map(t => `<li><button class="nrow${t.done ? ' done' : ''}" data-task="${esc(t.id)}"><span class="tt">${esc(t.title)}</span></button></li>`).join('')}</ul>` : '';
  const c = n.current;
  const body = c
    ? `<p class="blkname"><b>${esc(c.name)}</b> <span class="soft mono">until ${esc(c.until)}</span></p>${rows(c.tasks) || '<p class="soft">Nothing planned in this block.</p>'}
       ${n.next ? `<p class="soft">Next: ${esc(n.next.name)} at ${esc(n.next.at)}</p>` : ''}`
    : `<p class="blkname"><b>${esc(n.next.name)}</b> <span class="soft mono">at ${esc(n.next.at)}</span></p>${rows(n.next.tasks)}`;
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

/* The whole page. `v` is {now, profile, board, boardNote, agents, waiting, embedded}:
   profile {name, role}; board = summarize() or null; boardNote = why there is no board (string) or '';
   agents = {state: 'ready' | 'off' | 'browser' | 'loading', needYou, working, message};
   waiting = true while the browser's folder store needs Allow (data.js); embedded = inside the shell. */
export function render(v) {
  const today = dateStr(v.now);
  const p = v.profile || {};
  const name = (p.name || '').trim(), role = (p.role || '').trim();
  const b = v.board && v.board.total ? v.board : null;
  // The day's actions are round icons in the header: plan the day, then wrap up (the primary one from an hour
  // before the Day view's day end, wrapState; a check once wrapped). Triage is its tile.
  const w = v.wrap || { wrapped: false, due: v.now.getHours() >= 15, receipts: 0 };
  const offered = w.receipts ? ` ${plural(w.receipts, 'receipt')} offered to Receipts today.` : '';
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
    return head + `<section class="card note"><h2>Docket</h2><p>${esc(v.boardNote || 'Loading your board.')}</p></section>` + queueCard(v.queue) + agentsCard(v.agents);
  }
  if (!b) {
    return head + `<section class="card note"><h2>No tasks yet</h2><p>Add a few in Docket and they show up here.</p>
      <p><button class="btn primary" data-open="prioritizer">Open Docket</button></p></section>` + queueCard(v.queue) + agentsCard(v.agents);
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

  return head + tiles + `<div class="cols">${next}<div class="stack">${nowCard(v.dayNow)}${team}${queueCard(v.queue)}${agentsCard(v.agents)}</div></div>`;
}

/* Shown instead of the page while Chrome must be asked again for the data folder. Same words as Prioritizer. */
export function waitingCard(embedded) {
  return `<section class="card note waiting" role="status"><h2>Allow Workshop to use your folder to see your day</h2>
    <p>${embedded ? 'Click <b>Allow</b> in the bar at the top of Workshop. Chrome asks again after it restarts.'
      : 'Open Workshop and click <b>Allow</b> in the bar at the top. Chrome asks again after it restarts.'}</p>
    ${embedded ? '' : '<p><button class="btn primary" data-open="home">Open Workshop</button></p>'}</section>`;
}

const pill = (icon, n, label, tone, app) => `<button class="pill${n ? ' ' + tone : ' zero'}" data-open="${app}" aria-label="${n} ${esc(label)}" title="${esc(label)}">${icon}<b class="num">${n}</b></button>`;
/* The Queue card: read-only counts from the queue's last refresh, as icon pills. Clicking opens the Queue. */
export function queueCard(q) {
  if (!q) return '';
  const calm = q.fetchedAt && !q.unassigned && !q.stale && !q.changedMine;
  const body = !q.fetchedAt ? '<p class="soft">Open the Queue to load your team\'s items.</p>'
    : `<div class="pills">${pill(ICON.unassigned, q.unassigned, 'Unassigned', 'warn', 'queue')}${pill(ICON.stale, q.stale, 'Stale', 'quiet', 'queue')}${pill(ICON.changed, q.changedMine, 'Yours, changed', 'acc', 'queue')}${calm ? `<span class="calm" title="Nothing to act on">${ICON.check}</span>` : ''}</div>`;
  return `<section class="card"><div class="ch"><h2>Queue</h2><button class="lnk" data-open="queue">Open</button></div>${body}</section>`;
}

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
