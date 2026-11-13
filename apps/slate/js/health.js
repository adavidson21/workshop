/* Slate: the Health tab, with Sprints inside it. Pure HTML builders, like view.js. */
import { BOARD_COLUMNS, LEVEL_NAME, esc, sprintLoad } from './model.js';
import { outsideBanner } from '../../../shared/outside.js';

const btn = (act, label, { id = '', primary = false } = {}) =>
  `<button type="button" class="btn${primary ? ' primary' : ''}" data-act="${esc(act)}"${id ? ` data-id="${esc(id)}"` : ''}>${esc(label)}</button>`;

/** Health: where requests are and how long they sit, who holds delegated work, Sprints, and a link to Runway's team reports. */
export function healthHtml(h, { names = {}, reports = true } = {}) {
  const rows = BOARD_COLUMNS.map(({ key, title }) => {
    const x = h.cols[key] || { count: 0, stale: 0, medianDays: 0 };
    return `<tr><th scope="row">${esc(title)}</th><td class="num">${x.count}</td><td class="num">${x.count ? x.medianDays : ''}</td>
      <td class="num${x.stale ? ' warn' : ''}">${x.stale || ''}</td></tr>`;
  }).join('');
  const oldest = h.oldest.length
    ? `<ol class="oldest">${h.oldest.map(o => `<li><button type="button" class="lnk" data-act="open-item" data-id="${esc(o.it.id)}">${esc(o.it.title)}</button> <span class="soft">${o.days} day${o.days === 1 ? '' : 's'} in ${esc(o.column)}${o.it.requester ? `, asked by ${esc(o.it.requester)}` : ''}</span></li>`).join('')}</ol>`
    : '<p class="soft">Nothing open.</p>';
  const load = Object.entries(h.load).sort((a, b) => b[1] - a[1]);
  return `<div class="health">
    <section class="hcard"><h2>Request to decision</h2>
      <p class="big">${h.toDecision.median == null ? 'No decisions yet' : `${h.toDecision.median} day${h.toDecision.median === 1 ? '' : 's'}`}</p>
      <p class="soft">Median days from a request coming in to deciding who builds it${h.toDecision.n ? `, over ${h.toDecision.n} item${h.toDecision.n === 1 ? '' : 's'}` : ''}.</p></section>
    <section class="hcard"><h2>Request to resolved</h2>
      <p class="big">${!h.toResolved || h.toResolved.median == null ? 'Nothing resolved yet' : `${h.toResolved.median} day${h.toResolved.median === 1 ? '' : 's'}`}</p>
      <p class="soft">Median days from a request coming in to merged and resolved${h.toResolved && h.toResolved.n ? `, over ${h.toResolved.n} item${h.toResolved.n === 1 ? '' : 's'}` : ''}.${h.closed ? ` ${h.closed} closed and off the board.` : ''}</p></section>
    <section class="hcard wide"><h2>Where requests sit</h2>
      <table class="htable"><thead><tr><th>Lane</th><th class="num">Items</th><th class="num">Median days</th><th class="num">Stale</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="soft small">Stale after 3 days new, in triage, a brief or Who builds it?; 5 waiting on the requester or in the interview; 7 in Define; 2 approved but not published.</p></section>
    <section class="hcard"><h2>Waiting longest</h2>${oldest}</section>
    <section class="hcard"><h2>Delegated, by person</h2>${load.length ? `<ul class="load">${load.map(([id, n]) => `<li><span>${esc(names[id] || 'Someone')}</span><span class="num">${n}</span></li>`).join('')}</ul>` : '<p class="soft">Nothing delegated right now.</p>'}</section>
    <section class="hcard full" id="sprints"><h2>Sprints</h2><div id="sprintsBox"></div></section>
    ${reports ? `<section class="hcard full"><h2>Team reports${globalThis.WorkshopTheme?.hints ? globalThis.WorkshopTheme?.hints.html('slate.reports', 'Sprint health from Azure DevOps: priority churn, carryover, scope churn, load by person, aging and throughput.', 'About Team reports') : ''}</h2>
      <p class="soft">Priority churn, carryover, scope churn, load by person, aging and throughput live in Runway.</p>
      <p><button class="btn" type="button" data-act="reports">Open team reports in Runway</button></p></section>` : ''}
  </div>`;
}

/** Sprints (in Health): ADO items by sprint, with load per person and a way to move or assign each one. */
export function sprintsHtml({ sprints, groups, people, note }) {
  if (note) return `<p class="soft">${esc(note)}</p>`;
  const opts = (sel) => `<option value="">No sprint</option>${sprints.map(s => `<option value="${esc(s.path)}"${s.path === sel ? ' selected' : ''}>${esc(s.name)}${s.current ? ' (current)' : ''}</option>`).join('')}`;
  const who = (it) => `<option value="">Unassigned</option>${people.map(p => `<option value="${esc(p.id)}"${it.adoNow && it.adoNow.assignee && p.adoIdentity && it.adoNow.assignee.email === p.adoIdentity.toLowerCase() ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}`;
  const shown = [...sprints.filter(s => s.current || (s.start && s.start >= new Date().toISOString().slice(0, 10))).slice(0, 3)];
  const lanes = [...shown.map(s => ({ path: s.path, title: s.name + (s.current ? ' (current)' : ''), dates: s.start ? `${s.start} to ${s.finish || ''}` : '' })), { path: '', title: 'Not in a sprint', dates: '' }];
  return `${outsideBanner('ado', 'Picking a sprint or a person below changes that item in ADO, after a confirm.')}<div class="sprints">${lanes.map(l => {
    const list = groups[l.path] || [];
    return `<section class="sprint"><header><h2>${esc(l.title)}</h2><span class="soft">${esc(l.dates)}</span></header>
      ${list.length ? `<p class="load-line">${sprintLoad(list).map(x => `${esc(x.name)} ${x.count}`).join(' · ')}</p>` : ''}
      <ul>${list.map(it => `<li class="srow"><button type="button" class="lnk" data-act="open-item" data-id="${esc(it.id)}">#${it.ado.id} ${esc(it.title)}</button>
        <span class="chip lv-${esc(it.level)}">${esc(LEVEL_NAME[it.level] || 'Story')}</span>
        <label class="sr" for="sp-${esc(it.id)}">Sprint</label><select id="sp-${esc(it.id)}" data-sprint="${esc(it.id)}">${opts((it.adoNow && it.adoNow.iteration) || '')}</select>
        <label class="sr" for="as-${esc(it.id)}">Assigned to</label><select id="as-${esc(it.id)}" data-assign="${esc(it.id)}">${who(it)}</select></li>`).join('') || '<li class="soft">Nothing here.</li>'}</ul></section>`;
  }).join('')}<p class="soft small">Only items Slate knows (published, delegated or yours) are listed.${btn('refresh', 'Refresh')}</p></div>`;
}
