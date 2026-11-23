/* Settings, Focus hours (docs/focus.md): the switch, weekly focus blocks, lunch, "Day plan can override", a preview
   of today, and the History table. Saves Settings' `focus` collection meta (settings.focus v1); the day items
   are written by the shell's bar control, and cleaned up here (14 days for overrides, 90 days for the log).
   Nothing changes for anyone until this page is saved: until then focus hours are off. */
import * as F from '../../../shared/focus.js';
import { cardDay, readCards } from '../../../shared/summary.js';
import { DAY_LABEL, formValue, historyText, metaToSave, previewText } from './focus-model.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function mountFocus({ ws, el, toast, now = () => new Date() }) {
  let env = null, val = F.defaults(), saved = false, dayplan = null, saving = false;
  const sec = document.createElement('section');
  sec.className = 'card focus-card';
  el.appendChild(sec);
  const hist = document.createElement('section');
  hist.className = 'card focus-history';
  el.appendChild(hist);
  let histOpen = false; // History folds away; it stays open across repaints once opened
  let exactOpen = false; // Exact times fold away under the grid
  sec.addEventListener('toggle', e => { if (e.target.matches('details.fh-exact')) exactOpen = e.target.open; }, true);
  // Painting: press on a half hour to start (it flips), drag over others to give them the same state.
  let paintDay = null, paintOn = true, painted = null;
  const cellAt = e => e.target.closest && e.target.closest('[data-cell]');
  sec.addEventListener('pointerdown', e => {
    const c = cellAt(e);
    if (!c) return;
    e.preventDefault();
    paintOn = !c.classList.contains('on');
    painted = new Map();
    paintDay = true;
    mark(c);
  });
  function mark(c) {
    c.classList.toggle('on', paintOn);
    const d = c.dataset.cell;
    if (!painted.has(d)) painted.set(d, new Set(SLOTS.filter(m => inBlocks(val.week[d], m))));
    const set = painted.get(d), m = +c.dataset.m;
    if (paintOn) set.add(m); else set.delete(m);
  }
  sec.addEventListener('pointerover', e => { if (!paintDay) return; const c = cellAt(e); if (c) mark(c); });
  window.addEventListener('pointerup', () => {
    if (!paintDay) return;
    paintDay = null;
    for (const [d, set] of painted) setSlots(d, set);
    painted = null;
    paint();
  });
  hist.addEventListener('toggle', e => { if (e.target.matches('details.fh-hist-fold')) histOpen = e.target.open; }, true);

  async function load() {
    try { env = await ws.data.get(F.COLLECTION); } catch (e) { env = null; }
    if (env && env.schema !== F.SCHEMA) env = null;
    ({ value: val, saved } = formValue(env));
    try { dayplan = F.dayplanOf(cardDay(readCards(await ws.data.get('summary', { app: 'tasks' }), 'tasks')?.get('day'), F.dateStr(now()))); } catch (e) { dayplan = null; }
    await cleanup();
    paint();
  }

  // Day items: overrides older than 14 days dropped, items older than 90 days tombstoned.
  async function cleanup() {
    if (!env) return;
    const next = F.cleanupEnvelope(env, F.dateStr(now()));
    if (!next) return;
    try { const r = await ws.data.put(F.COLLECTION, next); env = Object.assign(next, { rev: r.rev }); } catch (e) { /* next time */ }
  }

  const blockRow = (d, b, i, errs, warns) => {
    const err = errs.find(x => x.day === d && x.i === i), warn = warns.find(x => x.day === d && x.i === i);
    return `<div class="fh-block" data-day="${d}" data-i="${i}">
      <input type="time" aria-label="${DAY_LABEL[d]} block ${i + 1} start" data-f="start" value="${esc(b.start || '')}">
      <span aria-hidden="true">to</span>
      <input type="time" aria-label="${DAY_LABEL[d]} block ${i + 1} end" data-f="end" value="${esc(b.end || '')}">
      <button type="button" class="btn ghost small" data-remove aria-label="Remove ${DAY_LABEL[d]} block ${i + 1}">Remove</button>
      ${err ? `<span class="err">${esc(err.text)}</span>` : warn ? `<span class="warn-text">${esc(warn.text)}</span>` : ''}
    </div>`;
  };

  /* The week grid (Settings UX v1): drag across half hours to paint focus, like a calendar. Exact times stay
     editable below. Painting a day rebuilds that day's blocks from its painted half hours. */
  const G0 = 7 * 60, G1 = 19 * 60, STEP = 30;
  const SLOTS = Array.from({ length: (G1 - G0) / STEP }, (_, i) => G0 + i * STEP);
  const inBlocks = (list, m) => (list || []).some(b => F.isTime(b.start) && F.isTime(b.end) && F.toMin(b.start) <= m && m < F.toMin(b.end));
  const lunchAt = (d, m) => val.lunch.enabled && val.lunch.days.includes(d) && F.isTime(val.lunch.start) && F.toMin(val.lunch.start) <= m && m < F.toMin(val.lunch.start) + (val.lunch.minutes || 0);
  function setSlots(d, on) {
    // Blocks wholly outside the grid's hours are kept as they are; the rest come from the painted half hours.
    const outside = (val.week[d] || []).filter(b => F.isTime(b.start) && F.isTime(b.end) && (F.toMin(b.end) <= G0 || F.toMin(b.start) >= G1));
    const runs = [];
    for (const m of SLOTS) {
      if (!on.has(m)) continue;
      const last = runs[runs.length - 1];
      if (last && last.end === m) last.end = m + STEP; else runs.push({ start: m, end: m + STEP });
    }
    val.week[d] = [...outside, ...runs.map(r => ({ start: F.fromMin(r.start), end: F.fromMin(r.end) }))]
      .sort((a, b) => F.toMin(a.start) - F.toMin(b.start));
  }
  const PRESETS = { mornings: [540, 720], afternoons: [780, 960] };
  function gridHtml() {
    const head = F.WEEKDAYS.map(d => `<span class="fg-dh">${DAY_LABEL[d].slice(0, 3)}</span>`).join('');
    const rows = SLOTS.map(m => `<span class="fg-t">${m % 60 ? '' : F.fromMin(m).replace(/^0/, '')}</span>` + F.WEEKDAYS.map(d =>
      `<span class="fg-c${inBlocks(val.week[d], m) ? ' on' : ''}${lunchAt(d, m) ? ' lunch' : ''}" data-cell="${d}" data-m="${m}" title="${DAY_LABEL[d]} ${F.fromMin(m)}"></span>`).join('')).join('');
    return `<div class="fh-presets"><span class="sub">Quick start:</span><button type="button" class="btn small" data-preset="mornings">Mornings 9 to 12</button>
      <button type="button" class="btn small" data-preset="afternoons">Afternoons 1 to 4</button><button type="button" class="btn ghost small" data-preset="clear">Clear</button></div>
      <div class="fh-grid" role="grid" aria-label="Focus blocks: drag to paint, weekdays across, the day down"><span></span>${head}${rows}</div>
      <p class="cfg-help fh-legend"><span class="fg-key on"></span> Focus <span class="fg-key lunch"></span> Lunch. Drag to add or remove half hours.</p>`;
  }

  function paint() {
    const { errors, warnings } = F.validateSettings(val);
    const l = val.lunch;
    const lunchErr = errors.find(x => x.day === 'lunch');
    sec.innerHTML = `<h2 class="dup">Focus hours</h2>
      <p class="sub">Protected focus time and a protected lunch. During either, badges, pickups and new-item toasts wait and come back together when the block ends. Blocking pull requests still show during focus. Nothing is lost: every app keeps syncing and saving.</p>
      <form class="fh-form">
        <div class="cfg-row cfg-check fh-switch"><input type="checkbox" class="toggle" role="switch" id="fhOn" data-on${val.enabled ? ' checked' : ''}><label for="fhOn">Focus hours ${val.enabled ? 'on' : 'off'}</label></div>
        ${saved ? '' : '<p class="cfg-help">Not saved yet. Focus hours stay off until you save this page.</p>'}
        <h3 class="shead">Weekly focus blocks</h3>
        ${gridHtml()}
        <details class="fh-exact"${exactOpen || errors.some(x => x.day !== 'lunch') ? ' open' : ''}><summary>Exact times</summary>
        <div class="fh-week">${F.WEEKDAYS.map(d => `<div class="fh-day" data-day="${d}"><span class="fh-dname">${DAY_LABEL[d]}</span>
          <div class="fh-blocks">${(val.week[d] || []).map((b, i) => blockRow(d, b, i, errors, warnings)).join('') || '<span class="state">No focus</span>'}
          <button type="button" class="btn ghost small" data-add="${d}">Add block</button></div></div>`).join('')}</div></details>
        <h3 class="shead">Lunch</h3>
        <div class="fh-lunch">
          <label class="switch"><input type="checkbox" data-lunch-on${l.enabled ? ' checked' : ''}> Protect lunch</label>
          <label>Start <input type="time" data-lunch-start value="${esc(l.start)}"></label>
          <label>Length <select data-lunch-min>${[30, 45, 60, 75, 90].concat(l.minutes && ![30, 45, 60, 75, 90].includes(l.minutes) ? [l.minutes] : []).map(m => `<option value="${m}"${m === l.minutes ? ' selected' : ''}>${m} minutes</option>`).join('')}</select></label>
          <span class="fh-ldays">${F.WEEKDAYS.map(d => `<label class="member"><input type="checkbox" data-lunch-day="${d}"${l.days.includes(d) ? ' checked' : ''}> ${DAY_LABEL[d].slice(0, 3)}</label>`).join('')}</span>
          ${lunchErr ? `<span class="err">${esc(lunchErr.text)}</span>` : ''}
        </div>
        <div class="cfg-row cfg-check"><input type="checkbox" id="fhDp" data-dp${val.dayplanOverride ? ' checked' : ''}><label for="fhDp">Day plan can override</label>
          <p class="cfg-help">On a day where Tasks' Day plan has Focus or Lunch sections, they replace these hours for that day.</p></div>
        <div class="cfg-row cfg-check"><input type="checkbox" id="fhAfter" data-after${val.afterEnd !== false ? ' checked' : ''}><label for="fhAfter">After my day ends</label>
          <p class="cfg-help">From your day's end until the next morning, badges and pickups wait, like at lunch. The end time comes from Tasks' Day settings (Day ends); the morning ends at Day starts or your first focus block.</p></div>
        <p class="fh-preview" aria-live="polite">${esc(previewText(val, dayplan, now()))}</p>
        <div class="acts left"><button class="btn primary" data-save${errors.length || saving ? ' disabled' : ''}>Save</button>
          ${errors.length ? `<span class="err">${errors.length === 1 ? 'Fix the line marked above to save.' : `Fix the ${errors.length} lines marked above to save.`}</span>` : ''}</div>
      </form>`;
    const rows = historyText(F.historyRows(env, F.dateStr(now())));
    hist.innerHTML = `<details class="fh-hist-fold"${histOpen ? ' open' : ''}><summary><h2>History</h2><span class="sub">The last 4 weeks. Private: only this page reads it.</span></summary>`
      + (rows.length ? `<div class="rows-wrap"><table class="rows fh-hist"><thead><tr><th>Date</th><th>Focus kept</th><th>Lunch</th><th>Held, then released</th><th>Evening</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${esc(r.date)}</td><td>${esc(r.focus)}</td><td>${esc(r.lunch)}</td><td>${esc(r.released)}</td><td>${esc(r.evening)}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="state">Nothing yet. Each day shows up here once a focus block or lunch ends.</p>') + '</details>';
  }

  // Edits change `val`; text fields repaint on change (not on every key), so typing a time is never cut off.
  sec.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('[data-on]')) val.enabled = t.checked;
    else if (t.matches('[data-dp]')) val.dayplanOverride = t.checked;
    else if (t.matches('[data-after]')) val.afterEnd = t.checked;
    else if (t.matches('[data-lunch-on]')) val.lunch.enabled = t.checked;
    else if (t.matches('[data-lunch-start]')) val.lunch.start = t.value;
    else if (t.matches('[data-lunch-min]')) val.lunch.minutes = +t.value;
    else if (t.matches('[data-lunch-day]')) { const d = t.dataset.lunchDay; val.lunch.days = F.WEEKDAYS.filter(x => x === d ? t.checked : val.lunch.days.includes(x)); }
    else if (t.matches('[data-f]')) { const row = t.closest('.fh-block'); val.week[row.dataset.day][+row.dataset.i][t.dataset.f] = t.value; }
    else return;
    paint();
  });
  sec.addEventListener('click', e => {
    const pre = e.target.closest('[data-preset]');
    if (pre) {
      const k = pre.dataset.preset;
      for (const d of F.WEEKDAYS) {
        if (k === 'clear') { val.week[d] = []; continue; }
        if (['sat', 'sun'].includes(d)) continue;
        const [a, b] = PRESETS[k];
        setSlots(d, new Set(SLOTS.filter(m => m >= a && m < b)));
      }
      paint();
      return;
    }
    const add = e.target.closest('[data-add]');
    if (add) {
      const d = add.dataset.add, list = val.week[d] || (val.week[d] = []);
      const last = list[list.length - 1];
      const s = last && F.isTime(last.end) ? Math.min(1380, F.toMin(last.end) + 60) : 540;
      list.push({ start: F.fromMin(s), end: F.fromMin(Math.min(1439, s + 120)) });
      paint();
      return;
    }
    const rm = e.target.closest('[data-remove]');
    if (rm) { const row = rm.closest('.fh-block'); val.week[row.dataset.day].splice(+row.dataset.i, 1); paint(); }
  });
  sec.addEventListener('submit', async e => {
    e.preventDefault();
    if (F.validateSettings(val).errors.length || saving) return;
    saving = true; paint();
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const base = env && env.schema === F.SCHEMA ? env : { schema: F.SCHEMA, version: F.VERSION, rev: 0, items: [], deleted: {} };
        const next = Object.assign({}, base, { meta: metaToSave(val) });
        try { const r = await ws.data.put(F.COLLECTION, next); env = Object.assign(next, { rev: r.rev }); saved = true; break; }
        catch (err) { if (err && err.code === 'conflict' && attempt === 0) { env = err.current || await ws.data.get(F.COLLECTION); continue; } throw err; }
      }
      toast(val.enabled ? 'Focus hours saved. Every app follows them now.' : 'Saved. Focus hours are off.', 'success');
    } catch (err) { toast((err && err.message) || "Couldn't save focus hours.", 'error'); }
    saving = false; paint();
  });

  ws.data.subscribe(F.COLLECTION, async () => {
    try { const fresh = await ws.data.get(F.COLLECTION); if (fresh && fresh.schema === F.SCHEMA) { env = fresh; paint(); } } catch (e) { /* keep */ }
  });
  await load();
  return { reload: load, get value() { return val; } };
}
