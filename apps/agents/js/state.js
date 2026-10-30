/* Agents: the state the view draws from. main.js fills it; view.js only reads it (and the copy list).
   Kept in one object so the view can be tested in Node without a page or a connection. */
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
  // UI state that must survive repaints: open sections, drafts, question picks, busy buttons, overlays.
  ui: { open: {}, drafts: {}, picks: {}, busy: {}, menu: null, remove: null, file: null, settings: null }
};

export function resetUi() {
  S.ui = { open: {}, drafts: {}, picks: {}, busy: {}, menu: null, remove: null, file: null, settings: null };
}
