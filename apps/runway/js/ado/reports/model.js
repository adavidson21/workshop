/* Runway's team reports, pure: no DOM, no SDK, so Node tests drive it. Moved from Docket (Docket 4.17.0).
   One `dataset` pull from Workshop's ADO connector (connectors/ado/lib/dataset.mjs in the workshop repo) holds the
   team's work items, their priority, sprint, assignment and state changes in a window, and sprint dates. Every
   report is computed here from that one pull. buildWorkbook takes the SheetJS global so tests can pass it in. */

export const TABS = [['churn', 'Priority churn'], ['other', "Other teams' work"], ['carry', 'Sprint carryover'],
  ['scope', 'Sprint scope churn'], ['load', 'Load by person'], ['aging', 'Aging and throughput']];
export const WINDOWS = [14, 30, 42, 60, 90, 120, 180];
const DAY_MS = 864e5;
export const dOnly = s => String(s || '').slice(0, 10);
const pad = n => String(n).padStart(2, '0');
const dayStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fmtMD = d => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const daysApart = (a, b) => a && b ? Math.max(0, Math.round((Date.parse(dOnly(b)) - Date.parse(dOnly(a))) / DAY_MS)) : null;
export const sprintName = p => String(p || '').split('\\').slice(1).join('\\') || p || '(none)';
export const whoName = w => w ? (w.name || w.email || 'Someone') : 'Unassigned';
const countBy = (arr, f) => { const m = new Map(); arr.forEach(x => { const k = f(x); m.set(k, (m.get(k) || 0) + 1); }); return [...m].sort((a, b) => b[1] - a[1]); };
export const one = n => Math.round(n * 10) / 10;
const rpOne = one;

/** Profile lines: one per line, or separated by semicolons. */
export const lines = v => String(v || '').split(/\r?\n|;/).map(x => x.trim()).filter(Boolean);

/** Team lines from Workshop's people directory (Settings' `people`, v1): active team members' ADO identity or name. */
export function teamLines(env) {
  if (!env || env.schema !== 'settings.people' || env.version !== 1 || !Array.isArray(env.items)) return [];
  return [...new Set(env.items.filter(p => p && typeof p.name === 'string' && p.name.trim() && !p.archived
    && (typeof p.team === 'boolean' ? p.team : p.relation === 'self' || p.relation === 'report'))
    .map(p => (typeof p.adoIdentity === 'string' && p.adoIdentity.trim()) || p.name.trim()))];
}

/** A pull worth keeping: the connector's dataset shape, schema 1. */
export const usable = d => !!(d && d.schema === 1 && Array.isArray(d.items) && Array.isArray(d.events) && d.config);

export function compute(d, now = new Date()){
  const nowMs = now.getTime(), todayStr = () => dayStr(now);
  const daysSince = s => s ? Math.max(0, Math.floor((nowMs - Date.parse(dOnly(s) + 'T12:00:00')) / DAY_MS)) : null;
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
  const weekLabels = [...Array(nWeeks)].map((_, i) => fmtMD(new Date(nowMs - ((nWeeks - 1 - i) * 7 + 6) * DAY_MS)));
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
  return {key: d.generatedAt, weeks, weekLabels, churn, other, carry, scope, load, aging, bugs, top, high: [...high].sort()};
}

/* export: the Workload tracker plus every report, pre-filled from ADO, with Summary formulas */
export function buildWorkbook(XLSX, d, now = new Date()){
  const todayStr = () => dayStr(now);
  const c = compute(d, now), wb = XLSX.utils.book_new(), N = 5000, weeks = rpOne(c.weeks);
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
