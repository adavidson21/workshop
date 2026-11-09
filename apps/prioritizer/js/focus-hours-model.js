/* Docket: focus hours, the pure parts (focus-hours.js has the watch), so Node tests can drive them. */

const LABEL = {ado: n => `${n} new ADO item${n === 1 ? '' : 's'}`, pickup: n => `${n} capture${n === 1 ? '' : 's'} picked up`, pr: n => `${n} PR${n === 1 ? '' : 's'} to review`};
/** The held card's words from what was held, by kind: "3 new ADO items, 2 captures picked up". */
export function heldLabel(n, kinds = {}){
  const parts = Object.keys(LABEL).filter(k => kinds[k]).map(k => LABEL[k](kinds[k]));
  const rest = n - Object.values(kinds).reduce((a, b) => a + b, 0);
  if (rest > 0 && parts.length) parts.push(`${rest} more`);
  return parts.join(', ') || `${n} held in Docket`;
}

/* Focus hours (Workshop docs/focus.md): during focus only PRs blocked on you show and the rest is held; during
   lunch the whole strip folds. Returns the counts to show and how many are held. */
export function heldNeeds(n, state){
  if (state !== 'focus' && state !== 'lunch') return {n, held: 0};
  const held = n.ado + n.nudges.length + n.plan + (state === 'lunch' ? n.prs.length : 0);
  return {n: {ado: 0, prs: state === 'lunch' ? [] : n.prs, nudges: [], plan: 0}, held};
}
