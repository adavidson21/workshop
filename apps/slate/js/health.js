/* Slate: the Health and Sprints tabs. Pure HTML builders, like view.js. */
import { LEVEL_NAME, STALE_DAYS, esc, sprintLoad } from './model.js';

// One row per step, in board order: Shaping's three steps and Define's approved step get their own rows.
const ROWS = [['new', 'New'], ['triage', 'Shaping: triage'], ['waiting', 'Shaping: waiting on requester'], ['interview', 'Shaping: interview'], ['brief', 'Brief'], ['define', 'Define'], ['publish', 'Define: approved, not in ADO'], ['decide', 'Who builds it?'], ['delegated', 'Delegated'], ['building', 'Building'], ['review', 'Review and PR'], ['merged', 'Merged'], ['resolved', 'Resolved']];

const btn = (act, label, { id = '', primary = false } = {}) =>
  `<button type="button" class="btn${primary ? ' primary' : ''}" data-act="${esc(act)}"${id ? ` data-id="${esc(id)}"` : ''}>${esc(label)}</button>`;

/** Health: where requests are and how long they sit, who holds delegated work, and Runway's team reports below. */
export function healthHtml(h, { names = {}, reports = true } = {}) {
  const rows = ROWS.map(([key, title]) => {
    const x = h.cols[key] || { count: 0, stale: 0, medianDays: 0 };
    const limit = STALE_DAYS[key];
    return `<tr><th scope="row">${esc(title)}</th><td class="num">${x.count}</td><td class="num">${x.count ? x.medianDays : ''}</td>
      <td class="num${x.stale ? ' warn' : ''}">${x.stale || ''}</td><td class="num soft">${limit != null ? `${limit} days` : ''}</td></tr>`;
  }).join('');
  const oldest = h.oldest.length
    ? `<ol class="oldest">${h.oldest.map(o => `<li><button type="button" class="lnk" data-act="open-item" data-id="${esc(o.it.id)}">${esc(o.it.title)}</button> <span class="soft">${o.days} days in ${esc(o.column)}${o.it.requester ? `, asked by ${esc(o.it.requester)}` : ''}</span></li>`).join('')}</ol>`
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
      <table class="htable"><thead><tr><th>Column</th><th class="num">Items</th><th class="num">Median days</th><th class="num">Stale</th><th class="num">Stale after</th></tr></thead><tbody>${rows}</tbody></table></section>
    <section class="hcard"><h2>Waiting longest</h2>${oldest}</section>
    <section class="hcard"><h2>Delegated, by person</h2>${load.length ? `<ul class="load">${load.map(([id, n]) => `<li><span>${esc(names[id] || 'Someone')}</span><span class="num">${n}</span></li>`).join('')}</ul>` : '<p class="soft">Nothing delegated right now.</p>'}</section>
    ${reports ? `<section class="hcard full"><h2>Team reports${globalThis.WorkshopTheme?.hints ? globalThis.WorkshopTheme?.hints.html('slate.reports', 'Sprint health from Azure DevOps: priority churn, carryover, scope churn, load by person, aging and throughput.', 'About Team reports') : ''}</h2>
      <iframe id="reports" class="reports" title="Team reports" src="../runway/index.html"></iframe></section>` : ''}
  </div>`;
}

/** Sprints: ADO items by sprint, with load per person and a way to move or assign each one. */
export function sprintsHtml({ sprints, groups, people, note }) {
  if (note) return `<div class="empty"><h2>Sprints</h2><p>${esc(note)}</p></div>`;
  const opts = (sel) => `<option value="">No sprint</option>${sprints.map(s => `<option value="${esc(s.path)}"${s.path === sel ? ' selected' : ''}>${esc(s.name)}${s.current ? ' (current)' : ''}</option>`).join('')}`;
  const who = (it) => `<option value="">Unassigned</option>${people.map(p => `<option value="${esc(p.id)}"${it.adoNow && it.adoNow.assignee && p.adoIdentity && it.adoNow.assignee.email === p.adoIdentity.toLowerCase() ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}`;
  const shown = [...sprints.filter(s => s.current || (s.start && s.start >= new Date().toISOString().slice(0, 10))).slice(0, 3)];
  const lanes = [...shown.map(s => ({ path: s.path, title: s.name + (s.current ? ' (current)' : ''), dates: s.start ? `${s.start} to ${s.finish || ''}` : '' })), { path: '', title: 'Not in a sprint', dates: '' }];
  return `<div class="sprints">${lanes.map(l => {
    const list = groups[l.path] || [];
    return `<section class="sprint"><header><h2>${esc(l.title)}</h2><span class="soft">${esc(l.dates)}</span></header>
      ${list.length ? `<p class="load-line">${sprintLoad(list).map(x => `${esc(x.name)} ${x.count}`).join(' · ')}</p>` : ''}
      <ul>${list.map(it => `<li class="srow"><button type="button" class="lnk" data-act="open-item" data-id="${esc(it.id)}">#${it.ado.id} ${esc(it.title)}</button>
        <span class="chip lv-${esc(it.level)}">${esc(LEVEL_NAME[it.level] || 'Story')}</span>
        <label class="sr" for="sp-${esc(it.id)}">Sprint</label><select id="sp-${esc(it.id)}" data-sprint="${esc(it.id)}">${opts((it.adoNow && it.adoNow.iteration) || '')}</select>
        <label class="sr" for="as-${esc(it.id)}">Assigned to</label><select id="as-${esc(it.id)}" data-assign="${esc(it.id)}">${who(it)}</select></li>`).join('') || '<li class="soft">Nothing here.</li>'}</ul></section>`;
  }).join('')}<p class="soft small">Changes go to Azure DevOps after a confirm. Only items Slate knows (published, delegated or yours) are listed.${btn('refresh', 'Refresh')}</p></div>`;
}
