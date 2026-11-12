/* Docket: Tandem's first-pass PR reviews on PR tasks. Pure functions with no DOM, so Node tests can import them.

   When the opencode connector is on and its "Review new PRs as soon as they are found" setting is on
   (prReviews.onSync), every ADO sync hands the PRs waiting on you to the connector (pr.inbox.save), which
   queues /pr-review for the new ones. Docket then reads where each review stands (pr.reviews):

   - Blocking PRs (you are a required reviewer) become tasks right away, with t.pr.ai = {state: 'pending'}.
   - Asked and team-only PRs wait in state.ado.prHeld until their review is done, the reviewer asks
     something, it fails, or the hold limit passes (state.ado.prHoldMinutes, default 60). Then they become
     tasks, already reviewed.
   - With the connector off or down, or the setting off, held PRs become tasks at once and new PRs land
     as they always did.

   Nothing here posts to Azure DevOps: /pr-review only drafts comments in Tandem's .work folder.

   t.pr.ai: {state, rec, risk, counts: {blocking, shouldFix, optional}, commit, message, at}
     state: pending | done | asking | failed | timeout
   state.ado.prHeld: [{key, since, item}] where item is the PR as the sync gave it. */

export const PR_AI_STATES = ['pending', 'done', 'asking', 'failed', 'timeout'];
export const PR_HOLD_DEFAULT = 60, PR_HOLD_MIN = 5, PR_HOLD_MAX = 24 * 60;
const MAX_HELD = 200;

const str = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
const count = v => Number.isInteger(v) && v >= 0 ? Math.min(v, 999) : 0;

/** A clean t.pr.ai, or null. */
export function cleanAi(a){
  if (!a || typeof a !== 'object' || !PR_AI_STATES.includes(a.state)) return null;
  const o = {state: a.state};
  if (a.state === 'done'){
    o.rec = str(a.rec, 60); o.risk = str(a.risk, 20);
    const c = a.counts && typeof a.counts === 'object' ? a.counts : {};
    o.counts = {blocking: count(c.blocking), shouldFix: count(c.shouldFix), optional: count(c.optional)};
  }
  const commit = str(a.commit, 40); if (/^[0-9a-f]{7,40}$/i.test(commit)) o.commit = commit.toLowerCase();
  const message = str(a.message, 300); if (message) o.message = message;
  if (typeof a.at === 'string' && !isNaN(Date.parse(a.at))) o.at = a.at.slice(0, 40);
  return o;
}

/** Minutes a lower-priority PR may wait for its review. */
export function cleanHoldMinutes(v){
  const m = Math.round(+v);
  return m >= PR_HOLD_MIN && m <= PR_HOLD_MAX ? m : PR_HOLD_DEFAULT;
}

/** state.ado.prHeld, cleaned. `cleanPr` is state.js's (it needs the item's key). */
export function cleanHeld(list, cleanPr){
  if (!Array.isArray(list)) return [];
  const seen = new Set(), out = [];
  for (const h of list){
    if (!h || typeof h !== 'object' || !h.item || typeof h.item !== 'object') continue;
    const link = cleanPr(h.item); if (!link || seen.has(link.key)) continue;
    seen.add(link.key);
    const item = {...h.item, key: link.key};
    for (const k of ['title', 'created', 'commit']) if (item[k] != null && typeof item[k] !== 'string') delete item[k];
    if (typeof item.title === 'string') item.title = item.title.slice(0, 500);
    out.push({key: link.key, since: typeof h.since === 'string' && !isNaN(Date.parse(h.since)) ? h.since : new Date(0).toISOString(), item});
    if (out.length >= MAX_HELD) break;
  }
  return out;
}

/** Whether a new PR waits for its review before it becomes a task. */
export const holdsNew = (aiOn, link) => !!aiOn && !link.waiting && link.tier !== 'blocking';

/** The PR's source commit, as the sync gave it (connector only; the helper has none). */
export const commitOf = it => typeof it.commit === 'string' && /^[0-9a-f]{7,40}$/i.test(it.commit) ? it.commit.toLowerCase() : null;

/** What pr.reviews says, as t.pr.ai; null for "never queued and nothing in .work" or a skipped run. */
export function aiFromStatus(s, now){
  if (!s) return null;
  const at = now.toISOString();
  if (s.state === 'queued' || s.state === 'running') return {state: 'pending', at};
  if (s.state === 'done'){
    const c = s.counts || {};
    return cleanAi({state: 'done', rec: s.recommendation || '', risk: s.risk || '', counts: {blocking: c.blocking, shouldFix: c.shouldFix, optional: c.optional}, commit: s.reviewedCommit || '', at});
  }
  if (s.state === 'asking' || s.state === 'failed') return cleanAi({state: s.state, message: s.message || '', at});
  return null;
}

