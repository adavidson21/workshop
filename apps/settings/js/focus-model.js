/* Settings, Focus hours: the pure parts of the page (no DOM), so test/focus-page.test.mjs can drive them.
   The rules themselves (resolution, validation, history) are in shared/focus.js. */
import * as F from '../../../shared/focus.js';

export const DAY_LABEL = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const LUNCH_WORD = { taken: 'Taken', late: 'Late', partial: 'Partly', missed: 'Missed', skipped: 'Skipped', '': '' };

/** The form's starting value: what is saved, or the defaults on first open (docs/focus.md). */
export function formValue(env) {
  const meta = env && env.schema === F.SCHEMA && env.meta ? env.meta : null;
  if (!meta) return { value: F.defaults(), saved: false };
  const clean = F.cleanSettings(meta);
  return { value: clean, saved: true };
}

/** One line about today with the form's hours: "Today: focus 09:00 to 12:00, lunch 12:00 to 13:00 (from Day plan)". */
export function previewText(meta, dayplan, now = new Date()) {
  if (!meta || !meta.enabled) return 'Focus hours are off. Nothing is held.';
  const f = F.resolveFocus({ settings: Object.assign({}, meta, { enabled: true }), day: null, dayplan, now: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0) });
  const focus = f.blocks.length ? `focus ${f.blocks.map(b => `${b.start} to ${b.end}`).join(', ')}` : 'no focus';
  const lunch = f.lunchBlocks.length ? `lunch ${f.lunchBlocks.map(b => `${b.start} to ${b.end}`).join(', ')}` : 'no lunch';
  const fromDp = meta.dayplanOverride && dayplan && ((Array.isArray(dayplan.focus)) || dayplan.lunch);
  return `Today: ${focus}, ${lunch}${fromDp ? ' (from Day plan)' : ''}`;
}

const hm = m => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + String(m % 60).padStart(2, '0') + 'm' : ''}` : `${m}m`;
/** History table rows as text: [{date, focus, lunch, released}]. */
export function historyText(rows) {
  return rows.map(r => ({
    date: new Date(r.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
    focus: r.planned ? `${hm(r.kept)} of ${hm(r.planned)}` : '',
    lunch: LUNCH_WORD[r.lunch] || '',
    released: r.released ? String(r.released) : ''
  }));
}

/** The meta to save from the form value (stamped). */
export function metaToSave(value, now = Date.now()) {
  const v = F.cleanSettings(value) || F.defaults();
  return Object.assign(v, { enabled: value.enabled === true, updatedAt: now });
}
