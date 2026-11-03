/* Roadmap: the HTML. Pure functions with no DOM or SDK, so Node tests can import them. Every string from ADO,
   other apps or the person is escaped with esc(). */
import {
  ago, axisRange, barPos, bucketOf, buildLanes, ceremonyStatus, esc, isDate, iterationIndex, monthTicks,
  placeEpic, placeItem, productsText, progress, releaseHealth, sortCeremonies, sprintDayDate, sprintStrip, todayOf
} from './model.js';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const opt = (value, label, sel) => `<option value="${esc(value)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
const DONE = new Set(['closed', 'done', 'resolved', 'removed', 'completed']);
const NEW = new Set(['new', 'proposed', 'to do', 'approved', 'open']);
/** 'done', 'new' or 'now' (work started), for the bar color. */
export const stateClass = item => (DONE.has(String(item.state).toLowerCase()) ? 'done' : NEW.has(String(item.state).toLowerCase()) ? 'new' : 'now');

/** Only http(s) URLs reach an href. */
export const safeUrl = u => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '#');

const fmtDay = d => (isDate(d) ? new Date(d + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const pctText = p => (p.pct == null ? 'No stories' : `${p.pct}% (${p.done} of ${p.total} stories)`);

export const TABS = [
  { id: 'roadmap', name: 'Roadmap' },
  { id: 'releases', name: 'Release health' },
  { id: 'cadence', name: 'Sprint cadence' }
];

const gear = '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 6h12M4 14h12"/><circle cx="8" cy="6" r="2" fill="var(--bg)"/><circle cx="12.5" cy="14" r="2" fill="var(--bg)"/></svg>';
const chevron = '<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 5l5 5-5 5"/></svg>';

function head(v) {
  const canRefresh = v.ado.state === 'ready' && v.snap.areas.length + v.products.length + v.queue.areas.length > 0;
  return `<header class="phead">
    <div><p class="eyebrow">Azure DevOps</p><h1 class="page-title">Roadmap</h1></div>
    <div class="acts">
      ${canRefresh ? `<button class="btn" data-refresh${v.refreshing ? ' disabled' : ''}>Refresh</button>` : ''}
      <button class="btn primary" data-scope title="Opens Dispatch. Use Start work there to scope it.">Scope new work</button>
      <button class="ibtn" data-tab="settings" title="Roadmap settings" aria-label="Roadmap settings">${gear}</button>
    </div></header>`;
}

function tabs(ui) {
  return `<nav class="tabs" role="tablist" aria-label="Views">${TABS.map(t => `<button class="tab${ui.tab === t.id ? ' on' : ''}" role="tab" aria-selected="${ui.tab === t.id}" data-tab="${t.id}">${esc(t.name)}</button>`).join('')}</nav>`;
}

function statusLine(v, now) {
  const bits = [];
  if (v.refreshing) bits.push('Refreshing…');
  else if (v.snap.fetchedAt) bits.push(`Updated ${ago(v.snap.fetchedAt, now)}`);
  if (v.ado.state !== 'ready' && v.items.length) bits.push(v.ado.state === 'browser' ? 'Showing the last copy: Workshop on this computer is not connected' : `Showing the last copy: ${v.ado.message}`);
  if (v.snap.truncated) bits.push(`Showing the newest ${v.items.length} of ${v.snap.total}`);
  if (v.snap.childrenTruncated) bits.push('Story counts are partial');
  return `<p class="status${v.refreshError ? ' bad' : ''}" role="status">${esc(bits.join(' · '))}${v.refreshError ? ` <span>${esc(v.refreshError)}</span>` : ''}</p>`;
}

/** Shown instead of the roadmap when it cannot work yet. Returns '' when it can show. */
export function setupCard(v, embedded) {
  if (v.waiting) {
    return `<section class="engcard" role="status"><h2>Allow Workshop to use your folder to see the roadmap</h2>
      <p>${embedded ? 'Click <b>Allow</b> in the bar at the top of Workshop.' : 'Open Workshop and click <b>Allow</b> in the bar at the top.'} Chrome asks again after it restarts.</p></section>`;
  }
  if (v.newer) return `<section class="engcard"><h2>Saved by a newer Roadmap</h2><p>Update Workshop to use the roadmap here. Nothing was changed.</p></section>`;
  return '';
}

function adoCard(v) {
  if (v.items.length) return '';
  if (v.ado.state === 'browser') {
    return `<section class="engcard"><h2>The roadmap needs Workshop on this computer</h2>
      <p>The roadmap reads Epics and Features from Azure DevOps through Workshop on this computer. Start Workshop, then click <b>Connect</b> on the rail. Sprint cadence works without it.</p></section>`;
  }
  if (v.ado.state === 'off') {
    return `<section class="engcard"><h2>Turn on the ADO connector</h2><p>${esc(v.ado.message)}</p>
      <p>In Settings, add your ADO connection and turn the connector on. The roadmap only reads ADO, so Work Items (Read) is enough.</p>
      <p><button class="btn primary" data-open-app="settings">Open Settings</button></p></section>`;
  }
  if (!v.products.length && !(v.settings.useQueueAreas && v.queue.areas.length)) {
    return `<section class="engcard"><h2>Which area paths are your products?</h2>
      <p>Each product gets a lane. Name it and list its area paths. Queue's area paths are used too, unless you turn that off.</p>
      <p><button class="btn primary" data-tab="settings">Set up products</button></p></section>`;
  }
  return '';
}

/* ---------- Roadmap: lanes on a time axis ---------- */

/** Everything the Roadmap tab needs: lanes, the axis, and each row's place. */
export function roadmapModel(v, ui, now) {
  const today = todayOf(now);
  const iters = iterationIndex(v.snap.iterations);
  const lanes = buildLanes(v.items, { products: v.products, queueAreas: v.settings.useQueueAreas ? v.queue.areas : [] });
  const spans = [];
  for (const l of lanes) {
    for (const r of l.epics) {
      r.place = placeEpic(r, iters);
      r.progress = progress(r.features);
      for (const f of r.features) f.place = placeItem(f, iters);
      if (r.place.from) spans.push(r.place);
    }
    for (const f of l.loose) { f.place = placeItem(f, iters); if (f.place.from) spans.push(f.place); }
  }
  return { today, lanes, range: axisRange(spans, today) };
}

function bar(item, place, range, p) {
  const pos = barPos(place, range);
  if (!pos) return `<span class="nodates">${place.from ? 'Outside this window' : 'No dates'}</span>`;
  const when = `${fmtDay(place.start)} to ${fmtDay(place.end)}${place.from === 'sprint' ? ', from its sprint' : place.from === 'features' ? ', from its features' : ''}`;
  return `<span class="bar s-${stateClass(item)}${place.from !== 'dates' ? ' soft-bar' : ''}" style="--l:${pos.left}%;--w:${pos.width}%" title="${esc(when)}">
    ${p && p.pct != null ? `<span class="fill" style="--p:${p.pct}%"></span>` : ''}<span class="sr">${esc(when)}. ${esc(pctText(p || { pct: null }))}.</span></span>`;
}

function track(range, today, inner) {
  const pos = barPos({ start: today, end: today, from: 'dates' }, range);
  return `<div class="track">${pos ? `<span class="todayline" style="--l:${pos.left}%" aria-hidden="true"></span>` : ''}${inner}</div>`;
}

function featureRow(f, range, today, changed) {
  const p = progress(f);
  return `<div class="trow feat"><div class="tlabel"><span class="tname">${changed.has(f.id) ? '<span class="dot" title="Changed since you looked"></span>' : ''}<a href="${esc(safeUrl(f.url))}" target="_blank" rel="noopener noreferrer">${esc(f.title)}</a></span>
    <span class="tmeta">${esc(f.state)} · ${esc(p.pct == null ? 'no stories' : `${p.done}/${p.total}`)}</span></div>${track(range, today, bar(f, f.place, range, p))}</div>`;
}

function laneHtml(l, m, ui, changed) {
  const { range, today } = m;
  const placed = l.epics.filter(r => r.place.from);
  const placedLoose = l.loose.filter(f => f.place.from);
  const board = { now: [], next: [], later: [] };
  for (const r of l.epics.filter(x => !x.place.from)) board[bucketOf(r.epic)].push({ item: r.epic, p: r.progress, n: r.features.length });
  for (const f of l.loose.filter(x => !x.place.from)) board[bucketOf(f)].push({ item: f, p: progress(f), n: null });
  const ticks = monthTicks(range);
  const rows = placed.map(r => {
    const open = ui.open.has(r.epic.id);
    const fid = `f-${r.epic.id}`;
    return `<div class="trow epic"><div class="tlabel">
        <button class="tog" data-toggle="${r.epic.id}" aria-expanded="${open}" aria-controls="${fid}" aria-label="${open ? 'Hide' : 'Show'} the features of ${esc(r.epic.title)}"${r.features.length ? '' : ' disabled'}>${chevron}</button>
        <span class="tname">${changed.has(r.epic.id) ? '<span class="dot" title="Changed since you looked"></span>' : ''}<button class="lnk" data-release="${r.epic.id}">${esc(r.epic.title)}</button></span>
        <span class="tmeta">${esc(r.epic.state)} · ${plural(r.features.length, 'feature')} · ${esc(r.progress.pct == null ? 'no stories' : `${r.progress.pct}%`)}</span></div>
        ${track(range, today, bar(r.epic, r.place, range, r.progress))}</div>
      <div id="${fid}" class="feats"${open ? '' : ' hidden'}>${open ? r.features.map(f => featureRow(f, range, today, changed)).join('') : ''}</div>`;
  }).join('') + (placedLoose.length ? `<p class="subhead">Features with no version</p>${placedLoose.map(f => featureRow(f, range, today, changed)).join('')}` : '');
  const chart = rows ? `<div class="chart" role="group" aria-label="Timeline for ${esc(l.name)}" tabindex="0"><div class="chart-in">
      <div class="trow axis" aria-hidden="true"><div class="tlabel"></div><div class="track">${ticks.map(t => `<span class="tick" style="--l:${t.left}%">${esc(t.label)}</span>`).join('')}</div></div>
      ${rows}</div></div>` : '';
  const col = (key, name) => `<div class="bcol"><h3 class="section-label">${name}</h3>${board[key].length ? `<ul>${board[key].map(x => `<li><a href="${esc(safeUrl(x.item.url))}" target="_blank" rel="noopener noreferrer">${esc(x.item.title)}</a>
      <span class="soft">${esc(x.item.type)} · ${esc(x.item.state)}${x.n != null ? ` · ${plural(x.n, 'feature')}` : ''} · ${esc(x.p.pct == null ? 'no stories' : `${x.p.pct}%`)}</span></li>`).join('')}</ul>` : '<p class="soft">Nothing here.</p>'}</div>`;
  const undated = board.now.length + board.next.length + board.later.length;
  const boardHtml = undated ? `<div class="board" aria-label="No dates yet">${col('now', 'Now')}${col('next', 'Next')}${col('later', 'Later')}</div>` : '';
  const count = l.epics.length + l.loose.length;
  return `<section class="lane" aria-label="${esc(l.name)}"><h2 class="lane-title">${esc(l.name)} <span class="soft num">${plural(l.epics.length, 'version')}${l.loose.length ? `, ${plural(l.loose.length, 'loose feature')}` : ''}</span></h2>
    ${count ? chart + boardHtml : '<p class="soft">No open Epics or Features here.</p>'}</section>`;
}

export function roadmapHtml(v, ui, now) {
  const m = roadmapModel(v, ui, now);
  const changed = new Set(v.items.filter(i => v.seen[i.id] !== undefined && v.seen[i.id] < i.rev).map(i => i.id));
  if (!m.lanes.length) return '<p class="soft empty">No lanes yet. Add products in settings.</p>';
  return `<p class="legend soft"><span class="lg"><span class="key s-now"></span>In progress</span><span class="lg"><span class="key s-new"></span>Not started</span><span class="lg"><span class="key s-done"></span>Done</span><span class="lg"><span class="key soft-bar s-now"></span>Dates from a sprint or its features</span></p>` +
    m.lanes.map(l => laneHtml(l, m, ui, changed)).join('');
}

/* ---------- Release health ---------- */

export function releasesHtml(v, ui, now) {
  const lanes = buildLanes(v.items, { products: v.products, queueAreas: v.settings.useQueueAreas ? v.queue.areas : [] });
  const rows = lanes.flatMap(l => l.epics.map(r => ({ ...r, lane: l.name })));
  if (!rows.length) return '<p class="soft empty">No open Epics in these area paths.</p>';
  const pick = rows.find(r => r.epic.id === ui.release) ? ui.release : null;
  const shown = pick ? rows.filter(r => r.epic.id === pick) : rows;
  const select = `<div class="filters"><label class="fl">Version<select data-release-pick>${opt('', 'All versions', !pick)}${rows.map(r => opt(r.epic.id, `${r.lane}: ${r.epic.title}`, r.epic.id === pick)).join('')}</select></label>
    <label class="fl">Stale after<span class="soft">${plural(v.settings.staleDays, 'day')} without a change</span></label></div>`;
  return select + shown.map(r => {
    const h = releaseHealth(r, { seen: v.seen, staleDays: v.settings.staleDays, now });
    const target = r.epic.targetDate ? `target ${fmtDay(r.epic.targetDate)}` : 'no target date';
    return `<section class="rel" aria-label="${esc(r.epic.title)}">
      <header class="relhead"><div><p class="eyebrow">${esc(r.lane)} · <span class="num">#${r.epic.id}</span></p>
        <h2>${h.epicChanged ? '<span class="dot" title="Changed since you looked"></span>' : ''}${esc(r.epic.title)}</h2>
        <p class="soft">${esc(r.epic.state)} · ${esc(target)} · ${plural(h.features.length, 'feature')}</p></div>
        <div class="acts">${h.changed ? `<button class="btn" data-seen="${r.epic.id}">Mark as seen</button>` : ''}<a class="btn" href="${esc(safeUrl(r.epic.url))}" target="_blank" rel="noopener noreferrer">Open in ADO</a></div></header>
      <div class="stats">${h.progress.pct == null ? '<span>No stories yet</span>' : `<span><b class="num">${h.progress.pct}%</b> done</span><span class="num">${h.progress.done} of ${h.progress.total} stories</span>`}
        <span class="${h.stale ? 'warn' : ''}"><b class="num">${h.stale}</b> stale</span><span class="${h.changed ? 'accent' : ''}"><b class="num">${h.changed}</b> changed since you looked</span></div>
      ${progressBar(h.progress)}
      ${h.features.length ? `<div class="tablewrap"><table class="feat-table"><thead><tr><th>Feature</th><th>State</th><th>Progress</th><th>Last change</th></tr></thead><tbody>
        ${h.features.map(f => `<tr><td>${f.changedSince ? '<span class="dot" title="Changed since you looked"></span>' : ''}<a href="${esc(safeUrl(f.url))}" target="_blank" rel="noopener noreferrer">${esc(f.title)}</a></td>
          <td><span class="st s-${stateClass(f)}">${esc(f.state)}</span></td>
          <td class="prog">${progressBar(f.progress)}<span class="soft num">${esc(f.progress.pct == null ? 'no stories' : `${f.progress.done}/${f.progress.total}`)}</span></td>
          <td class="${f.stale ? 'warn' : 'soft'}">${esc(ago(f.changed, now))}${f.stale ? ' · stale' : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="soft">No open features in this version.</p>'}
    </section>`;
  }).join('');
}

function progressBar(p) {
  return `<span class="pbar" role="img" aria-label="${esc(pctText(p))}"><span style="--p:${p.pct || 0}%"></span></span>`;
}

/* ---------- Sprint cadence ---------- */

const STATUS = { accepted: 'In Docket', offered: 'Waiting in Docket', changed: 'Changed, send again', new: 'Not sent' };

function dueLabel(sp, start, n, last) {
  if (!sp || !start) return last ? 'Last day' : `Day ${n}`;
  const d = sprintDayDate(sp, start, n, last);
  const wd = d ? new Date(d + 'T12:00').toLocaleDateString('en-US', { weekday: 'short' }) : '';
  return `${last ? 'Last day' : `Day ${n}`}${wd ? ` (${wd})` : ''}`;
}

export function stripHtml(strip) {
  const { info, days } = strip;
  return `<div class="strip-head"><h2>Sprint ${esc(info.id)}</h2><p class="soft">${esc(fmtDay(info.start))} to ${esc(fmtDay(info.end))} · ${info.day ? `day ${info.day} of ${info.total}` : `${info.total} working days`}</p></div>
    <div class="strip" role="list" aria-label="This sprint, day by day" tabindex="0">${days.map(d => d.off
      ? `<div class="sday off" role="listitem"><span class="wd">${esc(d.weekday)}</span><span class="dt num">${esc(d.date.slice(8))}</span><span class="soft">${d.holiday ? 'Holiday' : 'Off'}</span></div>`
      : `<div class="sday${d.today ? ' today' : ''}" role="listitem"${d.today ? ' aria-current="date"' : ''}><span class="wd">${esc(d.weekday)} <span class="num">${esc(d.date.slice(8))}</span></span><span class="dn">Day ${d.day}</span>
        ${d.ceremonies.map(c => `<span class="cer"><span class="cn">${esc(c.name)}</span>${c.minutes ? `<span class="soft num">${c.minutes} min</span>` : ''}</span>`).join('')}</div>`).join('')}</div>`;
}

export function cadenceHtml(v, ui, now) {
  const d = v.docket;
  const today = todayOf(now);
  const list = ui.draft || v.cadence;
  let top = '';
  let strip = null;
  if (d.state === 'newer') top = `<section class="engcard"><h2>Docket's sprint was saved by a newer Docket</h2><p>Update Workshop to see the sprint here. Nothing was changed.</p></section>`;
  else if (d.state !== 'ok') top = `<section class="engcard"><h2>Set your sprint in Docket first</h2><p>The sprint (start date, length, workdays and holidays) lives in Docket's Day view settings. The roadmap only reads it.</p>
    <p><button class="btn primary" data-open-docket>Open Docket's Day view</button></p></section>`;
  else {
    strip = sprintStrip(d.sprint, today, sortCeremonies(v.cadence));
    top = stripHtml(strip);
  }
  const sp = d.state === 'ok' ? d.sprint : null;
  const start = strip ? strip.info.start : null;
  const maxDay = sp ? sp.workdays.length * sp.lengthWeeks : 10;
  const recurring = v.recurring;
  const rows = list.map((c, i) => {
    const status = ui.draft ? '' : STATUS[ceremonyStatus(c, v.offers, recurring)];
    const dues = [opt('last', dueLabel(sp, start, 1, true), c.last), ...Array.from({ length: Math.max(maxDay, c.dueDay || 1) }, (_, k) => k + 1).map(n => opt(n, dueLabel(sp, start, n, false), !c.last && c.dueDay === n))];
    return `<tr data-ci="${i}">
      <td><input data-cf="name" value="${esc(c.name)}" maxlength="300" placeholder="Backlog refinement" aria-label="Ceremony"></td>
      <td><select data-cf="due" aria-label="Day">${dues.join('')}</select></td>
      <td><input data-cf="minutes" type="number" min="0" max="1440" step="5" value="${esc(c.minutes ?? '')}" aria-label="Minutes"></td>
      <td><input data-cf="planKind" value="${esc(c.planKind)}" maxlength="40" placeholder="meetings" aria-label="Docket block kind"></td>
      <td><input data-cf="role" value="${esc(c.role)}" maxlength="80" placeholder="Facilitator" aria-label="Your role"></td>
      <td class="soft">${esc(status)}</td>
      <td><button class="ibtn" data-cdel aria-label="Remove ${esc(c.name || 'this ceremony')}">×</button></td></tr>`;
  }).join('');
  return top + `<section class="cadence" aria-label="Ceremonies">
    <div class="cad-head"><h2>Ceremonies</h2><p class="soft">Each one happens once a sprint, on its sprint day. <b>Send to Docket</b> offers them as every-sprint tasks. Accept them in Docket's Day view settings.</p></div>
    ${list.length ? `<div class="tablewrap"><table class="cer-table"><thead><tr><th>Ceremony</th><th>Day</th><th>Minutes</th><th>Plan into</th><th>Role</th><th>Docket</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="soft">No ceremonies yet.</p>'}
    <div class="acts left"><button class="btn" data-cadd>Add a ceremony</button>${ui.draft ? '<button class="btn primary" data-csave>Save</button><button class="lnk" data-ccancel>Cancel</button>' : ''}
      <span class="grow"></span>${v.cadence.length ? `<button class="btn${ui.draft ? '' : ' primary'}" data-send${ui.draft ? ' disabled title="Save first"' : ''}>Send to Docket</button>` : ''}</div>
  </section>`;
}

/* ---------- settings ---------- */

export function settingsHtml(v) {
  const s = v.settings;
  return `<form class="settings" data-settings>
    <label>Products, one per line<textarea name="products" rows="5" placeholder="Product A: Project\\Team A, Project\\Team B">${esc(productsText(v.products))}</textarea>
      <span class="soft">A name, a colon, then its area paths. Each product is a lane. Work under a path counts for that product.</span></label>
    <label class="chk"><input type="checkbox" name="useQueueAreas"${s.useQueueAreas ? ' checked' : ''}> Also use Queue's area paths${v.queue.areas.length ? `: ${esc(v.queue.areas.join(', '))}` : ' (none set)'}</label>
    <div class="two">
      <label>Stale after (days without a change)<input name="staleDays" type="number" min="1" max="180" value="${s.staleDays}"></label>
      <label>Refresh every (minutes)<input name="refreshMinutes" type="number" min="5" max="240" value="${s.refreshMinutes}"></label>
    </div>
    <label>ADO connection name<input name="connection" value="${esc(s.connection)}" placeholder="${esc(v.queue.connection || 'Same as Queue')}"></label>
    <p class="soft">Saved in your Workshop folder. The roadmap only reads ADO.</p>
    <div class="acts left"><button class="btn primary">Save</button><button type="button" class="lnk" data-tab="roadmap">Back</button></div>
  </form>`;
}

/** The page: header, status, tabs, then the tab. */
export function render(v, ui, now, embedded) {
  const setup = setupCard(v, embedded);
  if (setup) return head(v) + setup;
  if (ui.tab === 'settings') return head(v) + `<h2 class="sub">Settings</h2>` + settingsHtml(v);
  const body = ui.tab === 'cadence' ? cadenceHtml(v, ui, now)
    : (adoCard(v) || (ui.tab === 'releases' ? releasesHtml(v, ui, now) : roadmapHtml(v, ui, now)));
  return head(v) + statusLine(v, now) + tabs(ui) + `<div class="body" role="tabpanel">${body}</div>`;
}

