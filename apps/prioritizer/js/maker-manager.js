/* Docket: the Maker/Manager Day plan template, and the "Overlaps lunch" check (focus hours, Workshop docs/focus.md).
   Pure, so Node tests drive it. day-view.js offers the template when there are no templates yet ("Use the
   Maker/Manager template", next to starting empty) and in Day plan settings ("Add Maker/Manager template", which
   only adds a template and never replaces one).

   The blocks come from Settings, Focus hours when it is set: the morning focus block and the lunch. Otherwise the
   defaults: Maker morning 09:00 for 180 minutes, Lunch 12:00 for 60, Manager afternoon 13:00 for 120, Reviews and
   admin 15:00 for 120. */
import { cleanTemplate, fromMin, isTime, sprintsOn, toMin } from './dayplan-model.js';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
export const MANAGER_NAME = 'Manager afternoon (1:1s and meetings, 25 or 50 min)';
const rid = () => Math.random().toString(36).slice(2, 9);

/** The template's blocks: from focus hours meta (Settings) when it has a weekday focus block or a lunch, else defaults. */
export function makerManagerSections(focus){
  let start = 540, focusMin = 180, lunchAt = 720, lunchMin = 60;
  const week = focus && focus.week;
  const first = week ? DAYS.map(d => (Array.isArray(week[d]) ? week[d] : [])[0]).find(b => b && isTime(b.start) && isTime(b.end) && toMin(b.end) > toMin(b.start)) : null;
  if (first){ start = toMin(first.start); focusMin = toMin(first.end) - start; }
  const l = focus && focus.lunch;
  if (l && l.enabled && isTime(l.start) && Number.isInteger(l.minutes)){ lunchAt = toMin(l.start); lunchMin = l.minutes; }
  else if (first) lunchAt = Math.max(lunchAt, start + focusMin);
  const managerAt = lunchAt + lunchMin;
  const at = m => fromMin(Math.min(m, 1439));
  return [
    {id: rid(), name: 'Maker morning', kind: 'focus', color: 'sage', around: at(start), minutes: focusMin, capacity: null},
    {id: rid(), name: 'Lunch', kind: 'lunch', color: 'butter', around: at(lunchAt), minutes: lunchMin, capacity: null},
    {id: rid(), name: MANAGER_NAME, kind: 'meetings', color: 'sky', around: at(managerAt), minutes: 120, capacity: null},
    {id: rid(), name: 'Reviews and admin', kind: 'admin', color: 'peach', around: at(managerAt + 120), minutes: 120, capacity: null}
  ];
}

/**
 * The template. assign: true for every sprint day and the last day (with sprints) or every workday (without), as
 * the first template; false for one added from settings, which you assign yourself.
 */
export function makerManagerTemplate(sp, focus, {assign = true} = {}){
  const len = (sp && sp.lengthWeeks ? sp.lengthWeeks : 2) * 5;
  const wd = (sp && sp.workdays) || [1, 2, 3, 4, 5];
  return cleanTemplate({
    id: rid(), name: 'Maker/Manager',
    days: assign && sprintsOn(sp) ? Array.from({length: len}, (_, i) => i + 1) : [],
    last: !!assign && sprintsOn(sp),
    weekdays: assign && !sprintsOn(sp) ? wd.slice() : [],
    sections: makerManagerSections(focus)
  });
}

/**
 * The lunch for a day: the first section of kind `lunch` with a time and length, else Settings' lunch for that
 * weekday (when focus hours and lunch are on). {start, end} in minutes, or null.
 */
export function lunchOn(sections, focus, weekday){
  const kindOf = s => String(s.kind || '').trim().toLowerCase();
  const own = (sections || []).find(s => s && !s.lost && kindOf(s) === 'lunch' && isTime(s.around) && s.minutes > 0);
  if (own) return {start: toMin(own.around), end: toMin(own.around) + own.minutes, id: own.id};
  const l = focus && focus.enabled && focus.lunch;
  const key = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][weekday];
  if (l && l.enabled && isTime(l.start) && Array.isArray(l.days) && l.days.includes(key)) return {start: toMin(l.start), end: toMin(l.start) + (l.minutes || 60), id: null};
  return null;
}
/** True when a section of another kind overlaps that lunch ("Overlaps lunch" in the Day view; a warning, not a block). */
export function overlapsLunch(s, lunch){
  if (!s || !lunch || s.lost || s.id === lunch.id || String(s.kind || '').trim().toLowerCase() === 'lunch' || !isTime(s.around) || !(s.minutes > 0)) return false;
  const a = toMin(s.around), b = a + s.minutes;
  return a < lunch.end && lunch.start < b;
}
