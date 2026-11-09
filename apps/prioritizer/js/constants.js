/* Prioritizer: Constants: storage keys, the value/effort scales, quadrant names, views and icons. */
/* ---------- constants ---------- */
const KEY = 'prioritizer.v1', UI_KEY = 'prioritizer.ui';
const COLORS = ['blush','sage','lavender','butter','sky','peach']; // still stored for older copies of the app; no longer shown
const VALUE  = {1: 'Trivial', 2: 'Low', 3: 'Medium', 4: 'High'};
const EFFORTS = ['XS','S','M','L','XL'];
const POINTS = {XS: 1, S: 2, M: 3, L: 5, XL: 8};
const WINDOW = {4: 2, 3: 4, 2: 7, 1: 14};   // implied due window in days, by value
const TIERS  = [2, 1, 0.5];                 // score cutoffs for tiers 1 to 3; below is tier 4
const EQ = {
  do:       {title: 'Do first', sub: 'Important and urgent'},
  schedule: {title: 'Schedule', sub: 'Important, not urgent'},
  delegate: {title: 'Delegate', sub: 'Urgent, not important'},
  drop:     {title: 'Drop',     sub: 'Not urgent, not important'}
};
const VQ = {
  quick: {title: 'Quick wins', sub: 'High value, low effort'},
  big:   {title: 'Big bets',   sub: 'High value, high effort'},
  fill:  {title: 'Fill-ins',   sub: 'Low value, low effort'},
  pit:   {title: 'Money pits', sub: 'Low value, high effort'}
};
// Views with a page of their own. Triage and Prioritize (List, Eisenhower, Value / Effort) are columns of Today.
const VIEWS = ['today','day','people','archive'];
const LENSES = {rank: 'List', eisen: 'Eisenhower', ve: 'Value / Effort'};
// Inside the Workshop shell (a same-origin frame), the shell owns the theme picker and the service worker.
// A touch screen with no mouse (phones, tablets, the Android app): hints say "tap", keyboard hints are hidden.
const TOUCH = typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
const EMBEDDED = (() => { try { return window.parent !== window && window.parent.location.origin === location.origin; } catch(e){ return false; } })();
// Old view names (links, saved windows, the 3 and 4 keys) and where they go now: Today, with a column or a lens.
const OLD_VIEWS = {triage: {col: 'inbox'}, prio: {col: 'rank'}, prioritize: {col: 'rank'}, rank: {col: 'rank', lens: 'rank'}, eisen: {col: 'rank', lens: 'eisen'}, ve: {col: 'rank', lens: 've'}, focus: {}};
const NAV_OF = v => v;
// ADO behavior is Prioritizer's own data (state.ado), not the ADO connector's settings: how often to sync,
// and the starting value and urgent flag a PR review task gets for each tier. These are the defaults.
const ADO_SYNC_MINUTES = 10, ADO_SYNC_MIN = 2, ADO_SYNC_MAX = 240;
const PR_TIER_DEFAULTS = {blocking: {value: 4, urgent: true}, asked: {value: 3, urgent: false}, pool: {value: 2, urgent: false}};
// Which Day plan block kind each PR group goes into (blocking: you're required; pending: everything else that
// still needs you). Empty: not planned. PRs that don't need you never reach Docket (Workshop's ADO connector).
const PR_SLOT_DEFAULTS = {blocking: 'reviews', pending: 'admin'};
const svg = (d, w = 1.5) => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  check: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.3l2.3 2.3 4.7-5"/></svg>',
  dots: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/></svg>',
  plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>',
  chevL: svg('<path d="M12 4.5L6.5 10l5.5 5.5"/>', 1.6),
  chevR: svg('<path d="M8 4.5l5.5 5.5L8 15.5"/>', 1.6),
  chevD: '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4l2.5 2.5L7.5 4"/></svg>',
  tri: '<svg viewBox="0 0 12 12" fill="currentColor"><path d="M4 2.5l4.5 3.5L4 9.5z"/></svg>',
  x: svg('<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>', 1.6),
  menu: svg('<path d="M3.5 6h13M3.5 10h13M3.5 14h13"/>', 1.6),
  today: svg('<rect x="3" y="4.5" width="14" height="12" rx="2"/><path d="M3 8.5h14M7 2.8v3.2M13 2.8v3.2"/><circle cx="10" cy="12.5" r="1.4" fill="currentColor" stroke="none"/>'),
  triage: svg('<path d="M3 4.5h14l-5.3 6.3v4.4l-3.4 1.6v-6z"/>'),
  prio: svg('<path d="M4 5h12M4 10h8.5M4 15h5"/>', 1.7),
  people: svg('<circle cx="7.5" cy="7" r="2.7"/><path d="M2.8 16c.8-2.6 2.6-4 4.7-4s3.9 1.4 4.7 4"/><path d="M12.8 4.6a2.7 2.7 0 0 1 0 4.8M14.2 12.3c1.4.5 2.4 1.7 3 3.7"/>'),
  archive: svg('<rect x="2.8" y="4" width="14.4" height="3.6" rx="1"/><path d="M4 7.6v7.4a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5V7.6M8 10.8h4"/>'),
  up: svg('<path d="M10 15.5v-11M5.5 9L10 4.5 14.5 9"/>', 1.6),
  top: svg('<path d="M10 16V8M6 11.5L10 7.5l4 4M4.5 4h11"/>', 1.6),
  day: svg('<rect x="3" y="3.5" width="14" height="13" rx="2"/><path d="M6.5 7.5h7M6.5 10.5h4.5M6.5 13.5h6"/>'),
  // Signals on a task row and the header's icon buttons. Line icons, colored only when they need you.
  block: svg('<path d="M7 2.8h6l4.2 4.2v6L13 17.2H7L2.8 13V7z"/><path d="M6.6 10h6.8"/>'),
  bell: svg('<path d="M5.5 13.5V9a4.5 4.5 0 0 1 9 0v4.5l1.3 1.5H4.2z"/><path d="M8.3 17a1.8 1.8 0 0 0 3.4 0"/>'),
  wait: svg('<path d="M5.5 3h9M5.5 17h9M6.5 3c0 3.5 3.5 4.5 3.5 7s-3.5 3.5-3.5 7M13.5 3c0 3.5-3.5 4.5-3.5 7s3.5 3.5 3.5 7"/>'),
  stale: svg('<path d="M3.5 10a6.5 6.5 0 1 0 2-4.7"/><path d="M3.2 3.3v3.2h3.2"/><path d="M10 6.5V10l2.3 1.6"/>'),
  cal: svg('<rect x="3" y="4.5" width="14" height="12" rx="2"/><path d="M3 8.5h14M7 2.8v3.2M13 2.8v3.2"/>'),
  alert: svg('<path d="M10 3.2l7.2 12.6H2.8z"/><path d="M10 8.3v3.4"/><circle cx="10" cy="13.9" r=".7" fill="currentColor" stroke="none"/>'),
  repeat: svg('<path d="M4 9.5V7.5A2.5 2.5 0 0 1 6.5 5H15M13 3l2 2-2 2M16 10.5v2A2.5 2.5 0 0 1 13.5 15H5M7 13l-2 2 2 2"/>'),
  pr: svg('<circle cx="5.5" cy="4.5" r="1.8"/><circle cx="5.5" cy="15.5" r="1.8"/><circle cx="14.5" cy="15.5" r="1.8"/><path d="M5.5 6.3v7.4M14.5 13.7V8.5A2.5 2.5 0 0 0 12 6H9M10.5 4.2L8.7 6l1.8 1.8"/>'),
  item: svg('<rect x="4" y="3" width="12" height="14" rx="2"/><path d="M7 7.5h6M7 10.5h6M7 13.5h3.5"/>'),
  board: svg('<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M7.5 3.5v13M12.5 3.5v13"/>'),
  eye: svg('<path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z"/><circle cx="10" cy="10" r="2.3"/>'),
  bolt: svg('<path d="M11 2.5L4.5 11.2H10L9 17.5l6.5-8.7H10z"/>'),
  play: svg('<path d="M6.5 4.3v11.4l9-5.7z"/>'),
  pause: svg('<path d="M7 4.5v11M13 4.5v11"/>', 2),
  moon: svg('<path d="M15.8 12.6A6.5 6.5 0 0 1 7.4 4.2a6.5 6.5 0 1 0 8.4 8.4z"/>'),
  wand: svg('<path d="M3.5 16.5l9-9M11.5 3.5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7zM15.8 9.2l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4z"/>'),
  sun: svg('<circle cx="10" cy="10" r="3.2"/><path d="M10 2.6v1.7M10 15.7v1.7M2.6 10h1.7M15.7 10h1.7M4.8 4.8L6 6M14 14l1.2 1.2M4.8 15.2L6 14M14 6l1.2-1.2"/>'),
  gauge: svg('<path d="M3.5 14.5a6.5 6.5 0 1 1 13 0"/><path d="M10 14.5l3-4"/>'),
  addPerson: svg('<circle cx="8" cy="7" r="2.8"/><path d="M3 16c.8-2.6 2.7-4 5-4s4.2 1.4 5 4M15.5 5.5v5M13 8h5"/>'),
  noest: svg('<circle cx="10" cy="10" r="6" stroke-dasharray="2.2 2.2"/>'),
  crumb: svg('<path d="M4 15.5l1-3.8 8.3-8.3a1.9 1.9 0 0 1 2.7 2.7L7.7 14.4z"/><path d="M11.8 5l2.7 2.7"/>'),
  swap: svg('<path d="M4 7h11.5l-3-3M16 13H4.5l3 3"/>'),
  nudge: svg('<path d="M3.5 5.5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-3.5 3v-3a2 2 0 0 1-2-2z"/><path d="M7 8.5h6"/>'),
  back: svg('<path d="M8 5.5L4.5 9 8 12.5"/><path d="M4.5 9h7a4 4 0 0 1 0 8h-2"/>'),
  check20: svg('<path d="M4.5 10.5l3.5 3.5 7.5-8"/>', 1.8)
};
// List colors: a list's dot, on rows and in the sidebar. Picked from its id, so a list keeps its color.
const LIST_COLORS = 6;
const listColor = id => { let h = 0; for (const c of String(id || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % LIST_COLORS; };
// Initials for a person avatar: "Dana Lee" is DL, "DevA" is DA, "sam" is SA.
function initials(name){
  const s = String(name || '').trim(); if (!s) return '?';
  const words = s.split(/[\s._-]+/).filter(Boolean);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  const cap = [...s.slice(1)].find(c => c >= 'A' && c <= 'Z' || c >= '0' && c <= '9');
  return (s[0] + (cap || s[1] || '')).toUpperCase();
}
// [key, label, icon, shortcut]. Number keys follow the sidebar, top to bottom.
// Today on top, then the Review group. 3 and 4 go where Triage and Prioritize were: Today's Inbox and Ranked columns.
const NAV = [['today','Today',ICON.today,'1'],['day','Day',ICON.day,'2'],['people','People',ICON.people,'5'],['archive','Done',ICON.archive,'6']];
const NAV_KEYS = {1: 'today', 2: 'day', 3: 'triage', 4: 'prio', 5: 'people', 6: 'archive'};

export { OLD_VIEWS, initials, listColor, LIST_COLORS, NAV_KEYS, ADO_SYNC_MAX, ADO_SYNC_MIN, ADO_SYNC_MINUTES, COLORS, EFFORTS, EMBEDDED, EQ, ICON, KEY, LENSES, NAV, NAV_OF, POINTS, PR_SLOT_DEFAULTS, PR_TIER_DEFAULTS, TIERS, TOUCH, UI_KEY, VALUE, VIEWS, VQ, WINDOW };
