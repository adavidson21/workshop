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
const VIEWS = ['today','triage','rank','eisen','ve','people','archive','reports'];
const LENSES = {rank: 'List', eisen: 'Eisenhower', ve: 'Value / Effort'};
// Inside the Workshop shell (a same-origin frame), the shell owns the theme picker and the service worker.
const EMBEDDED = (() => { try { return window.parent !== window && window.parent.location.origin === location.origin; } catch(e){ return false; } })();
const NAV_OF = v => (v in LENSES) ? 'prio' : v;
// ADO behavior is Prioritizer's own data (state.ado), not the ADO connector's settings: how often to sync,
// and the starting value and urgent flag a PR review task gets for each tier. These are the defaults.
const ADO_SYNC_MINUTES = 10, ADO_SYNC_MIN = 2, ADO_SYNC_MAX = 240;
const PR_TIER_DEFAULTS = {blocking: {value: 4, urgent: true}, asked: {value: 3, urgent: false}, pool: {value: 2, urgent: false}};
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
  reports: svg('<path d="M3 16.5h14"/><rect x="4.5" y="9.5" width="2.6" height="5" rx=".7"/><rect x="8.7" y="5.5" width="2.6" height="9" rx=".7"/><rect x="12.9" y="11" width="2.6" height="3.5" rx=".7"/>'),
  archive: svg('<rect x="2.8" y="4" width="14.4" height="3.6" rx="1"/><path d="M4 7.6v7.4a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5V7.6M8 10.8h4"/>'),
  up: svg('<path d="M10 15.5v-11M5.5 9L10 4.5 14.5 9"/>', 1.6),
  top: svg('<path d="M10 16V8M6 11.5L10 7.5l4 4M4.5 4h11"/>', 1.6)
};
const NAV = [['today','Today',ICON.today],['triage','Triage',ICON.triage],['prio','Prioritize',ICON.prio],['people','People',ICON.people],['archive','Archive',ICON.archive],['reports','Reports',ICON.reports]];

export { ADO_SYNC_MAX, ADO_SYNC_MIN, ADO_SYNC_MINUTES, COLORS, EFFORTS, EMBEDDED, EQ, ICON, KEY, LENSES, NAV, NAV_OF, POINTS, PR_TIER_DEFAULTS, TIERS, UI_KEY, VALUE, VIEWS, VQ, WINDOW };
