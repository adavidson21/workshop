/* Docket: every-sprint offers from other apps (offers-model.js), inside Workshop only. Reads each sender's
   `handoffs` collection (read only), and on Accept or Dismiss changes only Docket's own day plan: the every-sprint
   items and dayplan/settings meta.handled. On its own site Docket shares no data folder with other apps
   (Workshop docs/handoffs.md, rule 5), so it shows nothing. */
import { SENDERS, sendersFrom, acceptedTasks, applyOffer, listFor, markHandled, pendingOffers, taskFromOffer } from './offers-model.js';
import { dp, setHandled, setRecurring } from './dayplan.js';
import { COLORS } from './constants.js';
import { commit, isWaiting, state, topLists } from './state.js';
import { todayStr, uid } from './util.js';
import { toast } from './overlays.js';
import { embedded } from './ws.js';

const envs = {};
const watched = new Set();
let onChange = () => {};
let wsh = null;

const here = () => embedded && !!wsh;

async function load(app){
  try { envs[app] = await wsh.data.get('handoffs', {app}); } catch (e) { envs[app] = null; }
  pickUp(app);
}

/* Accepted captures from Home and the Dispatch hub (Workshop docs/handoffs.md, rule 4): added as tasks with no
   second click, then marked handled in Docket's own data. Never while Docket waits for the folder. */
function pickUp(app){
  if (!here() || isWaiting() || !state || !Array.isArray(state.tasks)) return 0;
  const todo = acceptedTasks(app, envs[app], dp.handled, state.tasks);
  if (!todo.length) return 0;
  const fallback = (topLists()[0] || {}).id;
  if (!fallback) return 0;
  let rank = state.tasks.reduce((m, t) => Math.max(m, t.rank || 0), 0);
  for (const o of todo){
    const t = taskFromOffer(o, {id: uid(), listId: listFor(o, state.lists, fallback), rank: ++rank,
      color: COLORS[state.colorIdx++ % COLORS.length], today: todayStr()});
    state.tasks.push(t);
  }
  setHandled(markHandled(dp.handled, todo.map(o => o.key)));
  commit();
  toast(todo.length === 1 ? `Added "${todo[0].title}" from ${todo[0].from}` : `Added ${todo.length} tasks from ${todo[0].from}`);
  return todo.length;
}

/* Called once by storage.js after the day plan loaded. render is called when offers change. */
async function offersBoot(ws, {render}){
  if (!embedded) return;
  wsh = ws; onChange = render;
  // Senders come from the manifests (ws.apps.list); SENDERS is kept in place so names show in the Day view too.
  const found = sendersFrom(ws.apps && ws.apps.list ? await ws.apps.list().catch(() => []) : []);
  for (const k of Object.keys(SENDERS)) delete SENDERS[k];
  Object.assign(SENDERS, found);
  await Promise.all(Object.keys(SENDERS).map(watchSender));
  onChange();
}

/* Start reading one app's `handoffs` collection, and again whenever it changes. Called for each SENDERS id. */
async function watchSender(app){
  if (!wsh || watched.has(app)) return;
  watched.add(app);
  await load(app);
  wsh.data.subscribe('handoffs', async () => { await load(app); onChange(); }, {app});
}

/* Offers waiting, oldest first. Empty on Docket's own site. */
function offers(){
  if (!here()) return [];
  return [...watched].flatMap(app => pendingOffers(app, envs[app], dp.handled));
}

/* Accept: add the every-sprint item, or update the one accepted from the same source. Returns {item, updated}. */
function acceptOffer(key){
  const o = offers().find(x => x.key === key);
  if (!o) return null;
  const id = Math.random().toString(36).slice(2, 9);
  const r = applyOffer(dp.recurring, o, {id, listId: (topLists()[0] || {}).id || null});
  setHandled(markHandled(dp.handled, [o.key]));
  setRecurring(r.recurring);
  return {item: r.item, updated: r.updated, offer: o};
}

function dismissOffer(key){
  const o = offers().find(x => x.key === key);
  if (!o) return false;
  setHandled(markHandled(dp.handled, [o.key]));
  return true;
}

export { acceptOffer, dismissOffer, offers, offersBoot, pickUp, watchSender };
