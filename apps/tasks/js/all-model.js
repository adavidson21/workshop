/* All tasks (Tasks 12.5.0): every open task in the lists you picked, in one place, so nothing that is not on a day
   is ever out of sight. Pure (test/all-view.test.mjs); all-view.js draws it.

   Filters: all (every open task), noday (not on Today, and not planned for a day), sort (no value or effort yet),
   waiting (handed to someone). Groups follow the board's list order, then rank. */

export const ALL_FILTERS = [['all', 'Everything'], ['noday', 'Not on a day'], ['sort', 'To sort'], ['waiting', 'Waiting']];

const triaged = t => t.value != null && t.effort != null;
const FILTER = {
  all: () => true,
  noday: (t, today) => t.focusOn !== today && !t.waiting,
  sort: t => !triaged(t),
  waiting: t => !!t.waiting
};

export const cleanFilter = f => (Object.hasOwn(FILTER, f) ? f : 'all');

/** Open tasks in `ids` that `shown` lets through, counted per filter: {all, noday, sort, waiting}. */
export function allCounts(tasks, ids, { today, shown = () => true } = {}) {
  const ok = new Set(ids);
  const open = tasks.filter(t => !t.done && ok.has(t.listId) && shown(t));
  return Object.fromEntries(Object.keys(FILTER).map(k => [k, open.filter(t => FILTER[k](t, today)).length]));
}

/** [{list, tasks}] in list order (`lists` as ordered), each by rank, empty lists left out. */
export function allGroups(tasks, lists, ids, { filter = 'all', today, shown = () => true } = {}) {
  const f = FILTER[cleanFilter(filter)], ok = new Set(ids);
  const open = tasks.filter(t => !t.done && ok.has(t.listId) && shown(t) && f(t, today));
  return lists.filter(l => ok.has(l.id))
    .map(list => ({ list, tasks: open.filter(t => t.listId === list.id).sort((a, b) => a.rank - b.rank) }))
    .filter(g => g.tasks.length);
}

/** Open tasks in `ids` that the filters hide: {n, personal, other} (personal: only by the Personal tasks switch). */
export function hiddenOf(tasks, ids, { shown, personalShown = () => true }) {
  const ok = new Set(ids);
  const hid = tasks.filter(t => !t.done && ok.has(t.listId) && !shown(t));
  const personal = hid.filter(t => !personalShown(t)).length;
  return { n: hid.length, personal, other: hid.length - personal };
}
