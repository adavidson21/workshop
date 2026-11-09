/* Dispatch: the afternoon digest, "While you were focused" (Workshop docs/focus.md). Rules only, no AI. Pure, so
   Node tests drive it; main.js gathers the inputs and pages.js shows the card at the top of the Inbox tab.

   After a focus span ends (the latest one today that had focus in it), the card lists what was held in every app
   (their `held` summary cards for that span), runs waiting on you, and PR reviews that finished during the span,
   blocking ones first. One card per day: a later span replaces it. Dismiss hides it until tomorrow. With the
   opencode connector off it lists only what other apps report. */

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * span: {key, start, end} or null. held: heldFor() parts [{app, name, count, label, route}] for that span.
 * waiting: runs waiting on you (Dispatch's inbox count). reviews: PR review items [{folder, title, modifiedMs}].
 * blocking: Set of PR ids blocked on you. date: YYYY-MM-DD. dismissed: the date the card was dismissed.
 * Returns {key, until, lines: [{text, app, route, blocking?}]} or null when there is nothing to show.
 */
export function digestCard({ span = null, held = [], waiting = 0, reviews = [], blocking = new Set(), date = '', dismissed = '', spanMs = null } = {}) {
  if (!span || dismissed === date || span.key.slice(0, 10) !== date) return null;
  const lines = [];
  if (spanMs) {
    const done = reviews.filter(r => r && r.modifiedMs >= spanMs[0] && r.modifiedMs <= spanMs[1] + 60000)
      .map(r => ({ r, id: String(r.folder || '').replace(/^pr-/, '') }))
      .sort((a, b) => Number(blocking.has(b.id)) - Number(blocking.has(a.id)));
    for (const { r, id } of done.slice(0, 5)) lines.push({ text: `${blocking.has(id) ? 'Blocking PR' : 'PR'} review ready: ${r.title || '#' + id}`, app: 'agents', route: 'reviews', blocking: blocking.has(id) });
    if (done.length > 5) lines.push({ text: `${plural(done.length - 5, 'more PR review')} ready`, app: 'agents', route: 'reviews' });
  }
  if (waiting > 0) lines.push({ text: `${plural(waiting, 'run')} waiting on you`, app: 'agents', route: 'inbox' });
  for (const p of held) if (p.app !== 'agents') lines.push({ text: `${p.name}: ${p.label}`, app: p.app, route: p.route || '' });
  const mine = held.find(p => p.app === 'agents');
  if (mine && !waiting) lines.push({ text: mine.label, app: 'agents', route: 'inbox' });
  return lines.length ? { key: span.key, until: span.end, lines } : null;
}

/** The card's HTML. h: the page's escape function. */
export function digestHtml(card, h) {
  if (!card) return '';
  const t = card.until ? (() => { const hh = +card.until.slice(0, 2); return `${hh % 12 || 12}:${card.until.slice(3)}`; })() : '';
  return `<section class="digest" aria-labelledby="digestTitle"><div class="digest-head"><h3 id="digestTitle">While you were focused</h3>`
    + `<span class="hint">${t ? `Until ${h(t)}` : ''}</span><button type="button" class="lnk plain" data-digest-dismiss>Dismiss</button></div>`
    + `<ul>${card.lines.map(l => `<li><button type="button" class="lnk plain${l.blocking ? ' blocking' : ''}" data-digest-app="${h(l.app)}" data-digest-route="${h(l.route)}">${h(l.text)}</button></li>`).join('')}</ul></section>`;
}
