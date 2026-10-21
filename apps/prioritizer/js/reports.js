import { ADO_DOWN, adoCall, adoSetup, adoSync, adoUnreachable } from './ado.js';
import { ICON } from './constants.js';
import { NO_XLSX } from './excel.js';
import { kvGet, kvSet } from './kv.js';
import { closeModal, showModal, toast } from './overlays.js';
import { main, render, setView } from './render.js';
import { saveUi, state, ui } from './state.js';
import { $, esc, fmtMD, plural, todayStr } from './util.js';
/* Prioritizer: Reports: team-wide ADO reports from one read-only pull, with Excel export. */
/* ---------- reports: team-wide ADO reports from one read-only pull ----------
   The ADO helper's /dataset returns the team's work items plus their priority, sprint, assignment and state
   changes in a window, and sprint dates. Every report below is computed here from that one pull, so a new
   report only needs a compute block, a render block and (optionally) an export sheet. The team profile
   (area paths, people) lives in ui.rp on this device; the last pull is cached in IndexedDB. */
const RP_TABS = [['churn', 'Priority churn'], ['other', "Other teams' work"], ['carry', 'Sprint carryover'],
  ['scope', 'Sprint scope churn'], ['load', 'Load by person'], ['aging', 'Aging and throughput']];
const RP_DAYS = [14, 30, 42, 60, 90, 120, 180];
const RP_OLD = 'Your ADO helper is out of date. Download the new ado_helper.py from ADO Settings and restart it.';
let rp = {data: null, busy: false, error: '', calc: null};
// Report settings and the last pulled data. Called by main.js once every module has loaded.
function rpInit(){
  ui.rp = Object.assign({days: 42, base: '', areas: '', people: '', tab: 'churn'}, ui.wl || {}, ui.rp || {});
  delete ui.wl;
  kvGet('reports').then(d => { if (d && d.schema === 1 && !rp.data){ rp.data = d; if (state.view === 'reports') render(); } }).catch(() => {});
}
const rpLines = v => String(v || '').split(/\r?\n|;/).map(x => x.trim()).filter(Boolean);
const rpHasProfile = () => !!(rpLines(ui.rp.areas).length || rpLines(ui.rp.people).length);
const DAY_MS = 864e5;
const dOnly = s => String(s || '').slice(0, 10);
const daysSince = s => s ? Math.max(0, Math.floor((Date.now() - Date.parse(dOnly(s) + 'T12:00:00')) / DAY_MS)) : null;
const daysApart = (a, b) => a && b ? Math.max(0, Math.round((Date.parse(dOnly(b)) - Date.parse(dOnly(a))) / DAY_MS)) : null;
const sprintName = p => String(p || '').split('\\').slice(1).join('\\') || p || '(none)';
const whoName = w => w ? (w.name || w.email || 'Someone') : 'Unassigned';
const countBy = (arr, f) => { const m = new Map(); arr.forEach(x => { const k = f(x); m.set(k, (m.get(k) || 0) + 1); }); return [...m].sort((a, b) => b[1] - a[1]); };

