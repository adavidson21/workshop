/* Docket: every-sprint offers from other apps (offers-model.js), inside Workshop only. Reads each known sender's
   `handoffs` collection (read only), and on Accept or Dismiss changes only Docket's own day plan: the every-sprint
   items and dayplan/settings meta.handled. On its own site Docket shares no data folder with other apps
   (Workshop docs/handoffs.md, rule 5), so it shows nothing. */
import { SENDERS, applyOffer, markHandled, pendingOffers } from './offers-model.js';
import { dp, setHandled, setRecurring } from './dayplan.js';
import { topLists } from './state.js';
import { embedded } from './ws.js';

const envs = {};
let onChange = () => {};
let wsh = null;

const here = () => embedded && !!wsh;

async function load(app){
  try { envs[app] = await wsh.data.get('handoffs', {app}); } catch (e) { envs[app] = null; }
}

/* Called once by storage.js after the day plan loaded. render is called when offers change. */
async function offersBoot(ws, {render}){
  if (!embedded) return;
  wsh = ws; onChange = render;
  await Promise.all(Object.keys(SENDERS).map(load));
  for (const app of Object.keys(SENDERS)) ws.data.subscribe('handoffs', async () => { await load(app); onChange(); }, {app});
  onChange();
}

/* Offers waiting, oldest first. Empty on Docket's own site. */
function offers(){
  if (!here()) return [];
  return Object.keys(SENDERS).flatMap(app => pendingOffers(app, envs[app], dp.handled));
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

export { acceptOffer, dismissOffer, offers, offersBoot };
