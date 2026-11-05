/* Home: quick capture (docs/hub.md). A rules-only capture box right under the greeting, the most prominent thing on Home, so a task, receipt or note can be
   captured with no AI, in every mode. Accepted captures go to Home's own `handoffs` collection with
   accepted: true (docs/handoffs.md); Docket, Rapport and Notes add them when they next load. A question, or
   Ctrl+Enter, opens the hub in Dispatch with the text filled in.

   Names and @handles come from the people directory (ws.people, docs/people.md). List and roadmap names come from
   the `targets` cards in the summaries of the apps that take tasks and ideas (docs/summaries.md;
   "p <roadmap>: ..."). All read only. */
import { mountCapture } from '../../../shared/capture-box.js';
import { TARGETS, useApps } from '../../../shared/capture.js';
import { readCards, targetsFor } from '../../../shared/summary.js';

const localDay = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

/* What the rules need, from the directory and Docket. Both are optional: missing means no names or lists. */
export function captureContext({ dir, summaries = [] } = {}, now = new Date()) {
  return {
    today: localDay(now),
    people: dir ? dir.items.filter(it => !it.archived) : [],
    lists: (targetsFor(summaries, 'task') || []).map(r => r.title),
    maps: (targetsFor(summaries, 'idea') || []).map(r => ({ id: r.id, title: r.title }))
  };
}

export function startCapture(ws, root) {
  let src = {};
  // The apps that take tasks and ideas here (TARGETS follows the manifests once main.js called useApps).
  const takers = () => [...new Set([TARGETS.task, TARGETS.idea].filter(Boolean))];
  const read = async () => {
    const apps = takers();
    const [dir, ...sums] = await Promise.all([
      ws.people.get().catch(() => null),
      ...apps.map(a => ws.data.get('summary', { app: a }).catch(() => null))
    ]);
    src = { dir, summaries: sums.map((env, i) => readCards(env, apps[i])) };
  };
  const box = mountCapture(root, {
    ws, sender: 'home',
    context: () => captureContext(src),
    onAsk: text => ws.open({ app: 'agents', path: 'hub/' + text }),
    placeholder: 'Capture a task, receipt, note or roadmap idea. Ask with ?',
    hint: '<kbd>t</kbd> task · <kbd>w</kbd> waiting on · <kbd>r</kbd> receipt · <kbd>n</kbd> note · <kbd>p</kbd> roadmap idea · <kbd>?</kbd> ask in Dispatch · <kbd>&gt;</kbd> go'
  });
  read();
  // Capture targets and places follow the apps on this site (their manifests, ws.apps.list()), without holding
  // up the page; then read again for the apps that take tasks and ideas.
  const watched = new Set(takers());
  ws.apps.list().then(apps => {
    useApps(apps);
    for (const a of takers()) if (!watched.has(a)) { watched.add(a); ws.data.subscribe('summary', read, { app: a }); }
    read();
  }).catch(() => {});
  ws.people.subscribe(read);
  for (const a of watched) ws.data.subscribe('summary', read, { app: a });
  ws.on('online', p => { if (p && p.online) read(); });
  return box;
}