function rpCompute(d){
  if (rp.calc && rp.calc.key === d.generatedAt) return rp.calc;
  const cfg = d.config, top = cfg.escalationPriority, high = new Set(cfg.highPriorities);
  const closedSet = new Set(cfg.closedStates.concat(cfg.removedStates));
  const areas = (d.areas || []).map(a => a.toLowerCase()), ppl = (d.people || []).map(p => p.toLowerCase());
  const inAreas = a => { a = String(a || '').toLowerCase(); return areas.some(x => a === x || a.startsWith(x + '\\')); };
  const isTeam = w => !!w && ppl.some(p => p === String(w.email || '').toLowerCase() || p === String(w.name || '').toLowerCase());
  const byId = new Map(d.items.map(i => [i.id, i]));
  const item = id => byId.get(id) || {id, title: `#${id}`, url: '', area: '', priority: null, state: '', type: ''};
  const ev = k => d.events.filter(e => e.kind === k);
  const today = todayStr(), weeks = d.days / 7, nWeeks = Math.ceil(d.days / 7);
  const weekOf = s => Math.min(nWeeks - 1, Math.floor(daysSince(s) / 7));   // 0 = this week
  const perWeek = list => { const a = Array(nWeeks).fill(0); list.forEach(e => a[weekOf(e.date)]++); return a.reverse(); };
  const weekLabels = [...Array(nWeeks)].map((_, i) => fmtMD(new Date(Date.now() - ((nWeeks - 1 - i) * 7 + 6) * DAY_MS)));
  const isOpen = i => !closedSet.has(i.state);
  const open = d.items.filter(isOpen);

  // priority churn
  const pcs = ev('priority').map(e => ({...e, it: item(e.id), raised: e.to < e.from, esc: e.to === top && e.from > top})).reverse();
  const escs = pcs.filter(e => e.esc).map(e => ({...e, waited: daysApart(e.it.created, e.date)}));
  const waits = escs.map(e => e.waited).filter(n => n != null);
  const churn = {list: pcs, escs, perWeek: perWeek(pcs), byWho: countBy(pcs, e => e.by || 'Unknown'),
    rate: pcs.length / weeks, avgWait: waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0,
    raised: pcs.filter(e => e.raised).length};

  // other teams' work: assigned to your people, outside your area paths
  const canOther = !!(areas.length && ppl.length);
  const touched = new Map();
  if (canOther){
    d.items.forEach(i => { if (!inAreas(i.area) && isTeam({name: i.assignedTo, email: i.assignedEmail})) touched.set(i.id, 'Assigned now'); });
    ev('assigned').forEach(e => { const i = item(e.id); if (!inAreas(i.area) && isTeam(e.to) && !touched.has(e.id)) touched.set(e.id, 'Assigned in window'); });
  }
  const otherList = [...touched].map(([id, how]) => {
    const i = item(id), up = pcs.filter(p => p.id === id && p.raised);
    const firstSeen = ev('assigned').find(e => e.id === id && isTeam(e.to));
    return {...i, how, escalated: up.some(p => p.esc), raisedBy: up.length ? up[up.length - 1].by : '', since: firstSeen ? dOnly(firstSeen.date) : ''};
  }).sort((a, b) => (b.escalated - a.escalated) || ((a.priority || 9) - (b.priority || 9)));
  const other = {can: canOther, list: otherList, byArea: countBy(otherList, i => i.area || 'Unknown'),
    open: otherList.filter(isOpen).length, escalated: otherList.filter(i => i.escalated).length,
    hours: otherList.filter(i => i.effortField === 'RemainingWork').reduce((a, i) => a + (+i.effort || 0), 0)};

  // sprint carryover
  const moves = new Map();
  ev('iteration').forEach(e => { if (!moves.has(e.id)) moves.set(e.id, []); moves.get(e.id).push(e); });
  const carryList = [...moves].map(([id, ms]) => ({...item(id), moves: ms.length,
    path: [ms[0].from, ...ms.map(m => m.to)].map(sprintName).join(' > '), last: dOnly(ms[ms.length - 1].date), lastBy: ms[ms.length - 1].by}))
    .sort((a, b) => b.moves - a.moves || b.last.localeCompare(a.last));
  const stuck = open.filter(i => d.iterations[i.iteration] && d.iterations[i.iteration].finish < today);
  const carry = {list: carryList, multi: carryList.filter(i => i.moves > 1).length, stuck,
    moves: ev('iteration').length, perWeek: perWeek(ev('iteration'))};

  // sprint scope churn: added or removed after a sprint started, and assignment changes
  const sprints = Object.entries(d.iterations || {}).map(([path, s]) => ({path, ...s}))
    .filter(s => s.finish >= d.since && s.start <= today).sort((a, b) => a.start.localeCompare(b.start));
  const inSprint = (date, s) => dOnly(date) > s.start && dOnly(date) <= s.finish;
  const sprintAt = date => sprints.find(s => inSprint(date, s));
  const assignDir = e => ppl.length
    ? (isTeam(e.to) && isTeam(e.from) ? 'Swapped within team' : isTeam(e.to) ? 'Pulled onto team' : isTeam(e.from) ? 'Pulled off team' : null)
    : (e.to && !e.from ? 'Assigned' : e.from && !e.to ? 'Unassigned' : 'Reassigned');
  const assigns = ev('assigned').map(e => ({...e, it: item(e.id), dir: assignDir(e)})).filter(e => e.dir).reverse();
  const onto = new Set(['Pulled onto team', 'Assigned']), off = new Set(['Pulled off team', 'Unassigned']);
  const changes = [];
  ev('iteration').forEach(e => sprints.forEach(s => {
    if (e.to === s.path && inSprint(e.date, s)) changes.push({...e, it: item(e.id), sprint: s.path, change: 'Added mid-sprint'});
    if (e.from === s.path && inSprint(e.date, s)) changes.push({...e, it: item(e.id), sprint: s.path, change: 'Removed mid-sprint'});
  }));
  ev('created').forEach(e => sprints.forEach(s => {
    if (e.iteration === s.path && inSprint(e.date, s)) changes.push({...e, by: e.by || item(e.id).createdBy || '', it: item(e.id), sprint: s.path, change: 'Created mid-sprint'});
  }));
  changes.sort((a, b) => b.date.localeCompare(a.date));
  const sprintRows = sprints.map(s => ({...s,
    added: changes.filter(c => c.sprint === s.path && c.change !== 'Removed mid-sprint').length,
    removed: changes.filter(c => c.sprint === s.path && c.change === 'Removed mid-sprint').length,
    onto: assigns.filter(a => onto.has(a.dir) && inSprint(a.date, s)).length,
    off: assigns.filter(a => off.has(a.dir) && inSprint(a.date, s)).length}));
  const scope = {sprints: sprintRows, changes, assigns, sprintAt,
    added: sprintRows.reduce((a, s) => a + s.added, 0), removed: sprintRows.reduce((a, s) => a + s.removed, 0),
    onto: assigns.filter(a => onto.has(a.dir)).length, off: assigns.filter(a => off.has(a.dir)).length};

  // load by person
  const people = new Map();
  open.forEach(i => {
    const k = i.assignedTo || 'Unassigned';
    if (!people.has(k)) people.set(k, {name: k, team: isTeam({name: i.assignedTo, email: i.assignedEmail}), p: [0, 0, 0, 0, 0], hours: 0, oldest: 0, total: 0});
    const r = people.get(k), pr = i.priority >= 1 && i.priority <= 4 ? i.priority - 1 : 4;
    r.p[pr]++; r.total++; r.oldest = Math.max(r.oldest, daysSince(i.created) || 0);
    if (i.effortField === 'RemainingWork') r.hours += +i.effort || 0;
  });
  ppl.forEach(p => {   // profile people with nothing open still show, so free capacity is visible
    const hit = [...people.values()].some(r => r.team && (r.name.toLowerCase() === p || open.some(i => i.assignedTo === r.name && String(i.assignedEmail).toLowerCase() === p)));
    if (!hit) people.set(p, {name: p, team: true, p: [0, 0, 0, 0, 0], hours: 0, oldest: 0, total: 0});
  });
  const loadRows = [...people.values()].sort((a, b) => (a.name === 'Unassigned') - (b.name === 'Unassigned')
    || (b.p[0] + b.p[1]) - (a.p[0] + a.p[1]) || b.total - a.total);
  const load = {rows: loadRows, max: Math.max(1, ...loadRows.map(r => r.total))};

  // aging high-priority + throughput vs high-priority inflow
  const hp = open.filter(i => high.has(i.priority)).map(i => ({...i, age: daysSince(i.created)})).sort((a, b) => b.age - a.age);
  const buckets = [['Under 7 days', 0, 6], ['7 to 30 days', 7, 30], ['31 to 90 days', 31, 90], ['Over 90 days', 91, 1e9]]
    .map(([l, a, b]) => [l, hp.filter(i => i.age >= a && i.age <= b).length]);
  const closedEv = ev('state').filter(e => cfg.closedStates.includes(e.to));
  const inflowEv = ev('created').filter(e => high.has(e.priority)).concat(pcs.filter(e => high.has(e.to) && !high.has(e.from)));
  const aging = {hp, buckets, closed: perWeek(closedEv), inflow: perWeek(inflowEv),
    closedRate: closedEv.length / weeks, inflowRate: inflowEv.length / weeks,
    hours: hp.filter(i => i.effortField === 'RemainingWork').reduce((a, i) => a + (+i.effort || 0), 0),
    noHours: hp.filter(i => i.effortField !== 'RemainingWork').length};

  const bugs = d.items.filter(i => cfg.bugTypes.includes(i.type) && i.created && i.created >= d.since).sort((a, b) => b.created.localeCompare(a.created));
  rp.calc = {key: d.generatedAt, weeks, weekLabels, churn, other, carry, scope, load, aging, bugs, top, high: [...high].sort()};
  return rp.calc;
}

