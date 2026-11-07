/* Docket: the day plan's state and saving. The day plan is its own small board (dayplan-model.js), saved through
   the same write loop as the board (store.js) as the dayplan/* collections (dayplan-format.js). Every change the
   Day view makes goes through dpChange, which records it for undo and saves. */
import { autoPlan, cleanDayplan, cleanRecurring, cleanSprint, cleanTemplate, createHistory, freshDayplan, recurDue, sprintsOn } from './dayplan-model.js';
import { COLORS } from './constants.js';
import { commit, isWaiting, listById, state, topLists } from './state.js';
import { todayStr } from './util.js';
import { dayplanFormat, dpEnvelopesFromBundle, yearCol } from './dayplan-format.js';
import { createStore } from './store.js';

let dp = freshDayplan(), dstore = null;
let onChange = () => {};
const history = createHistory();

/* Called once by storage.js after the board loaded. render is called whenever the day plan changed. */
async function dayplanBoot(ws, {render, status}){
  onChange = render;
  dstore = createStore({
    data: ws.data,
    board: () => dp,
    applied: () => { cleanDayplan(dp); onChange(); },
    status,
    format: dayplanFormat()
  });
  await dstore.load();
  dstore.start();
  await linkWorkshop(ws);
  recurTick();
  setInterval(recurTick, 60000);
  return dstore;
}

/* Repeating tasks: make the tasks that are due to exist (dayplan-model.js, recurDue). Runs at startup, every
   minute (so a new sprint or day is picked up while Docket stays open), and when the items change.
   A daily or weekly task goes on the Today list. Making one also closes that item's older tasks that are still
   open, as won't do (skipped), so a missed "Check logs" doesn't pile up; they stay in Done. */
function recurTick(){
  if (!dstore || isWaiting() || !dp.recurring.length) return 0;
  const due = recurDue(dp, todayStr());
  if (!due.length) return 0;
  let maxRank = state.tasks.reduce((m, t) => Math.max(m, t.rank), 0), made = 0;
  for (const {item, id, start, due: dueOn, sprint, day} of due){
    item.made = [...item.made, start].slice(-12);
    if (state.tasks.some(t => t.id === id)) continue;
    ensureYear(dueOn);
    autoPlan(dp, item, id, dueOn);
    if (day){
      for (const old of state.tasks){
        if (old.done || !old.recur || old.recur.id !== item.id || !old.recur.day || old.recur.day >= day) continue;
        old.done = true; old.wontDo = true; old.doneAt = day;
      }
    }
    state.tasks.push({
      id, title: item.title, notes: item.notes || '', color: COLORS[0], rank: ++maxRank,
      value: item.value, effort: item.effort, due: dueOn, urgentFlag: false,
      listId: item.listId && listById(item.listId) ? item.listId : topLists()[0].id,
      done: false, doneAt: null, wontDo: false, createdAt: start, ageFrom: start,
      waiting: false, nudgeOn: null, focusOn: day || null, who: [],
      recur: day ? {id: item.id, day} : {id: item.id, sprint}
    });
    made++;
  }
  if (dstore) dstore.schedule();
  commit();
  return made;
}

/* Load the year a date is in, if this window has not yet (the Day view calls it for the date it shows). */
function ensureYear(date){
  if (!dstore || !date) return Promise.resolve();
  return dstore.addCollection(yearCol(date.slice(0, 4)));
}

/* Run a change to day records and save it. dates: every date the change may touch (for undo). */
function dpChange(dates, fn){
  const out = history.run(dp, dates, fn);
  dates.forEach(ensureYear);
  save();
  return out;
}
function dpUndo(){ const d = history.undo(dp); if (d){ save(); return true; } return false; }
function dpRedo(){ const d = history.redo(dp); if (d){ save(); return true; } return false; }
function setSprint(sp){
  const was = sprintsOn(dp.sprint);
  dp.sprint = cleanSprint(sp);
  save();
  if (sprintsOn(dp.sprint) !== was){ tellWorkshop(); recurTick(); }
}

/* Use sprints, inside Workshop: Workshop's Settings shows it as Docket's `sprints` switch (app.json settings,
   Workshop docs/app-settings.md). There Workshop's value counts and dp.sprint.enabled follows it; a change made
   here is sent to Workshop. On Docket's own site there is no registry, and dp.sprint.enabled is all there is. */
let wsLinked = null;
const SETTING = 'sprints';
async function linkWorkshop(ws){
  if (!ws || !ws.appSettings) return;
  try {
    if (!(await ws.appSettings.declared()).some(d => d.id === SETTING)) return; // not on a Workshop site
    wsLinked = ws;
    // Never set in Workshop yet: Docket's own choice (made before this Workshop knew about it) goes there.
    const env = await ws.data.get('app-settings', {app: 'settings'}).catch(() => null);
    const item = env && Array.isArray(env.items) ? env.items.find(x => x && x.id === 'prioritizer') : null;
    if (!item || !item.values || typeof item.values[SETTING] !== 'boolean'){ if (!sprintsOn(dp.sprint)) tellWorkshop(); }
    else fromWorkshop(item.values);
    ws.appSettings.subscribe(fromWorkshop);
  } catch (e) { /* Workshop's settings can't be read: Docket's own choice stands */ }
}
function fromWorkshop(values){
  const on = values && values[SETTING];
  if (typeof on !== 'boolean' || on === sprintsOn(dp.sprint)) return;
  dp.sprint = cleanSprint(Object.assign({}, dp.sprint, {enabled: on}));
  save(); recurTick();
}
const workshopLinked = () => !!wsLinked;
function tellWorkshop(){
  if (wsLinked) wsLinked.appSettings.set({[SETTING]: sprintsOn(dp.sprint)}).catch(() => {});
}
function setTemplates(ts){ dp.templates = ts.map(cleanTemplate).filter(Boolean); save(); }
function setRecurring(rs){
  // Keep what each item already made, so editing an item doesn't make this sprint's task again.
  const old = new Map(dp.recurring.map(r => [r.id, r.made]));
  dp.recurring = rs.map(r => cleanRecurring(Object.assign({}, r, {made: r.made || old.get(r.id) || []}))).filter(Boolean);
  save(); recurTick();
}
/* Keys of other apps' offers already accepted or dismissed (offers.js). Saved in dayplan/settings meta.handled. */
function setHandled(keys){ dp.handled = keys; save(); }
function save(){ if (dstore) dstore.schedule(); onChange(); }

/* A backup's day plan, merged in (storage.js calls this after importing the board). */
async function importDayplan(bundle){
  if (!dstore) return 0;
  const envs = dpEnvelopesFromBundle(bundle);
  const cols = Object.keys(envs);
  for (const c of cols) await dstore.addCollection(c);
  if (cols.length) await dstore.importEnvelopes(envs);
  return cols.length;
}

export { workshopLinked, recurTick, setHandled, setRecurring, dayplanBoot, dpChange, dpRedo, dpUndo, dstore, ensureYear, history, importDayplan, setSprint, setTemplates, dp };
