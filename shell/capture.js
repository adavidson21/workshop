/* Workshop shell: the capture bar. One place to capture a task, waiting-on, receipt, note or roadmap idea, or to ask
   Tandem, from any app: the Capture button in the top bar, or Ctrl+. (Cmd+. on a Mac). It is the one quick capture
   (shared/capture-box.js, its rules and Recent list), saved as the `home` app (Needs you) to its `handoffs`
   collection, so Docket, Rapport, Folio, Runway and Slate add it when they next load.

   The SDK is connected as `home` the first time the bar opens, so pages that never capture pay nothing for it. */
import { connect } from '../shared/workshop-sdk.js';
import { mountCapture } from '../shared/capture-box.js';
import { TARGETS, useApps } from '../shared/capture.js';
import { readCards, targetsFor } from '../shared/summary.js';

const localDay = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export const CAPTURE_ICON = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11"/></svg>';

/**
 * Mount the bar's panel under `anchor` (the top bar). `go(app, path)` opens an app in the shell; `onClose` runs when
 * the panel closes. Returns {open(), close(), toggle(), isOpen()}.
 */
export function createCaptureBar(anchor, { go, onClose = () => {} } = {}) {
  let panel = null, box = null, ws = null, src = {}, ready = null, refresh = null;

  async function setup() {
    ws = await connect({ app: 'home' });
    const apps = await ws.apps.list().catch(() => []);
    useApps(apps);
    // The apps that take tasks, ideas and notes (TARGETS follows the manifests after useApps): their summaries'
    // `targets` cards name lists, roadmaps and note folders ("p <roadmap>: ...", "n <folder>: ...", "n today: ...").
    const takers = [...new Set([TARGETS.task, TARGETS.idea, TARGETS.note].filter(Boolean))];
    const read = async () => {
      const [dir, ...sums] = await Promise.all([ws.people.get().catch(() => null), ...takers.map(a => ws.data.get('summary', { app: a }).catch(() => null))]);
      const summaries = sums.map((env, i) => readCards(env, takers[i]));
      src = {
        today: localDay(),
        people: dir ? dir.items.filter(it => !it.archived) : [],
        lists: (targetsFor(summaries, 'task') || []).map(r => r.title),
        maps: (targetsFor(summaries, 'idea') || []).map(r => ({ id: r.id, title: r.title })),
        folders: (targetsFor(summaries, 'note') || []).map(r => ({ id: r.id, title: r.title }))
      };
    };
    refresh = () => read().catch(() => {});
    await refresh();
    for (const a of takers) ws.data.subscribe('summary', refresh, { app: a });
    ws.people.subscribe(refresh);
    box = mountCapture(panel.querySelector('.cb-box'), {
      ws, sender: 'home',
      context: () => ({ ...src, today: localDay() }),
      onAsk: text => { close(); go('agents', 'hub/' + text); },
      onGo: t => { close(); go(t.app, t.path || ''); },
      placeholder: "What's on your mind? Ask with ?",
      hint: '<kbd>t</kbd> task · <kbd>w</kbd> waiting on · <kbd>r</kbd> receipt · <kbd>n</kbd> note · <kbd>p</kbd> roadmap idea · <kbd>?</kbd> ask · <kbd>&gt;</kbd> go · <kbd>Esc</kbd> close'
    });
  }

  function open() {
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'capbar';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', 'Capture');
      panel.innerHTML = '<div class="cb-backdrop"></div><div class="cb-card"><section class="cb-box" aria-label="Quick capture"></section></div>';
      anchor.appendChild(panel);
      panel.querySelector('.cb-backdrop').addEventListener('click', close);
      panel.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const input = panel.querySelector('.cap-in');
        if (!input || !input.value) { e.preventDefault(); e.stopPropagation(); close(); }
      });
    }
    panel.hidden = false;
    if (!ready) ready = setup().catch(() => { panel.querySelector('.cb-box').innerHTML = '<p class="cb-err">Capture is not available right now. Try again in a moment.</p>'; });
    else if (refresh) refresh();
    ready.then(() => { const i = panel && panel.querySelector('.cap-in'); if (i) i.focus(); });
  }
  function close() {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    onClose();
  }
  return { open, close, toggle: () => (panel && !panel.hidden ? close() : open()), isOpen: () => !!panel && !panel.hidden };
}
