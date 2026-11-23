/* Workshop shell: the agents dock in the sidebar (docs/sdk.md, Flow). Shows every piece of agent work and where it is
   on its line, on every app, so you can see the flow without opening Builds.

   An app sends what it has with ws.flow.set({lines, items}) (Builds does, from its floor): `lines` names each line's
   stations in order, and each item says which line it is on, the station it is at (an index) and its state:
     run    an agent is working on it (its dot pulses)
     gate   it waits on you (amber)
     stuck  it was pulled off the line (red)
     idle   queued, or waiting on CI and people
   A click opens the app at the item's route. The dock knows nothing about Tandem: any app could send a flow. */

const STATES = new Set(['run', 'gate', 'stuck', 'idle']);
const STATE_WORD = { run: 'Working', gate: 'Waiting on you', stuck: 'Pulled off the line', idle: 'Waiting' };
/** How many items the dock lists before "N more in <app>". */
export const DOCK_MAX = 6;

const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

/** A flow as an app sent it, checked and trimmed: {lines: {id: [names]}, items: [...]}. Throws on a bad shape. */
export function cleanFlow(p) {
  if (!p || typeof p !== 'object') throw Object.assign(new Error('A flow needs lines and items.'), { code: 'bad_request' });
  const lines = {};
  for (const [id, names] of Object.entries(p.lines && typeof p.lines === 'object' ? p.lines : {}).slice(0, 8)) {
    if (!/^[a-z][a-z0-9-]{0,30}$/.test(id) || !Array.isArray(names)) continue;
    lines[id] = names.slice(0, 16).map(n => str(n, 40));
  }
  const items = [];
  for (const it of (Array.isArray(p.items) ? p.items : []).slice(0, 50)) {
    if (!it || typeof it !== 'object' || !str(it.title, 1)) continue;
    const line = lines[it.line] ? it.line : null;
    const of = line ? lines[line].length : 0;
    const at = Number.isInteger(it.at) && it.at >= 0 && it.at < of ? it.at : -1;
    items.push({
      title: str(it.title, 120), line, at,
      station: str(it.station, 40) || (line && at >= 0 ? lines[line][at] : ''),
      state: STATES.has(it.state) ? it.state : 'idle',
      route: str(it.route, 300), tag: str(it.tag, 24)
    });
  }
  return { lines, items, label: str(p.label, 40) };
}

/** Which item comes first: waiting on you, then stuck, then working, then the rest (each in the order sent). */
const RANK = { gate: 0, stuck: 1, run: 2, idle: 3 };
export function sortItems(items) {
  return items.map((it, i) => ({ it, i })).sort((a, b) => (RANK[a.it.state] - RANK[b.it.state]) || (a.i - b.i)).map(x => x.it);
}

/** The dots of one item's track: 'done' before its station, its own state at it, 'todo' after. */
export function trackOf(item, lines) {
  const names = (item.line && lines[item.line]) || [];
  return names.map((name, i) => ({ name, kind: item.at < 0 ? 'todo' : i < item.at ? 'done' : i === item.at ? item.state : 'todo' }));
}

/** The dock, drawn into `el`. `go(appId, path)` opens an app; `esc` escapes text for HTML. */
export function createFlowDock(el, { go, esc, names = id => id }) {
  const flows = new Map(); // app id -> {lines, items, label, at}
  let html = null;

  function render() {
    const all = [];
    for (const [app, f] of flows) for (const it of f.items) all.push({ app, it, lines: f.lines });
    el.hidden = flows.size === 0;
    if (!flows.size) { el.innerHTML = ''; html = null; return; }
    const sorted = sortItems(all.map(x => Object.assign({}, x.it, { _app: x.app, _lines: x.lines })));
    const shown = sorted.slice(0, DOCK_MAX);
    const working = sorted.filter(x => x.state === 'run').length;
    const yours = sorted.filter(x => x.state === 'gate').length;
    const first = flows.keys().next().value;
    const label = (flows.get(first) && flows.get(first).label) || 'Agents';
    const sum = sorted.length ? [working && `${working} working`, yours && `${yours} for you`].filter(Boolean).join(', ') || `${sorted.length} waiting` : 'Nothing on the line';
    const row = it => {
      const track = trackOf(it, it._lines);
      const where = it.at < 0 ? (it.station || STATE_WORD[it.state]) : it.station;
      return `<li><button type="button" class="fd-item s-${it.state}" data-flow-app="${esc(it._app)}" data-flow-path="${esc(it.route)}"`
        + ` title="${esc(`${it.title}\n${where ? where + ' · ' : ''}${STATE_WORD[it.state]}`)}">`
        + `<span class="fd-dot" aria-hidden="true"></span>`
        + `<span class="fd-body"><span class="fd-name">${it.tag ? `<span class="fd-tag">${esc(it.tag)}</span>` : ''}${esc(it.title)}</span>`
        + `<span class="fd-where">${esc(where || '')}<span class="sr-only">, ${esc(STATE_WORD[it.state])}</span></span>`
        + (track.length ? `<span class="fd-track" aria-hidden="true">${track.map(t => `<i class="k-${t.kind}"></i>`).join('')}</span>` : '')
        + `</span></button></li>`;
    };
    const next = `<button type="button" class="fd-head" data-flow-app="${esc(first)}" data-flow-path="" title="Open ${esc(names(first))}">`
      + `<span class="fd-title">${esc(label)}</span><span class="fd-sum${working ? ' busy' : ''}${yours ? ' you' : ''}">${working ? '<span class="fd-pulse" aria-hidden="true"></span>' : ''}${esc(sum)}</span>`
      + `<span class="fd-n" aria-hidden="true">${sorted.length || ''}</span></button>`
      + (shown.length ? `<ul class="fd-list">${shown.map(row).join('')}</ul>` : '')
      + (sorted.length > shown.length ? `<button type="button" class="fd-more" data-flow-app="${esc(first)}" data-flow-path="">${sorted.length - shown.length} more in ${esc(names(first))}</button>` : '');
    // Same markup: leave it, so hover and focus survive the frequent updates.
    if (next !== html) { el.innerHTML = next; html = next; }
  }

  el.addEventListener('click', e => {
    const b = e.target.closest('[data-flow-app]');
    if (!b) return;
    go(b.dataset.flowApp, b.dataset.flowPath || '');
  });

  return {
    set(appId, p) { flows.set(appId, Object.assign(cleanFlow(p), { at: Date.now() })); render(); },
    clear(appId) { if (flows.delete(appId)) render(); },
    get size() { return flows.size; },
    render
  };
}