/* rendering */
const rpLink = i => i.url ? `<a class="lnk" href="${esc(i.url)}" target="_blank" rel="noopener">#${i.id}</a>` : `#${i.id}`;
const rpKpi = (n, l) => `<div class="wl-kpi"><b>${n}</b><span>${l}</span></div>`;
const rpOne = n => Math.round(n * 10) / 10;
const RP_ROWS = 150;
function rpTable(heads, rows){
  const more = rows.length > RP_ROWS ? `<p class="hint">Showing ${RP_ROWS} of ${rows.length}. Export to Excel for all of them.</p>` : '';
  return `<div class="rp-scroll"><table class="rp-table"><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.slice(0, RP_ROWS).join('') || `<tr><td colspan="${heads.length}" class="rp-none">Nothing in this window.</td></tr>`}</tbody></table></div>${more}`;
}
function rpBars(rows, max, label){   // rows: [label, [[value, cls], ...], tail]
  if (!rows.length) return '';
  return `<div class="rp-bars" role="img" aria-label="${esc(label)}">${rows.map(([l, parts, tail]) => {
    const tot = parts.reduce((a, p) => a + p[0], 0);
    return `<div class="rp-bar"><span class="l" title="${esc(l)}">${esc(l)}</span><span class="track">${parts.filter(p => p[0]).map(([v, c]) =>
      `<i class="${c}" style="width:${v / max * 100}%"></i>`).join('')}</span><span class="v num">${tail ?? tot}</span></div>`;
  }).join('')}</div>`;
}
function rpCols(series, labels, label){   // series: [[values, cls, name], ...]
  const max = Math.max(1, ...series.flatMap(s => s[0]));
  return `<div class="rp-cols" role="img" aria-label="${esc(label)}">${labels.map((l, i) => `<div class="rp-col" title="Week of ${esc(l)}: ${series.map(s => `${s[2]} ${s[0][i]}`).join(', ')}">
      <div class="stack">${series.map(s => `<i class="${s[1]}" style="height:${s[0][i] / max * 100}%"></i>`).join('')}</div><span>${esc(l)}</span></div>`).join('')}</div>
    ${series.length > 1 ? `<div class="rp-legend">${series.map(s => `<span><i class="${s[1]}"></i>${esc(s[2])}</span>`).join('')}</div>` : ''}`;
}
const rpSection = (title, body, note) => `<section class="rp-sec"><h3>${title}</h3>${note ? `<p class="soft rp-note">${note}</p>` : ''}${body}</section>`;
const rpInsight = t => t ? `<p class="insight rp-insight">${t}</p>` : '';
const rpCard = (title, text, acts) => `<div class="engcard"><h2>${title}</h2><p>${text}</p><div class="acts">${acts}</div></div>`;

