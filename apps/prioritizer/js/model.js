import { POINTS, TIERS, WINDOW } from './constants.js';
import { addDays, daysBetween, today } from './util.js';
/* Prioritizer: The prioritization model: implied due dates, urgency, score, tiers, quadrants. Pure functions. */
/* ---------- prioritization model (Build spec: Derived logic) ---------- */
const isTriaged  = t => t.value != null && t.effort != null;
const impliedDue = t => t.value ? addDays(t.ageFrom, WINDOW[t.value]) : null;
function urgency(t, on = today()){
  if (t.urgentFlag) return 2;
  if (t.due){
    const d = daysBetween(on, t.due);           // negative when overdue
    return d <= 3 ? 2 : d <= 14 ? 1 : 0;
  }
  if (t.value && on > impliedDue(t)) return 1;
  return 0;
}
const isStale = t => !t.done && !t.due && !!t.value && daysBetween(t.ageFrom, today()) >= 2 * WINDOW[t.value];
const score = t => isTriaged(t) ? (t.value + urgency(t)) / POINTS[t.effort] : null;
function tier(t){
  const s = score(t);
  if (s == null) return null;                    // untriaged: no bar
  const i = TIERS.findIndex(c => s >= c);
  return i < 0 ? 4 : i + 1;
}
// Eisenhower needs value only; Value/Effort needs value and effort
const eKey = (t, on) => !t.value ? null
  : t.value >= 3 ? (urgency(t, on) === 2 ? 'do' : 'schedule')
  : (urgency(t, on) === 2 ? 'delegate' : 'drop');
const vKey = t => !isTriaged(t) ? null
  : t.value >= 3 ? (POINTS[t.effort] <= 2 ? 'quick' : 'big')
  : (POINTS[t.effort] <= 2 ? 'fill' : 'pit');
const ageDays = t => Math.max(0, daysBetween(t.ageFrom, today()));
// a manual urgent flag on important work that's been sitting more than a week
const stillUrgent = t => !t.done && t.urgentFlag && t.value >= 3 && !(t.due && daysBetween(today(), t.due) <= 3) && ageDays(t) > 7;
const nudgeDue = t => !t.done && t.waiting && t.nudgeOn && t.nudgeOn <= today();
const fmtScore = s => s == null ? '' : (Math.round(s * 10) / 10).toFixed(1);
function byScore(a, b){
  return (score(b) - score(a)) || (urgency(b) - urgency(a)) || (b.value - a.value) || (a.rank - b.rank);
}

export { ageDays, byScore, eKey, fmtScore, impliedDue, isStale, isTriaged, nudgeDue, score, stillUrgent, tier, urgency, vKey };
