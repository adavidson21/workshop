/* Docket's address (Workshop docs/sdk.md, Routes): where you are, written through ws.route.set, so Back, Forward,
   refresh and bookmarks land on the same place. Inside Workshop it is #/prioritizer/<path>; on Docket's own site,
   #/<path>. The paths are the manifest's routes: today, plan-week[/eisenhower | /value-effort], day/<date | today>,
   people, done and task/<id>.

   A new place (another view, or Plan week) is a new history entry. An open task, a day stepped by one or a lens
   changes the entry you are on, so Back leaves the place instead of closing a drawer. */
import { state } from './state.js';
import { planWeek } from './render.js';
import { drawerId } from './drawer.js';
import { dayPath } from './day-view.js';
import { ready } from './ws.js';

const LENS_PATH = {eisen: 'eisenhower', ve: 'value-effort'};
/** The place, without the open task. */
export function placePath(){
  const v = state.view;
  if (v === 'today') return planWeek() ? 'plan-week' + (LENS_PATH[state.lens] ? '/' + LENS_PATH[state.lens] : '') : 'today';
  if (v === 'day') return 'day/' + dayPath();
  if (v === 'archive') return 'done';
  return v;
}
/** The full path: the open task wins. */
export const here = () => drawerId ? 'task/' + drawerId : placePath();

let ws = null, lastPath = null, lastPlace = null;
ready.then(w => { ws = w && w.route && typeof w.route.set === 'function' ? w : null; });

/** Tell the shell (or the page) where Docket is. replace: a small change in the same place. force: answering a route
    event, so the address is written even when Docket did not move (a one-time path like shutdown, or an alias). */
export function reportRoute({replace = false, force = false} = {}){
  if (!ws || state.view == null) return;
  const place = placePath(), path = drawerId ? 'task/' + drawerId : place;
  if (path === lastPath && !force) return;
  const push = !replace && lastPlace !== null && place.split('/')[0] !== lastPlace.split('/')[0];
  // Leaving a place with a task open: its entry goes back to the place, so Back lands there, not on the task.
  if (push && lastPath !== lastPlace) ws.route.set(lastPlace, {replace: true}).catch(() => {});
  lastPath = path; lastPlace = place;
  ws.route.set(path, {replace: !push}).catch(() => {});
}