function renderReports(){
  if (!ui.ado.on){ main.innerHTML = rpCard('Reports need Azure DevOps', 'Reports read your team\'s work items through the same local ADO helper as your ADO list. Connect it first.', '<button class="btn primary" data-rp="connect">Connect ADO</button>'); return; }
  if (!rpHasProfile()){ main.innerHTML = rpCard('Set up your team profile', 'Tell Reports which area paths and people make up your team. Every report uses this profile, and you can change it any time.', '<button class="btn primary" data-rp="profile">Set up team profile</button>'); return; }
  if (!rp.data){ main.innerHTML = rpCard(rp.busy ? 'Reading ADO history...' : 'No report data yet', rp.busy ? 'This can take a minute for a big team.' : esc(rp.error || 'Pull your team\'s data from ADO to see the reports.'),
    `<button class="btn primary" data-rp="refresh"${rp.busy ? ' disabled' : ''}>${rp.busy ? 'Refreshing...' : 'Pull data'}</button><button class="btn" data-rp="profile">Team profile</button>`); return; }
  const d = rp.data, c = rpCompute(d), tab = RP_TABS.some(t => t[0] === ui.rp.tab) ? ui.rp.tab : 'churn';
  const tabs = `<div class="lens rp-tabs" role="tablist" aria-label="Report">${RP_TABS.map(([k, n]) => `<button data-rp="tab" data-tab="${k}" role="tab" aria-selected="${k === tab}"${k === tab ? ' class="on"' : ''}>${n}</button>`).join('')}</div>`;
  const warn = d.truncated ? `<p class="hint">Only the ${d.scanned} most recently changed items were checked for history. Narrow the profile or window for full counts.</p>` : '';
  main.innerHTML = `<div class="reports">${tabs}${warn}${RP_RENDER[tab](c, d)}</div>`;
  const on = main.querySelector('.rp-tabs .on'), bar = on && on.parentElement;
  if (bar && bar.scrollWidth > bar.clientWidth) bar.scrollLeft = on.offsetLeft - (bar.clientWidth - on.offsetWidth) / 2;
}
const RP_RENDER = {
  churn(c){
    const h = c.churn, topWho = h.byWho[0];
    return `<div class="wl-kpis">${rpKpi(h.list.length, 'priority changes')}${rpKpi(rpOne(h.rate), 'per week')}${rpKpi(h.raised, 'raised')}
        ${rpKpi(h.escs.length, `escalated to P${c.top}`)}${rpKpi(Math.round(h.avgWait), 'avg days before escalation')}</div>
      ${rpInsight(h.list.length ? `Priorities changed ${plural(h.list.length, 'time')} in ${rpOne(c.weeks)} weeks, about ${rpOne(h.rate)} per week.${topWho ? ` ${esc(topWho[0])} made ${topWho[1]} of them.` : ''}${h.escs.length && h.avgWait >= 7 ? ` Escalated items sat ${Math.round(h.avgWait)} days on average first, which points to a prioritization gap rather than an execution gap.` : ''}` : '')}
      ${rpSection('Changes per week', rpCols([[h.perWeek, 's-a', 'Changes']], c.weekLabels, 'Priority changes per week'))}
      ${rpSection('Who changed priorities', rpBars(h.byWho.slice(0, 8).map(([n, v]) => [n, [[v, 's-a']]]), h.byWho.length ? h.byWho[0][1] : 1, 'Priority changes by person'))}
      ${rpSection('All changes', rpTable(['Date', 'Item', 'Title', 'Change', 'By'], h.list.map(e => `<tr><td class="num">${dOnly(e.date)}</td><td>${rpLink(e.it)}</td><td class="t">${esc(e.it.title)}</td>
        <td class="num">P${e.from} to P${e.to}${e.esc ? ' <span class="rp-tag">escalation</span>' : ''}</td><td>${esc(e.by)}</td></tr>`)))}`;
  },
  other(c){
    const o = c.other;
    if (!o.can) return rpCard("Needs area paths and people", "This report finds work assigned to your people that lives outside your area paths. Add both to your team profile.", '<button class="btn primary" data-rp="profile">Team profile</button>');
    const max = o.byArea.length ? o.byArea[0][1] : 1;
    return `<div class="wl-kpis">${rpKpi(o.list.length, 'items from other teams')}${rpKpi(o.open, 'still open')}${rpKpi(o.escalated, `escalated to P${c.top}`)}${rpKpi(Math.round(o.hours), 'hours remaining')}</div>
      ${rpInsight(o.list.length ? `Your team picked up ${plural(o.list.length, 'item')} owned by other teams in ${rpOne(c.weeks)} weeks${o.escalated ? `, ${o.escalated} of them escalated to P${c.top}` : ''}. Work with no ticket won't show here, so add it to the Out-of-Scope tab in the export.` : '')}
      ${rpSection('By owning area', rpBars(o.byArea.map(([a, v]) => [a, [[v, 's-a']]]), max, 'Other teams\' items by area'))}
      ${rpSection('Items', rpTable(['Item', 'Title', 'Owning area', 'Assigned to', 'Priority', 'State', 'Escalated'], o.list.map(i => `<tr><td>${rpLink(i)}</td><td class="t">${esc(i.title)}</td>
        <td>${esc(i.area)}</td><td>${esc(i.assignedTo || '')}</td><td class="num">${i.priority ? 'P' + i.priority : ''}</td><td>${esc(i.state)}</td><td>${i.escalated ? `Yes${i.raisedBy ? ', by ' + esc(i.raisedBy) : ''}` : ''}</td></tr>`)))}`;
  },
  carry(c){
    const k = c.carry;
    return `<div class="wl-kpis">${rpKpi(k.list.length, 'items moved between sprints')}${rpKpi(k.moves, 'sprint moves')}${rpKpi(k.multi, 'moved 2+ times')}${rpKpi(k.stuck.length, 'open in a finished sprint')}</div>
      ${rpInsight(k.multi ? `${plural(k.multi, 'item')} bounced between sprints more than once. Repeated carryover usually means the sprint was overcommitted or reprioritized mid-flight.` : '')}
      ${rpSection('Moves per week', rpCols([[k.perWeek, 's-a', 'Moves']], c.weekLabels, 'Sprint moves per week'))}
      ${rpSection('Carried over', rpTable(['Item', 'Title', 'Moves', 'Path', 'Last moved', 'By', 'State'], k.list.map(i => `<tr><td>${rpLink(i)}</td><td class="t">${esc(i.title)}</td>
        <td class="num">${i.moves}</td><td>${esc(i.path)}</td><td class="num">${i.last}</td><td>${esc(i.lastBy)}</td><td>${esc(i.state)}</td></tr>`)))}
      ${k.stuck.length ? rpSection('Open in a finished sprint', rpTable(['Item', 'Title', 'Sprint', 'Assigned to', 'Priority'], k.stuck.map(i => `<tr><td>${rpLink(i)}</td><td class="t">${esc(i.title)}</td>
        <td>${esc(sprintName(i.iteration))}</td><td>${esc(i.assignedTo || '')}</td><td class="num">${i.priority ? 'P' + i.priority : ''}</td></tr>`))) : ''}`;
  },
  scope(c){
    const s = c.scope, team = s.assigns.some(a => /team/.test(a.dir));
    return `<div class="wl-kpis">${rpKpi(s.added, 'added after sprint start')}${rpKpi(s.removed, 'removed after sprint start')}
        ${rpKpi(s.onto, team ? 'pulled onto your team' : 'assigned')}${rpKpi(s.off, team ? 'pulled off your team' : 'unassigned')}</div>
      ${rpInsight(s.added + s.removed ? `${plural(s.added + s.removed, 'scope change')} happened after sprints had started. Each one is a commitment the team made and then had to renegotiate.` : '')}
      ${s.sprints.length ? rpSection('By sprint', rpTable(['Sprint', 'Dates', 'Added', 'Removed', team ? 'Onto team' : 'Assigned', team ? 'Off team' : 'Unassigned'], s.sprints.map(r => `<tr><td>${esc(sprintName(r.path))}</td>
        <td class="num">${fmtMD(new Date(r.start + 'T12:00'))} to ${fmtMD(new Date(r.finish + 'T12:00'))}</td><td class="num">${r.added}</td><td class="num">${r.removed}</td><td class="num">${r.onto}</td><td class="num">${r.off}</td></tr>`)), 'Changes on the sprint\'s first day count as planning and are left out.')
        : rpSection('By sprint', '<p class="soft">No sprint dates found in ADO for this window, so mid-sprint changes can\'t be told apart from planning.</p>')}
      ${rpSection('Scope changes', rpTable(['Date', 'Sprint', 'Item', 'Title', 'Change', 'By'], s.changes.map(e => `<tr><td class="num">${dOnly(e.date)}</td><td>${esc(sprintName(e.sprint))}</td>
        <td>${rpLink(e.it)}</td><td class="t">${esc(e.it.title)}</td><td>${e.change}</td><td>${esc(e.by)}</td></tr>`)))}
      ${rpSection('Assignment changes', rpTable(['Date', 'Item', 'Title', 'From', 'To', 'Change', 'By'], s.assigns.map(e => `<tr><td class="num">${dOnly(e.date)}</td><td>${rpLink(e.it)}</td>
        <td class="t">${esc(e.it.title)}</td><td>${esc(whoName(e.from))}</td><td>${esc(whoName(e.to))}</td><td>${e.dir}</td><td>${esc(e.by)}</td></tr>`)))}`;
  },
  load(c){
    const L = c.load, rows = L.rows, heavy = rows.filter(r => r.name !== 'Unassigned')[0];
    return `<div class="wl-kpis">${rpKpi(rows.reduce((a, r) => a + r.total, 0), 'open items')}${rpKpi(rows.filter(r => r.name !== 'Unassigned' && r.total).length, 'people with open work')}
        ${rpKpi((rows.find(r => r.name === 'Unassigned') || {total: 0}).total, 'unassigned')}${rpKpi(Math.round(rows.reduce((a, r) => a + r.hours, 0)), 'hours remaining')}</div>
      ${rpInsight(heavy && heavy.p[0] + heavy.p[1] ? `${esc(heavy.name)} holds the most high-priority work: ${heavy.p[0] + heavy.p[1]} P1/P2 items out of ${heavy.total} open.` : '')}
      ${rpSection('Open items by priority', rpBars(rows.map(r => [r.name, r.p.map((v, i) => [v, 'p' + (i + 1)]), r.total]), L.max, 'Open items per person by priority')
        + `<div class="rp-legend"><span><i class="p1"></i>P1</span><span><i class="p2"></i>P2</span><span><i class="p3"></i>P3</span><span><i class="p4"></i>P4</span><span><i class="p5"></i>No priority</span></div>`)}
      ${rpSection('Detail', rpTable(['Person', 'P1', 'P2', 'P3', 'P4', 'Total', 'Hours left', 'Oldest (days)'], rows.map(r => `<tr><td>${esc(r.name)}${r.team ? '' : r.name === 'Unassigned' ? '' : ' <span class="rp-tag">not in profile</span>'}</td>
        ${r.p.slice(0, 4).map(v => `<td class="num">${v || ''}</td>`).join('')}<td class="num">${r.total}</td><td class="num">${Math.round(r.hours) || ''}</td><td class="num">${r.oldest}</td></tr>`)), 'Hours count Remaining Work only, so they undercount when estimates are missing.')}`;
  },
  aging(c){
    const a = c.aging, net = a.inflowRate - a.closedRate;
    return `<div class="wl-kpis">${rpKpi(a.hp.length, `open at P${c.high.join('/P')}`)}${rpKpi(a.hp.length ? a.hp[0].age : 0, 'days, oldest')}
        ${rpKpi(rpOne(a.closedRate), 'closed per week')}${rpKpi(rpOne(a.inflowRate), 'new high-priority per week')}</div>
      ${rpInsight(a.inflowRate || a.closedRate ? (net > 0 ? `High-priority work is arriving faster than the team closes work: about ${rpOne(a.inflowRate)} new P${c.high.join('/P')} items a week against ${rpOne(a.closedRate)} closed. That gap only grows.` : `The team closes about ${rpOne(a.closedRate)} items a week against ${rpOne(a.inflowRate)} new high-priority items.`) : '')}
      ${rpSection('Closed vs new high-priority, per week', rpCols([[a.closed, 's-a', 'Closed'], [a.inflow, 's-b', 'New high-priority']], c.weekLabels, 'Throughput versus high-priority inflow'),
        'New high-priority counts items created at high priority plus items raised into it.')}
      ${rpSection('Age of open high-priority work', rpBars(a.buckets.map(([l, v]) => [l, [[v, 's-a']]]), Math.max(1, ...a.buckets.map(b => b[1])), 'Open high-priority items by age'))}
      ${rpSection('Oldest first', rpTable(['Item', 'Title', 'Priority', 'Days open', 'Assigned to', 'State', 'Sprint'], a.hp.map(i => `<tr><td>${rpLink(i)}</td><td class="t">${esc(i.title)}</td>
        <td class="num">P${i.priority}</td><td class="num">${i.age}</td><td>${esc(i.assignedTo || '')}</td><td>${esc(i.state)}</td><td>${esc(sprintName(i.iteration))}</td></tr>`)))}`;
  }
};

async function rpRefresh(){
  if (rp.busy) return;
  if (!ui.ado.on) return adoSetup();
  if (!rpHasProfile()) return rpProfile();
  rp.busy = true; rp.error = ''; render();
  try {
    const d = await adoCall('dataset', {days: ui.rp.days, base: ui.rp.base || undefined, areas: rpLines(ui.rp.areas), people: rpLines(ui.rp.people)});
    rp.data = d; rp.calc = null;
    kvSet('reports', d).catch(() => {});
    toast(`Reports updated: ${plural(d.items.length, 'work item')}, ${plural(d.events.length, 'change')}`);
  } catch(e){
    rp.error = adoUnreachable(e) ? ADO_DOWN : /Not found/.test(e.message) ? RP_OLD : e.message;
    toast(rp.error);
  } finally { rp.busy = false; render(); }
}
async function rpProfile(){
  let cols = [];
  showModal(`<div class="sheet wide" role="dialog" aria-modal="true" aria-label="Team profile"><h3>Team profile</h3>
    <p>Every report uses this profile. Area paths cover the work your team owns; people are your team members. Use both to see work your people do for other teams. Read-only: nothing is changed in ADO.</p>
    <div class="wl-form">
      <label class="full" id="rpColWrap" hidden>Collection<select id="rpCol"></select></label>
      <label>Area paths, one per line (includes everything under each)<textarea id="rpAreas" placeholder="Platform\\Team A" spellcheck="false">${esc(ui.rp.areas)}</textarea></label>
      <label>People, one per line (email or exact ADO display name)<textarea id="rpPeople" placeholder="name@company.com" spellcheck="false">${esc(ui.rp.people)}</textarea></label>
      <label>Default window<select id="rpDaysIn">${RP_DAYS.map(n => `<option value="${n}"${n === ui.rp.days ? ' selected' : ''}>Last ${n} days</option>`).join('')}</select></label>
    </div>
    <p class="hint" id="rpMsg" aria-live="polite" style="margin-top:.6rem"></p>
    <footer><span class="grow"></span><button class="btn" data-close>Cancel</button><button class="btn primary" data-rp-save>Save and pull data</button></footer></div>`,
    sh => sh.querySelector('[data-rp-save]').addEventListener('click', () => {
      const areas = sh.querySelector('#rpAreas').value.trim(), people = sh.querySelector('#rpPeople').value.trim();
      if (!rpLines(areas).length && !rpLines(people).length){ sh.querySelector('#rpMsg').textContent = 'Add at least one area path or person.'; return; }
      ui.rp.areas = areas; ui.rp.people = people; ui.rp.days = +sh.querySelector('#rpDaysIn').value || 42;
      if (cols.length > 1) ui.rp.base = sh.querySelector('#rpCol').value;
      saveUi(); closeModal();
      if (state.view !== 'reports') setView('reports');
      rpRefresh();
    }));
  try {
    const h = await adoCall('health');
    cols = h.collections || [];
    if (cols.length > 1 && $('#rpCol')){
      $('#rpCol').innerHTML = cols.map(c => `<option${c === ui.rp.base ? ' selected' : ''}>${esc(c)}</option>`).join('');
      $('#rpColWrap').hidden = false;
    }
    if (!h.reports && $('#rpMsg')) $('#rpMsg').textContent = RP_OLD;
  } catch(err){ if ($('#rpMsg')) $('#rpMsg').textContent = adoUnreachable(err) ? ADO_DOWN : err.message; }
}
function rpHead(){
  const d = rp.data, ready = ui.ado.on && rpHasProfile();
  const n = [rpLines(ui.rp.areas).length && plural(rpLines(ui.rp.areas).length, 'area'), rpLines(ui.rp.people).length && plural(rpLines(ui.rp.people).length, 'person').replace('persons', 'people')].filter(Boolean).join(', ');
  const sub = !ui.ado.on ? 'Team reports from Azure DevOps' : !ready ? 'No team profile yet'
    : d ? `${fmtMD(new Date(d.since + 'T12:00'))} to ${fmtMD(new Date(d.generatedAt))} · ${n}` : n;
  const tools = ready ? `<select id="rpDays" class="rp-days" aria-label="Window">${RP_DAYS.map(x => `<option value="${x}"${x === ui.rp.days ? ' selected' : ''}>${x} days</option>`).join('')}</select>
      <button class="btn" data-rp="refresh"${rp.busy ? ' disabled' : ''} data-tip="Pull fresh data from ADO">${rp.busy ? 'Refreshing...' : 'Refresh'}</button>
      ${d ? `<button class="btn" data-rp="export" data-tip="Workload tracker with every report, for sharing">Export</button>` : ''}
      <button class="ibtn" data-rp="profile" aria-label="Team profile" data-tip="Team profile">${ICON.dots}</button>` : '';
  $('#phead').innerHTML = `<button class="ibtn menu-btn" id="menuBtn" aria-label="Open menu">${ICON.menu}</button>
    <div class="ptitle"><h1>Reports</h1><span class="scopebtn" style="cursor:default">${esc(sub)}</span></div>${tools ? `<div class="htools">${tools}</div>` : ''}`;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-rp]'); if (!b) return;
  const a = b.dataset.rp;
  if (a === 'tab'){ ui.rp.tab = b.dataset.tab; saveUi(); render(); main.scrollTop = 0; }
  else if (a === 'refresh') rpRefresh();
  else if (a === 'profile') rpProfile();
  else if (a === 'connect') adoSetup();
  else if (a === 'export') rp.data && exportReports(rp.data);
});
document.addEventListener('change', e => {
  if (e.target.id !== 'rpDays') return;
  ui.rp.days = +e.target.value || 42; saveUi(); rpRefresh();
});

/* export: the Workload tracker plus every report, pre-filled from ADO, with Summary formulas */
function exportReports(d){
  if (!window.XLSX){ toast(NO_XLSX); return; }
  XLSX.writeFile(buildReportsWorkbook(d), `team-reports-${todayStr()}.xlsx`);
  toast('Reports exported to Excel');
}
function buildReportsWorkbook(d){
  const c = rpCompute(d), wb = XLSX.utils.book_new(), N = 5000, weeks = rpOne(c.weeks);
  const add = (name, rows, widths) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = widths.map(w => ({wch: w}));
    XLSX.utils.book_append_sheet(wb, ws, name);
    return ws;
  };
  const f = (formula, v) => ({t: typeof v === 'number' ? 'n' : 's', v, f: formula});
  const P = n => n ? 'P' + n : '';

  add('How To Use', [
    ['Team reports'],
    ['Generated', `${todayStr()} from ${d.base}`],
    ['Window', `${d.since} to ${todayStr()} (${d.days} days)`],
    ['Team profile', [...d.areas.map(a => 'Area: ' + a), ...d.people.map(p => 'Person: ' + p)].join('; ')],
    [],
    ['Filled from ADO', 'Priority Changes, Escalations, Out-of-Scope Work (items assigned to your people outside your areas), Sprint Carryover, Sprint Scope, Scope Changes, Assignment Changes, Load by Person, Priority Inventory, Throughput, Bugs Created.'],
    ['You fill in', 'Capacity (team hours). Escalations: what got dropped, fire drill and rework hours. Out-of-Scope Work: why and hours, plus rows for work that never had a ticket (Source: Manual). Bugs Created: Rework Yes for bugs caused by rushed work. Risk Flags. Priority Changes: rows from Teams with Source set to Teams.'],
    ['Summary', 'Formulas update as you add rows and hours. Lead with priority changes per week, mid-sprint scope changes, other-team items, and % of capacity lost.'],
    ['Definitions', `Escalation: priority raised to P${c.top} from lower. Mid-sprint: after the sprint's first day. High priority: P${c.high.join(', P')}. Hours count Remaining Work only.`],
    ['Tip', 'Name roles, not people, in anything you show (CEO request, Sales escalation). Keep the links as backup.']
  ], [18, 120]);

  // Summary rows reference the tabs below by column; keep these in step with the sheet layouts.
  const S = [
    ['weeks', 'Window (weeks)', null, weeks, '0.0'],
    ['pc', 'Priority changes (all sources)', `COUNTA('Priority Changes'!A2:A${N})`, c.churn.list.length],
    ['teams', '...of those, from Teams', `COUNTIF('Priority Changes'!I2:I${N},"Teams")`, 0],
    ['rate', 'Priority changes per week', r => `IFERROR(${r.pc}/${r.weeks},0)`, c.churn.rate, '0.0'],
    ['esc', `Escalations to P${c.top}`, `COUNTA(Escalations!A2:A${N})`, c.churn.escs.length],
    ['wait', 'Avg days an item sat before escalation', `IFERROR(AVERAGE(Escalations!F2:F${N}),0)`, c.churn.avgWait, '0'],
    ['oos', "Items done for other teams", `COUNTA('Out-of-Scope Work'!A2:A${N})`, c.other.list.length],
    ['oosEsc', '...of those, escalated', `COUNTIF('Out-of-Scope Work'!H2:H${N},"Yes")`, c.other.escalated],
    ['carry', 'Items moved between sprints', `COUNTA('Sprint Carryover'!A2:A${N})`, c.carry.list.length],
    ['carry2', '...moved 2+ times', `COUNTIF('Sprint Carryover'!C2:C${N},">=2")`, c.carry.multi],
    ['added', 'Added after sprint start', `SUM('Sprint Scope'!D2:D${N})`, c.scope.added],
    ['removed', 'Removed after sprint start', `SUM('Sprint Scope'!E2:E${N})`, c.scope.removed],
    ['assign', 'Assignment changes', `COUNTA('Assignment Changes'!A2:A${N})`, c.scope.assigns.length],
    ['open', 'Open high-priority items', `COUNTA('Priority Inventory'!B2:B${N})`, c.aging.hp.length],
    ['hours', 'Remaining work on those (hrs)', `SUMIFS('Priority Inventory'!H2:H${N},'Priority Inventory'!I2:I${N},"RemainingWork")`, c.aging.hours],
    ['noHours', '...items with no hours estimate', r => `${r.open}-COUNTIF('Priority Inventory'!I2:I${N},"RemainingWork")`, c.aging.noHours],
    ['closed', 'Items closed per week', `IFERROR(AVERAGE(Throughput!B2:B${N}),0)`, c.aging.closedRate, '0.0'],
    ['inflow', 'New high-priority items per week', `IFERROR(AVERAGE(Throughput!C2:C${N}),0)`, c.aging.inflowRate, '0.0'],
    ['cap', 'Available team hours in window', 'Capacity!B2', 0],
    ['demand', 'High-priority demand as % of capacity', r => `IFERROR(${r.hours}/${r.cap},0)`, 0, '0%'],
    ['bugs', 'Bugs created', `COUNTA('Bugs Created'!A2:A${N})`, c.bugs.length],
    ['bugRework', '...marked as rework', `COUNTIF('Bugs Created'!I2:I${N},"Yes")`, 0],
    ['fire', 'Fire drill hours', `SUM(Escalations!H2:H${N})`, 0],
    ['rework', 'Rework hours', `SUM(Escalations!I2:I${N})`, 0],
    ['oosHrs', "Hours on other teams' work", `SUM('Out-of-Scope Work'!J2:J${N})`, 0],
    ['lost', '% of capacity lost to fire drills, rework, other teams', r => `IFERROR((${r.fire}+${r.rework}+${r.oosHrs})/${r.cap},0)`, 0, '0%'],
    ['risks', 'Risks flagged in advance', `COUNTA('Risk Flags'!A2:A${N})`, 0]
  ];
  const ref = Object.fromEntries(S.map((s, i) => [s[0], 'B' + (i + 2)]));
  const sum = add('Summary', [['Metric', 'Value'], ...S.map(([k, label, fm, v]) => [label, fm == null ? v : f(typeof fm === 'function' ? fm(ref) : fm, v)])], [52, 12]);
  S.forEach(([k, , , , z]) => { if (z && sum[ref[k]]) sum[ref[k]].z = z; });

  const cap = add('Capacity', [
    ['Window (weeks)', weeks, 'Same window as the ADO pull'],
    ['Total available hours', f('SUM(G5:G24)', 0)],
    [],
    ['Team Member', 'Hours / Week', '% Support / On-call (0.2 = 20%)', '% Meetings / Overhead', 'PTO Hours in Window', 'Available Hrs / Week', 'Available Hrs in Window']
  ], [24, 13, 26, 22, 18, 18, 22]);
  const people = d.people.length ? d.people : [];
  const capRows = [];
  for (let r = 5; r <= 24; r++) capRows.push([people[r - 5] || '', '', '', '', '', f(`IF(B${r}="","",B${r}*(1-C${r}-D${r}))`, ''), f(`IF(B${r}="","",MAX(0,F${r}*$B$1-E${r}))`, '')]);
  XLSX.utils.sheet_add_aoa(cap, capRows, {origin: 'A5'});

  add('Priority Changes', [['Date', 'ID', 'Title', 'From', 'To', 'Direction', 'Escalation', 'Changed By', 'Source', 'Evidence'],
    ...c.churn.list.map(e => [dOnly(e.date), e.id, e.it.title, P(e.from), P(e.to), e.raised ? 'Raised' : 'Lowered', e.esc ? 'Yes' : '', e.by, 'ADO', e.it.url])],
    [11, 8, 44, 6, 6, 10, 10, 20, 8, 40]);
  add('Escalations', [['Date Escalated', 'ID', 'Title', 'Escalated By', 'Date Created', 'Days Before Escalation', 'What Got Dropped', 'Fire Drill Hours', 'Rework Hours After', 'Link'],
    ...c.churn.escs.map(e => [dOnly(e.date), e.id, e.it.title, e.by, e.it.created || '', e.waited ?? '', '', '', '', e.it.url])],
    [13, 8, 40, 20, 12, 12, 30, 12, 12, 40]);
  add('Out-of-Scope Work', [['Date', 'ID', 'Task', 'Team That Owns It', 'Assigned To', 'Priority', 'State', 'Escalated', 'Why We Did It', 'Hours', 'Source', 'Evidence'],
    ...c.other.list.map(i => [i.since || i.changed || '', i.id, i.title, i.area, i.assignedTo, P(i.priority), i.state, i.escalated ? 'Yes' : '', '', '', 'ADO', i.url])],
    [11, 8, 36, 22, 18, 8, 10, 10, 30, 8, 8, 40]);
  add('Sprint Carryover', [['ID', 'Title', 'Moves', 'Path', 'Last Moved', 'Moved By', 'State', 'Link'],
    ...c.carry.list.map(i => [i.id, i.title, i.moves, i.path, i.last, i.lastBy, i.state, i.url])],
    [8, 40, 7, 34, 11, 18, 10, 40]);
  add('Sprint Scope', [['Sprint', 'Start', 'Finish', 'Added Mid-Sprint', 'Removed Mid-Sprint', 'Pulled Onto Team', 'Pulled Off Team'],
    ...c.scope.sprints.map(s => [sprintName(s.path), s.start, s.finish, s.added, s.removed, s.onto, s.off])],
    [22, 11, 11, 16, 18, 16, 16]);
  add('Scope Changes', [['Date', 'Sprint', 'ID', 'Title', 'Change', 'By', 'Link'],
    ...c.scope.changes.map(e => [dOnly(e.date), sprintName(e.sprint), e.id, e.it.title, e.change, e.by, e.it.url])],
    [11, 18, 8, 40, 18, 18, 40]);
  add('Assignment Changes', [['Date', 'ID', 'Title', 'From', 'To', 'Change', 'By', 'Link'],
    ...c.scope.assigns.map(e => [dOnly(e.date), e.id, e.it.title, whoName(e.from), whoName(e.to), e.dir, e.by, e.it.url])],
    [11, 8, 40, 18, 18, 20, 18, 40]);
  add('Load by Person', [['Person', 'P1', 'P2', 'P3', 'P4', 'No Priority', 'Total Open', 'Remaining Hrs', 'Oldest (days)'],
    ...c.load.rows.map(r => [r.name, ...r.p, r.total, Math.round(r.hours * 10) / 10, r.oldest])],
    [24, 6, 6, 6, 6, 11, 11, 13, 13]);
  add('Priority Inventory', [['Your Rank', 'ID', 'Title', 'Type', 'State', 'Priority', 'Assigned To', 'Effort', 'Effort Field', 'Sprint', 'Created', 'Days Open', 'Link'],
    ...c.aging.hp.map(i => ['', i.id, i.title, i.type, i.state, P(i.priority), i.assignedTo, i.effort ?? '', i.effortField, sprintName(i.iteration), i.created || '', i.age ?? '', i.url])],
    [9, 8, 44, 12, 11, 8, 20, 8, 15, 18, 11, 10, 40]);
  add('Throughput', [['Week Of', 'Closed', 'New High-Priority'], ...c.weekLabels.map((l, i) => [l, c.aging.closed[i], c.aging.inflow[i]])], [12, 10, 18]);
  add('Bugs Created', [['Created', 'ID', 'Title', 'Priority', 'State', 'Created By', 'Assigned To', 'Area', 'Rework? (Yes/No)', 'Caused By (ID)', 'Link'],
    ...c.bugs.map(b => [b.created || '', b.id, b.title, P(b.priority), b.state, b.createdBy, b.assignedTo, b.area, '', '', b.url])],
    [11, 8, 40, 8, 10, 18, 18, 22, 15, 14, 40]);
  add('Risk Flags', [['Date Raised', 'Item', 'Risk You Flagged', 'Raised To', 'Channel', 'What Happened', 'Evidence']], [12, 30, 40, 18, 12, 20, 36]);
  return wb;
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) adoSync(false); });
window.addEventListener('focus', () => adoSync(false));

export { buildReportsWorkbook, renderReports, rp, rpCompute, rpHead, rpInit, rpRefresh };
