/* Home, the Needs you panel: the rows and the HTML. Pure functions with no DOM or SDK, so Node tests can import
   them. Home reads other apps only through their summaries (docs/summaries.md) and never their own collections
   or code. */

const pad = n => String(n).padStart(2, '0');
export const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/* Symbols, in the same line style as Docket's rows: color only when something needs you. */
const svg = (d, w = 1.5) => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON = {
  ring: svg('<circle cx="10" cy="10" r="6.5"/><path d="M10 3.5a6.5 6.5 0 0 1 6.5 6.5H10z" fill="currentColor" stroke="none"/>'),
  doc: svg('<path d="M5.5 2.8h6l3.5 3.5v10.9H5.5z"/><path d="M11.5 2.8v3.5H15M8 10h5M8 13h5"/>'),
  dots: '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="10" r="1.4"/><circle cx="10" cy="10" r="1.4"/><circle cx="15" cy="10" r="1.4"/></svg>'
};
/* From the opencode connector's `state` result: prompts waiting for you, and sessions working. */
export function agentCounts(state) {
  const live = state && state.liveMode && state.liveMode.live;
  if (!live) return { needYou: 0, working: 0 };
  const needYou = (live.permissions || []).length + (live.questions || []).length;
  const working = Object.values(live.sessions || {}).filter(s => s && s.status && s.status !== 'idle').length;
  return { needYou, working };
}

/* Docket's `board` card entry for today (docs/summaries.md): Get started counts its tasks. */
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
 * to "N held until 12:00"; during lunch and Day's done everything folds ("held until morning" in the evening).
 * Outside a block (or with focus hours off): the rows.
 * focus: resolveFocus() or null. blocking: Docket's `blocking` rows as inbox rows.
 */
export function heldInbox(rows, focus, blocking = []) {
  const state = focus && focus.state;
  if (state !== 'focus' && state !== 'lunch' && state !== 'dayDone') return { rows, held: 0, until: '' };
  const until = (focus.span ? focus.span.end : focus.until) || '';
  if (state !== 'focus') return { rows: [], held: rows.length + blocking.length, until };
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
  const heldLine = held ? `<p class="soft held-line">${plural(held, 'item')} held until ${until ? esc(fmtUntil(until)) : 'morning'}.</p>` : '';
  if (focus && (focus.state === 'focus' || focus.state === 'lunch' || focus.state === 'dayDone') && !rows.length) {
    return `<section class="card inbox"><div class="ch"><h2>Needs you</h2></div>${heldLine || `<p class="soft">Nothing needs you right now.</p>`}</section>`;
  }
  return `<section class="card inbox"><div class="ch"><h2>Needs you</h2></div>${heldLine}
    ${rows.length ? `<ul class="inbox-list">${rows.map(r => `<li><button class="irow${r.flag ? ' ' + r.flag : ''}" data-open="${esc(r.app)}"${r.route ? ` data-path="${esc(r.route)}"` : ''}>
      <span class="iapp">${esc(r.appName)}</span><span class="it">${esc(r.title)}</span>${r.note ? `<span class="in">${esc(r.note)}</span>` : ''}</button></li>`).join('')}</ul>`
      : '<p class="soft">Nothing needs you right now.</p>'}
  </section>`;
}

/* The panel (Home 4.0.0, docs/app-manifest.md panel): what needs you across apps, what is coming up and what you
   finished this week, opened from the top bar on every app. It shows and links; work happens in each app. `v` is
   {now, inbox, blocking, focus, upcoming, week, waiting, embedded}: inbox = inboxRows(); waiting = true while the
   browser's folder store needs Allow (data.js); embedded = inside the shell. */
export function render(v) {
  // Weekly status as a labeled button on Friday afternoons; otherwise it is in the More menu (with Get started).
  const friday = v.now.getDay() === 5 && v.now.getHours() >= 12;
  const more = `<details class="hmore" data-more><summary class="hbtn" aria-label="More" title="More">${ICON.dots}</summary>
      <div class="hmenu" role="menu"><button class="mi" role="menuitem" data-status>${ICON.doc}Weekly status</button></div></details>`;
  const head = `<header class="hello">
    <div class="who"><p class="meta">${v.now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p></div>
    ${v.waiting ? '' : `<div class="htools">${friday ? `<button class="btn" data-status>${ICON.doc}Weekly status</button>` : ''}${more}</div>`}
  </header>`;
  if (v.waiting) return head + waitingCard(v.embedded);
  const today = dateStr(v.now);
  return head + `<div class="dash cols">${inboxCard(v.inbox || [], v.focus, v.blocking || [])}${upcomingCard(v.upcoming, today)}${weekCard(v.week)}</div>`;
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

/* Shown instead of the page while Chrome must be asked again for the data folder. Same words as Prioritizer. */
export function waitingCard(embedded) {
  return `<section class="card note waiting" role="status"><h2>Allow Workshop to use your folder to see your day</h2>
    <p>${embedded ? 'Click <b>Allow</b> in the bar at the top of Workshop. Chrome asks again after it restarts.'
      : 'Open Workshop and click <b>Allow</b> in the bar at the top. Chrome asks again after it restarts.'}</p>
    ${embedded ? '' : '<p><button class="btn primary" data-open="home">Open Workshop</button></p>'}</section>`;
}
