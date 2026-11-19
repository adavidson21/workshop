/* Noticed (Loom 6.1.0; plan: claude/diraigent-ideas-v1-plan.md in the Workshop project): what Tandem's agents noticed
   out of scope while they worked (eng-agents Core 4.8.0, .work/observations.md). The connector sends the open ones in
   state.observations; dismissing, starting or sending one to Docket is recorded by the connector, never in the file.
   A chip beside the lanes' filters shows them. No DOM: main.js paints what these return and handles the clicks. */
import { S } from './state.js';
import { h } from './view.js';

const KIND_NAMES = { bug: 'Bug', debt: 'Debt', docs: 'Docs', tests: 'Tests', idea: 'Idea' };

/** The open observations, newest first. */
export function noticedList() {
  const o = S.D && S.D.observations;
  return o && Array.isArray(o.open) ? o.open : [];
}
export const noticedCount = () => noticedList().length;

function row(o) {
  const busy = S.ui.busy && S.ui.busy['obs:' + o.id];
  const dis = busy ? ' disabled' : '';
  const meta = [o.repo, o.source ? 'from ' + o.source : '', o.date].filter(Boolean).map(h).join(' · ');
  return `<li class="obs" data-obs="${h(o.id)}"><span class="obs-kind k-${h(o.kind)}">${h(KIND_NAMES[o.kind] || 'Idea')}</span>` +
    `<div class="obs-body"><p class="obs-text">${h(o.text)}</p><p class="obs-meta">${meta}</p></div>` +
    `<div class="obs-do"><button type="button" class="btn primary" data-obs-start="${h(o.id)}"${dis} title="Start it as a Quick change">Start</button>` +
    `<button type="button" class="btn" data-obs-docket="${h(o.id)}"${dis} title="Add it to Docket as a task">To Docket</button>` +
    `<button type="button" class="btn ghost" data-obs-dismiss="${h(o.id)}"${dis}>Dismiss</button></div></li>`;
}

/** The Noticed list, in place of the lanes while its chip is on. */
export function noticedHtml() {
  const list = noticedList();
  if (!list.length) return '<div class="empty small"><p>Nothing noticed right now. When Tandem spots a bug, debt or missing docs outside the work it is doing, it shows here.</p></div>';
  return `<section class="noticed" aria-label="Noticed"><p class="hint">Things Tandem spotted outside the work it was doing. Start one as a Quick change, send it to Docket, or dismiss it.</p>` +
    `<ul class="obs-list" role="list">${list.map(row).join('')}</ul></section>`;
}

/** Docket's task offer for one observation (Workshop docs/handoffs.md, Receivers: prioritizer). */
export function observationTask(o, now = new Date()) {
  const notes = [`Noticed by Tandem (${o.id}, ${o.date}${o.source ? `, while working on ${o.source}` : ''}).`, o.repo ? `Repo: ${o.repo}` : ''].filter(Boolean).join('\n');
  return {
    id: `h_obs_${o.id}`,
    to: 'prioritizer',
    date: now.toISOString().slice(0, 10),
    createdAt: now.toISOString(),
    text: o.text,
    accepted: true,
    payload: { kind: 'task', title: String(o.text).slice(0, 300), notes },
    source: { app: 'slate', id: `obs-${o.id}` }
  };
}

/** What observation.start sends to start.local, as Slate's work offer wants it (title, description, lane). Kept the
 *  same as the connector's lib/observations.mjs startArgs. */
export function startArgsOf(o) {
  if (!o) return { title: '', lane: 'quick' };
  const lines = [o.text, '', `Noticed by Tandem (${o.id}, ${o.date}${o.source ? `, while working on ${o.source}` : ''}).`];
  if (o.repo) lines.push(`Repo: ${o.repo}`);
  return { title: o.text.length > 200 ? o.text.slice(0, 197) + '...' : o.text, description: lines.join('\n'), lane: 'quick' };
}
