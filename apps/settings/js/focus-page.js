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
  hist.addEventListener('toggle', e => { if (e.target.matches('details.fh-hist-fold')) histOpen = e.target.open; }, true);

  async function load() {
    try { env = await ws.data.get(F.COLLECTION); } catch (e) { env = null; }
    if (env && env.schema !== F.SCHEMA) env = null;
    ({ value: val, saved } = formValue(env));
    try { dayplan = F.dayplanOf(cardDay(readCards(await ws.data.get('summary', { app: 'prioritizer' }), 'prioritizer')?.get('day'), F.dateStr(now()))); } catch (e) { dayplan = null; }
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

  function paint() {
    const { errors, warnings } = F.validateSettings(val);
    const l = val.lunch;
    const lunchErr = errors.find(x => x.day === 'lunch');
    sec.innerHTML = `<h2>Focus hours</h2>
      <p class="sub">Protected focus time and a protected lunch. During either, badges, pickups and new-item toasts wait and come back together when the block ends. Blocking pull requests still show during focus. Nothing is lost: every app keeps syncing and saving.</p>
      <form class="fh-form">
        <div class="cfg-row cfg-check fh-switch"><input type="checkbox" class="toggle" role="switch" id="fhOn" data-on${val.enabled ? ' checked' : ''}><label for="fhOn">Focus hours ${val.enabled ? 'on' : 'off'}</label></div>
        ${saved ? '' : '<p class="cfg-help">Not saved yet. Focus hours stay off until you save this page.</p>'}
        <h3 class="shead">Weekly focus blocks</h3>
        <div class="fh-week">${F.WEEKDAYS.map(d => `<div class="fh-day" data-day="${d}"><span class="fh-dname">${DAY_LABEL[d]}</span>
          <div class="fh-blocks">${(val.week[d] || []).map((b, i) => blockRow(d, b, i, errors, warnings)).join('') || '<span class="state">No focus</span>'}
          <button type="button" class="btn ghost small" data-add="${d}">Add block</button></div></div>`).join('')}</div>
        <h3 class="shead">Lunch</h3>
        <div class="fh-lunch">
          <label class="switch"><input type="checkbox" data-lunch-on${l.enabled ? ' checked' : ''}> Protect lunch</label>
          <label>Start <input type="time" data-lunch-start value="${esc(l.start)}"></label>
          <label>Length <select data-lunch-min>${[30, 45, 60, 75, 90].concat(l.minutes && ![30, 45, 60, 75, 90].includes(l.minutes) ? [l.minutes] : []).map(m => `<option value="${m}"${m === l.minutes ? ' selected' : ''}>${m} minutes</option>`).join('')}</select></label>
          <span class="fh-ldays">${F.WEEKDAYS.map(d => `<label class="member"><input type="checkbox" data-lunch-day="${d}"${l.days.includes(d) ? ' checked' : ''}> ${DAY_LABEL[d].slice(0, 3)}</label>`).join('')}</span>
          ${lunchErr ? `<span class="err">${esc(lunchErr.text)}</span>` : ''}
        </div>
        <div class="cfg-row cfg-check"><input type="checkbox" id="fhDp" data-dp${val.dayplanOverride ? ' checked' : ''}><label for="fhDp">Day plan can override</label>
          <p class="cfg-help">On a day where Docket's Day plan has Focus or Lunch sections, they replace these hours for that day.</p></div>
        <div class="cfg-row cfg-check"><input type="checkbox" id="fhAfter" data-after${val.afterEnd !== false ? ' checked' : ''}><label for="fhAfter">After my day ends</label>
          <p class="cfg-help">From your day's end until the next morning, badges and pickups wait, like at lunch. The end time comes from Docket's Day settings (Day ends); the morning ends at Day starts or your first focus block.</p></div>
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
