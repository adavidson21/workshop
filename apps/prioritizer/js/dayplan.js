/* Docket: the day plan's state and saving. The day plan is its own small board (dayplan-model.js), saved through
   the same write loop as the board (store.js) as the dayplan/* collections (dayplan-format.js). Every change the
   Day view makes goes through dpChange, which records it for undo and saves. */
import { cleanDayplan, cleanSprint, cleanTemplate, createHistory, freshDayplan } from './dayplan-model.js';
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
  return dstore;
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
function setSprint(sp){ dp.sprint = cleanSprint(sp); save(); }
function setTemplates(ts){ dp.templates = ts.map(cleanTemplate).filter(Boolean); save(); }
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

export { dayplanBoot, dpChange, dpRedo, dpUndo, dstore, ensureYear, history, importDayplan, setSprint, setTemplates, dp };
