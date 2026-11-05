/* Docket: its summary for other apps (Workshop docs/summaries.md). Home's cards, Rapport's 1:1 prep and the
   targets in quick capture read prioritizer.summary instead of Docket's own collections, so Docket can change
   its own format without breaking them. Pure functions, no DOM, so Node tests can drive them; storage.js writes
   the cards with the shared writer (shared/summary.js).

   Cards (prioritizer.summary v1):
     board    counts per day for today and the next 6 days, Up next and the team (Home)
     day      the day plan's blocks per day for the same days, and Wrap up (Home's Now and Wrap up cards)
     lists    targets for capture: "task" (Home quick capture, the Dispatch hub)
     people   open and waiting tasks per person and group in Workshop's people directory, a person's through
              their groups too (Rapport's 1:1 prep)
   Days past the last one are stale: readers show nothing for them until Docket opens again. */
import { WINDOW } from './constants.js';
import { isTriaged } from './model.js';
import { addDays, daysBetween, isDate } from './util.js';
import { dayView, fromMin, isTime, isWorkday, sectionTasks, toMin } from './dayplan-model.js';
import { HORIZON, horizon } from '../shared/summary.js';
import * as D from '../shared/people.js';

export { HORIZON, horizon };
const WRAP_NO_SPRINT = '15:00';          // Wrap up with no sprint set: from 3 PM every day
const WRAP_BEFORE_END = 60;              // otherwise an hour before the Day view's day end, on working days

const str = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const isStaleOn = (t, date) => !t.done && !t.due && !!t.value && isDate(t.ageFrom) && daysBetween(t.ageFrom, date) >= 2 * WINDOW[t.value];

/* ---------- board ---------- */
export function boardDay(board, date){
  const known = new Set(board.lists.map(l => l.id));
  const all = board.tasks.filter(t => t && known.has(t.listId));
  const open = all.filter(t => !t.done);
  const weekEnd = addDays(date, 7);
  const focus = all.filter(t => t.focusOn === date && (!t.done || (!t.wontDo && t.doneAt === date)));
  return {
    total: all.length,
    open: open.length,
    focus: {total: focus.length, done: focus.filter(t => t.done).length},
    triage: open.filter(t => !isTriaged(t) || isStaleOn(t, date)).length,
    overdue: open.filter(t => isDate(t.due) && t.due < date).length,
    dueWeek: open.filter(t => isDate(t.due) && t.due >= date && t.due <= weekEnd).length
  };
}
/* Who an open task involves: for each id in any task's `who`, and each active person reached through a group,
   the open tasks and how (`via`: the group id, or '' when assigned directly). */
function involved(open, dir){
  const ids = new Set(open.flatMap(t => Array.isArray(t.who) ? t.who : []));
  for (const id of [...ids]) if (D.isGroupId(id)) D.membersOf(dir, id).forEach(p => ids.add(p.id));
  return [...ids].map(id => {
    const mine = open.filter(t => D.involves(dir, t.who, id)).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
    return {id, mine, via: t => { const v = D.involves(dir, t.who, id); return v === 'direct' ? '' : v || ''; }};
  }).filter(r => r.mine.length);
}
export function boardCard(board, today, dir = D.EMPTY){
  const listName = new Map(board.lists.map(l => [l.id, l.name]));
  const known = new Set(board.lists.map(l => l.id));
  const open = board.tasks.filter(t => t && known.has(t.listId) && !t.done);
  const upNext = open.filter(t => !t.waiting).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)).slice(0, 3).map(t => ({
    id: t.id, title: str(t.title, 300), list: board.lists.length > 1 ? str(listName.get(t.listId), 120) : '', listId: t.listId,
    due: isDate(t.due) ? t.due : null, who: Array.isArray(t.who) ? t.who.slice(0, 10) : [], triaged: isTriaged(t)
  }));
  const team = involved(open, dir).filter(r => D.isPersonId(r.id)).map(r => ({id: r.id, name: str(D.label(dir, r.id), 200), open: r.mine.length, waiting: r.mine.filter(t => t.waiting).length}))
    .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name)).slice(0, 50);
  return {id: 'board', kind: 'board', days: Object.fromEntries(horizon(today).map(d => [d, boardDay(board, d)])), upNext, team};
}

/* ---------- day plan and Wrap up ---------- */
export function dayBlocks(dp, date, tasksById){
  if (!dp || !dp.sprint || !dp.sprint.anchor) return [];
  const rec = dayView(dp, date).rec;
  const timed = (rec.sections || []).filter(s => s && !s.lost && isTime(s.around)).map(s => ({s, at: toMin(s.around)})).sort((a, b) => a.at - b.at);
  return timed.slice(0, 24).map(({s, at}, i) => {
    const end = s.minutes ? at + s.minutes : (timed[i + 1] ? timed[i + 1].at : at + 60);
    const tasks = sectionTasks(rec, s.id, tasksById).slice(0, 10).map(({task}) => ({id: task.id, title: str(task.title, 300), done: !!task.done}));
    return {name: str(s.name, 120) || 'Untitled', at: s.around, until: fromMin(end), tasks};
  });
}
export function wrapAt(dp, date){
  const sp = dp && dp.sprint;
  if (!sp || !sp.anchor) return WRAP_NO_SPRINT;
  if (!isWorkday(sp, date)) return null;
  return fromMin((toMin(sp.dayEnd) ?? 17 * 60) - WRAP_BEFORE_END);
}
export function dayCard(dp, log, board, today){
  const byId = new Map(board.tasks.map(t => [t.id, t]));
  const days = {};
  for (const d of horizon(today)){
    const events = log && log.days && log.days[d] && Array.isArray(log.days[d].events) ? log.days[d].events : [];
    days[d] = {
      blocks: dayBlocks(dp, d, byId),
      wrapAt: wrapAt(dp, d),
      wrapped: events.some(e => e && e.type === 'shutdown'),
      offered: (log && Array.isArray(log.handoffs) ? log.handoffs : []).filter(h => h && h.to === 'receipts' && h.date === d).length
    };
  }
  return {id: 'day', kind: 'day', days};
}

/* ---------- capture targets and people ---------- */
export function listsCard(board){
  return {id: 'lists', kind: 'targets', title: 'Lists', capture: 'task',
    rows: board.lists.slice(0, 200).map(l => ({id: l.id, title: str(l.name, 120) || 'Untitled'}))};
}
const taskRow = (t, via = '') => ({id: t.id, title: str(t.title, 300) || 'Untitled task', due: isDate(t.due) ? t.due : '', nudgeOn: isDate(t.nudgeOn) ? t.nudgeOn : '', via});
export function peopleCard(board, dir = D.EMPTY){
  const known = new Set(board.lists.map(l => l.id));
  const open = board.tasks.filter(t => t && known.has(t.listId) && !t.done);
  const rows = involved(open, dir).slice(0, 200).map(r => ({
    id: r.id,
    open: r.mine.filter(t => t.waiting !== true).slice(0, 20).map(t => taskRow(t, r.via(t))),
    waiting: r.mine.filter(t => t.waiting === true).slice(0, 20).map(t => taskRow(t, r.via(t)))
  }));
  return {id: 'people', kind: 'people', rows};
}

/** Every card, without updatedAt (the writer stamps them). board: {lists, tasks}; dir: the people directory;
    dp: the day plan; log: the focus log ({days, handoffs}); today: YYYY-MM-DD. */
export function buildSummary({board, dir = D.EMPTY, dp, log, today}){
  return [boardCard(board, today, dir), dayCard(dp, log, board, today), listsCard(board), peopleCard(board, dir)];
}
