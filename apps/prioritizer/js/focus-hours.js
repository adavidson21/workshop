/* Docket: focus hours and lunch (Workshop docs/focus.md). Settings' hours, or this Day plan's focus and lunch
   blocks, decide when Docket holds what can wait:
     - the Needs you strip shows only PRs blocked on you during focus, and folds during lunch;
     - the Inbox column folds to a rail with its count (captures and drops still land there);
     - ADO "new items" and pickup toasts are counted instead of shown, in Docket's `held` summary card.
   Nothing in the data waits: sync and pickups run as always. With focus hours off nothing here changes Docket.
   The rules are in shared/focus.js; this file holds the one watch and the holder, and the "where I left off" prompt
   the Today column shows when a focus block ends, lunch starts or focus starts now. */
import { createHolder, isHeldNow, resolveFocus, watchFocus } from '../../../shared/focus.js';
import { ready } from './ws.js';

const OFF = resolveFocus({});
let watch = null, holder = null;
let onRender = () => {}, onSummary = () => {}, onTransition = () => {};
let prev = OFF;

import { heldLabel } from './focus-hours-model.js';
export { heldLabel };

/** Starts watching. render(): repaint. summary(): rewrite the summary (the held card changed). transition(prev, f):
    the state changed (the left-off prompt listens). */
export function focusHoursBoot({render = () => {}, summary = () => {}, transition = () => {}} = {}){
  onRender = render; onSummary = summary; onTransition = transition;
  ready.then(ws => {
    if (!ws) return;
    watch = watchFocus(ws, f => {
      const before = prev; prev = f;
      if (holder) holder.sync(f);
      try { onTransition(before, f); } catch (e) { /* keep watching */ }
      onRender();
    });
    holder = createHolder(ws, {watch, label: heldLabel, route: 'today', onChange: () => onSummary()});
  });
}

/** What is focused now: resolveFocus()'s result (off until Workshop answers, and off with focus hours off). */
export const focusNow = () => watch ? watch.current : OFF;
export const heldNow = () => isHeldNow(focusNow());
/** Counts n held items of a kind (ado, pickup, pr). False when nothing is held right now (show it as usual). */
export function holdCount(n, kind){ return !!holder && n > 0 && holder.add(n, kind); }
/** The held summary card, or null. */
export const heldCard = () => holder ? holder.card() : null;
/** HH:MM the held span ends, for "held until 12:00". */
export function heldUntil(){ const f = focusNow(); return f.span ? f.span.end : f.until || ''; }
/** "12:00" as Docket shows times in focus lines ("1:00"). */
export function fmtUntil(s){ if (!s) return ''; const h = +s.slice(0, 2); return `${h % 12 || 12}:${s.slice(3)}`; }
/** Settings' focus hours (the collection's meta) or null, for the Maker/Manager template and the lunch warning. */
export const focusSettings = () => watch ? watch.settings : null;
