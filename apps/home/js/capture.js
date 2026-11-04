/* Home: quick capture (docs/hub.md). A rules-only capture box at the top of Home, so a task, receipt or note can be
   captured with no AI, in every mode. Accepted captures go to Home's own `handoffs` collection with
   accepted: true (docs/handoffs.md); Docket, Rapport and Notes add them when they next load. A question, or
   Ctrl+Enter, opens the hub in Dispatch with the text filled in.

   Names come from the people directory (Settings' `people`, docs/people.md) and list names from Docket, both read
   only. */
import { mountCapture } from '../../../shared/capture-box.js';

const localDay = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

/* What the rules need, from the directory and Docket. Both are optional: missing means no names or lists. */
export function captureContext({ people, lists } = {}, now = new Date()) {
  const ppl = people && people.schema === 'settings.people' && people.version === 1 ? (people.items || []) : [];
  const ls = lists && lists.schema === 'prioritizer.lists' && Array.isArray(lists.items) ? lists.items : [];
  return {
    today: localDay(now),
    people: ppl.filter(p => p && p.id && p.name && !p.archived).map(p => ({ id: p.id, name: p.name, relation: p.relation })),
    lists: ls.filter(l => l && typeof l.name === 'string' && !l.archived).map(l => l.name)
  };
}

export function startCapture(ws, root) {
  let src = {};
  const read = async () => {
    const [people, lists] = await Promise.all([
      ws.data.get('people', { app: 'settings' }).catch(() => null),
      ws.data.get('lists', { app: 'prioritizer' }).catch(() => null)
    ]);
    src = { people, lists };
  };
  const box = mountCapture(root, {
    ws, sender: 'home',
    context: () => captureContext(src),
    onAsk: text => ws.open({ app: 'agents', path: 'hub/' + text }),
    placeholder: 'Capture a task, receipt or note. Ask with ?',
    hint: '<kbd>t</kbd> task · <kbd>w</kbd> waiting on · <kbd>r</kbd> receipt · <kbd>n</kbd> note · <kbd>?</kbd> ask in Dispatch · <kbd>&gt;</kbd> go'
  });
  read();
  ws.data.subscribe('people', read, { app: 'settings' });
  ws.data.subscribe('lists', read, { app: 'prioritizer' });
  ws.on('online', p => { if (p && p.online) read(); });
  return box;
}