/**
 * Applies pr.reviews results.
 *   tasks     every task (only open PR tasks with t.pr.ai change)
 *   held      state.ado.prHeld
 *   statuses  pr.reviews' prs, by PR id (string) -> status
 *   holdMs    the hold limit
 * Returns {changed, release: [{entry, ai}], held} where `held` is what stays held. The caller makes
 * tasks from `release`. A task's state never goes back to pending from done unless the review is
 * queued again (a new commit).
 */
export function applyStatuses({tasks, held, statuses, now, holdMs}){
  let changed = 0;
  for (const t of tasks){
    if (!t.pr || t.done || !t.pr.ai) continue;
    const s = statuses.get(String(t.pr.id));
    const ai = aiFromStatus(s, now);
    if (!ai){
      if (t.pr.ai.state !== 'pending') continue;
      if (s && s.state === 'skipped'){ t.pr.ai = {state: 'failed', message: s.message || 'Skipped.', at: now.toISOString()}; changed++; }
      else if (t.pr.ai.at && now - Date.parse(t.pr.ai.at) >= holdMs){ t.pr.ai = {state: 'timeout', at: now.toISOString()}; changed++; } // never queued (a full queue)
      continue;
    }
    if (ai.state === t.pr.ai.state && JSON.stringify({...ai, at: 0}) === JSON.stringify({...t.pr.ai, at: 0})) continue;
    t.pr.ai = ai; changed++;
  }
  const release = [], keep = [];
  for (const h of held){
    const s = statuses.get(String(h.item.id ?? h.key.split('|').pop()));
    const ai = aiFromStatus(s, now);
    if (ai && ai.state !== 'pending'){ release.push({entry: h, ai}); continue; }
    if (s && s.state === 'skipped'){ release.push({entry: h, ai: {state: 'failed', message: s.message || 'Skipped.', at: now.toISOString()}}); continue; }
    if (now - Date.parse(h.since) >= holdMs){ release.push({entry: h, ai: {state: 'timeout', at: now.toISOString()}}); continue; }
    keep.push(h);
  }
  return {changed: changed + release.length, release, held: keep};
}

/** Short words for a task row's chip. */
export function aiLabel(ai){
  if (!ai) return '';
  if (ai.state === 'pending') return 'AI reviewing';
  if (ai.state === 'asking') return 'AI needs you';
  if (ai.state === 'failed') return 'AI review failed';
  if (ai.state === 'timeout') return 'AI review late';
  const rec = /request/i.test(ai.rec) ? 'Changes' : /clarif/i.test(ai.rec) ? 'Questions' : /approve/i.test(ai.rec) ? 'Approve' : 'Reviewed';
  return `AI: ${rec}`;
}

/** One line for the tooltip and the drawer. */
export function aiTip(ai){
  if (!ai) return '';
  if (ai.state === 'pending') return 'Tandem is doing a first-pass review. Drafts only, nothing is posted.';
  if (ai.state === 'asking') return `Tandem stopped to ask something${ai.message ? `: ${ai.message}` : ''}. Answer it in Dispatch.`;
  if (ai.state === 'failed') return `Tandem's review did not finish${ai.message ? `: ${ai.message}` : '.'}`;
  if (ai.state === 'timeout') return 'Tandem had not finished reviewing within the hold limit, so it is here without one. It may still finish.';
  const c = ai.counts || {}, bits = [];
  if (c.blocking) bits.push(`${c.blocking} blocking`);
  if (c.shouldFix) bits.push(`${c.shouldFix} should-fix`);
  if (c.optional) bits.push(`${c.optional} optional`);
  return `${ai.rec || 'Reviewed'}${ai.risk ? `, ${ai.risk} risk` : ''}. ${bits.length ? bits.join(', ') + ' draft comments.' : 'No draft comments.'}`;
}

/** Which chip look: 'gate' when it needs you or the review says it needs changes, 'warn' for high risk. */
export function aiTone(ai){
  if (!ai) return '';
  if (ai.state === 'asking') return 'gate';
  if (ai.state === 'done'){
    if (/high/i.test(ai.risk) || (ai.counts && ai.counts.blocking)) return 'warn';
    return 'ok';
  }
  return ai.state === 'pending' ? 'live' : '';
}
