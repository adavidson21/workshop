/* Agents: the state the view draws from. main.js fills it; view.js only reads it (and the copy list).
   Kept in one object so the view can be tested in Node without a page or a connection. */
const freshUi = () => ({
  open: {}, drafts: {}, picks: {}, busy: {}, menu: null, remove: null, file: null, settings: null, start: null, repo: null,
  // tab: inbox | chat | work | reviews (pages.js). run: the folder whose page is open (any flow), back: the tab it
  // returns to. step: the step in view on a run page, per folder (flows.js). walk: Go through them in the Inbox
  // ({i, done: {key: 1}}), or null.
  tab: 'inbox', run: null, back: null, step: {}, walk: null,
  // flow: the Work tab's flow filter ('all' or a flow id).
  flow: 'all',
  // project: the project sheet; projects: the projects list (overflow menu); move: the move sheet.
  project: null, projects: false, move: null,
  // prReview: the paste box on the Reviews tab ({open, busy, error}).
  prReview: null
});

export const S = {
  D: null,              // the opencode connector's `state` result: the .work model plus liveMode
  L: null,              // D.liveMode.live: sessions, prompts, questions, autopilot, item links
  conn: 'connecting',   // 'connecting' | 'on' | 'off' (Workshop not reachable)
  connector: null,      // {state, message} from the agent, or null before the first answer
  version: '',          // the connector's version
  mode: 'local',        // the SDK's run mode
  embedded: true,       // inside the Workshop shell (the shell shows the name and owns the theme)
  canNotify: false,     // the Notification API exists
  now: 0, today: '', yest: '',
  copyStore: [],        // texts for the Copy buttons in the last paint, by index
  view: { project: 'all' }, // this browser's view prefs: the project filter on Runs and Ship (local.js)
  // PRs waiting on you, from the ADO connector's sync.prs (main.js loadInbox). state: idle, loading, ok, error, off.
  inbox: { state: 'idle', items: [], notes: [], error: null, at: 0 },
  slate: new Map(),     // ADO id -> {route, note, title}: the Slate request a run came from (Slate's summary)
  files: {},            // .work files shown inline ("<folder>/<file>"), read through file.read: {text, error, at, loading}
  // UI state that must survive repaints: open sections, drafts, question picks, busy buttons, overlays, the tab.
  ui: freshUi()
};

export function resetUi() { S.ui = freshUi(); }
