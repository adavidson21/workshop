/* Runway's team reports as HTML strings. Pure: main.js (through js/reports/index.js) paints these.
   Every piece of ADO text goes through esc(); only http(s) links are made clickable. */
import { esc } from '../../timeline.js';
import { dOnly, fmtMD, one, sprintName, whoName } from './model.js';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const httpUrl = u => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
const rpLink = i => httpUrl(i.url) ? `<a class="lnk" href="${esc(i.url)}" target="_blank" rel="noopener">#${esc(i.id)}</a>` : `#${esc(i.id)}`;
const rpKpi = (n, l) => `<div class="wl-kpi"><b>${n}</b><span>${l}</span></div>`;
const rpOne = one;
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
export const rpCard = (title, text, acts) => `<div class="engcard"><h2>${title}</h2><p>${text}</p><div class="acts">${acts}</div></div>`;

export const RENDER = {
  churn(c){
    const h = c.churn, topWho = h.byWho[0];
    return `<div class="wl-kpis">${rpKpi(h.list.length, 'priority changes')}${rpKpi(rpOne(h.rate), 'per week')}${rpKpi(h.raised, 'raised')}
        ${rpKpi(h.escs.length, `escalated to P${c.top}`)}${rpKpi(Math.round(h.avgWait), 'avg days before escalation')}</div>
      ${rpInsight(h.list.length ? `Priorities changed ${plural(h.list.length, 'time')} in ${rpOne(c.weeks)} weeks, about ${rpOne(h.rate)} per week.${topWho ? ` ${esc(topWho[0])} made ${topWho[1]} of them.` : ''}${h.escs.length && h.avgWait >= 7 ? ` Escalated items sat ${Math.round(h.avgWait)} days on average before escalation.` : ''}` : '')}
      ${rpSection('Changes per week', rpCols([[h.perWeek, 's-a', 'Changes']], c.weekLabels, 'Priority changes per week'))}
      ${rpSection('Who changed priorities', rpBars(h.byWho.slice(0, 8).map(([n, v]) => [n, [[v, 's-a']]]), h.byWho.length ? h.byWho[0][1] : 1, 'Priority changes by person'))}
      ${rpSection('All changes', rpTable(['Date', 'Item', 'Title', 'Change', 'By'], h.list.map(e => `<tr><td class="num">${dOnly(e.date)}</td><td>${rpLink(e.it)}</td><td class="t">${esc(e.it.title)}</td>
        <td class="num">P${e.from} to P${e.to}${e.esc ? ' <span class="rp-tag">escalation</span>' : ''}</td><td>${esc(e.by)}</td></tr>`)))}`;
  },
  other(c){
    const o = c.other;
    if (!o.can) return rpCard("Needs area paths and people", "This report finds work assigned to your people outside your area paths. Add both to your team profile.", '<button class="btn primary" data-rp="profile">Team profile</button>');
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
      ${rpInsight(k.multi ? `${plural(k.multi, 'item')} bounced between sprints more than once.` : '')}
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
      ${rpInsight(s.added + s.removed ? `${plural(s.added + s.removed, 'scope change')} happened after sprints had started.` : '')}
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
      ${rpInsight(a.inflowRate || a.closedRate ? (net > 0 ? `High-priority work is arriving faster than the team closes work: about ${rpOne(a.inflowRate)} new P${c.high.join('/P')} items a week against ${rpOne(a.closedRate)} closed.` : `The team closes about ${rpOne(a.closedRate)} items a week against ${rpOne(a.inflowRate)} new high-priority items.`) : '')}
      ${rpSection('Closed vs new high-priority, per week', rpCols([[a.closed, 's-a', 'Closed'], [a.inflow, 's-b', 'New high-priority']], c.weekLabels, 'Throughput versus high-priority inflow'),
        'New high-priority counts items created at high priority plus items raised into it.')}
      ${rpSection('Age of open high-priority work', rpBars(a.buckets.map(([l, v]) => [l, [[v, 's-a']]]), Math.max(1, ...a.buckets.map(b => b[1])), 'Open high-priority items by age'))}
      ${rpSection('Oldest first', rpTable(['Item', 'Title', 'Priority', 'Days open', 'Assigned to', 'State', 'Sprint'], a.hp.map(i => `<tr><td>${rpLink(i)}</td><td class="t">${esc(i.title)}</td>
        <td class="num">P${i.priority}</td><td class="num">${i.age}</td><td>${esc(i.assignedTo || '')}</td><td>${esc(i.state)}</td><td>${esc(sprintName(i.iteration))}</td></tr>`)))}`;
  }
};
