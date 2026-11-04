/* Releases: the HTML. Pure functions with no DOM or SDK, so Node tests can import them. Every string from ADO,
   other apps or the person is escaped with esc(). Timelines (roadmaps) are Runway's job, not this app's. */
import {
  ago, buildLanes, ceremonyStatus, esc, isDate, productsText, releaseHealth, sortCeremonies, sprintDayDate, sprintStrip, todayOf
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
  { id: 'releases', name: 'Release health' },
  { id: 'cadence', name: 'Sprint cadence' }
];

const gear = '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 6h12M4 14h12"/><circle cx="8" cy="6" r="2" fill="var(--bg)"/><circle cx="12.5" cy="14" r="2" fill="var(--bg)"/></svg>';
const chevron = '<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 5l5 5-5 5"/></svg>';

function head(v) {
  const canRefresh = v.ado.state === 'ready' && v.snap.areas.length + v.products.length + v.queue.areas.length > 0;
  return `<header class="phead">
    <div><p class="eyebrow">Azure DevOps</p><h1 class="page-title">Releases</h1></div>
    <div class="acts">
      ${canRefresh ? `<button class="btn" data-refresh${v.refreshing ? ' disabled' : ''}>Refresh</button>` : ''}
      <button class="btn" data-open-app="runway" title="Roadmaps and timelines, ad hoc or from ADO, are in Runway">Roadmaps in Runway</button>
      <button class="btn primary" data-scope title="Opens Dispatch. Use Start work there to scope it.">Scope new work</button>
      <button class="ibtn" data-tab="settings" title="Releases settings" aria-label="Releases settings">${gear}</button>
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
    return `<section class="engcard" role="status"><h2>Allow Workshop to use your folder to see your releases</h2>
      <p>${embedded ? 'Click <b>Allow</b> in the bar at the top of Workshop.' : 'Open Workshop and click <b>Allow</b> in the bar at the top.'} Chrome asks again after it restarts.</p></section>`;
  }
  if (v.newer) return `<section class="engcard"><h2>Saved by a newer Releases</h2><p>Update Workshop to use Releases here. Nothing was changed.</p></section>`;
  return '';
}

function adoCard(v) {
  if (v.items.length) return '';
  if (v.ado.state === 'browser') {
    return `<section class="engcard"><h2>Release health needs Workshop on this computer</h2>
      <p>Release health reads Epics and Features from Azure DevOps through Workshop on this computer. Start Workshop, then click <b>Connect</b> on the rail. Sprint cadence works without it.</p></section>`;
  }
  if (v.ado.state === 'off') {
    return `<section class="engcard"><h2>Turn on the ADO connector</h2><p>${esc(v.ado.message)}</p>
      <p>In Settings, add your ADO connection and turn the connector on. Releases only reads ADO, so Work Items (Read) is enough.</p>
      <p><button class="btn primary" data-open-app="settings">Open Settings</button></p></section>`;
  }
  if (!v.products.length && !(v.settings.useQueueAreas && v.queue.areas.length)) {
    return `<section class="engcard"><h2>Which area paths are your products?</h2>
      <p>Each product groups its versions. Name it and list its area paths. Queue's area paths are used too, unless you turn that off.</p>
      <p><button class="btn primary" data-tab="settings">Set up products</button></p></section>`;
  }
  return '';
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
  else if (d.state !== 'ok') top = `<section class="engcard"><h2>Set your sprint in Docket first</h2><p>The sprint (start date, length, workdays and holidays) lives in Docket's Day view settings. Releases only reads it.</p>
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
      <span class="soft">A name, a colon, then its area paths. Each product groups its versions. Work under a path counts for that product.</span></label>
    <label class="chk"><input type="checkbox" name="useQueueAreas"${s.useQueueAreas ? ' checked' : ''}> Also use Queue's area paths${v.queue.areas.length ? `: ${esc(v.queue.areas.join(', '))}` : ' (none set)'}</label>
    <div class="two">
      <label>Stale after (days without a change)<input name="staleDays" type="number" min="1" max="180" value="${s.staleDays}"></label>
      <label>Refresh every (minutes)<input name="refreshMinutes" type="number" min="5" max="240" value="${s.refreshMinutes}"></label>
    </div>
    <label>ADO connection name<input name="connection" value="${esc(s.connection)}" placeholder="${esc(v.queue.connection || 'Same as Queue')}"></label>
    <p class="soft">Saved in your Workshop folder. Releases only reads ADO.</p>
    <div class="acts left"><button class="btn primary">Save</button><button type="button" class="lnk" data-tab="releases">Back</button></div>
  </form>`;
}

/** The page: header, status, tabs, then the tab. */
export function render(v, ui, now, embedded) {
  const setup = setupCard(v, embedded);
  if (setup) return head(v) + setup;
  if (ui.tab === 'settings') return head(v) + `<h2 class="sub">Settings</h2>` + settingsHtml(v);
  const body = ui.tab === 'cadence' ? cadenceHtml(v, ui, now)
    : (adoCard(v) || releasesHtml(v, ui, now));
  return head(v) + statusLine(v, now) + tabs(ui) + `<div class="body" role="tabpanel">${body}</div>`;
}

