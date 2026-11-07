/* Notebook: the sections along the top (OneNote style) and the page list each one shows. Pure: no DOM and no SDK.

   Sections are views over the same folder, not separate stores:
     Notes      every note outside the folders below, as the folder tree, with Quick Notes pinned
     Daily      daily/<date>.md, newest first, by month
     Products   products/, the notes Tandem reads and adds to (products.js)
     Templates  templates/, plus the starter set before its files exist (templates.js)
     Tandem     Tandem's plans, specs, reviews and briefs, live from .work (tandem.js); only with the opencode
                connector on this computer
   The open page decides the section shown, so links and search land in the right place. */
import { DAILY, TEMPLATES } from './templates.js';
import { PRODUCTS } from './products.js';
import { isTandem } from './tandem.js';

export const SECTIONS = [
  { id: 'notes', name: 'Notes', hint: 'Your notes and folders' },
  { id: 'daily', name: 'Daily', hint: "One note per day (T opens today's)" },
  { id: 'products', name: 'Products', hint: 'What you and Tandem know about each product' },
  { id: 'templates', name: 'Templates', hint: 'What new notes start from' },
  { id: 'tandem', name: 'Tandem', hint: "Tandem's plans, specs and reviews, from .work" }
];
export const SECTION_IDS = SECTIONS.map(s => s.id);

/* Top folders that belong to a section other than Notes. */
const FOLDER_SECTION = { [DAILY]: 'daily', [PRODUCTS]: 'products', [TEMPLATES]: 'templates' };
export const SECTION_FOLDERS = Object.keys(FOLDER_SECTION);

/** The section a page belongs to. */
export function sectionOf(path) {
  if (isTandem(path)) return 'tandem';
  const top = String(path || '').split('/')[0];
  return (String(path || '').includes('/') && FOLDER_SECTION[top]) || 'notes';
}

/** The sections to show: Tandem only when its documents can be read here. */
export function visibleSections({ tandem = false } = {}) {
  return SECTIONS.filter(s => s.id !== 'tandem' || tandem);
}

/** Paths for the Notes section's tree: everything outside daily/, products/ and templates/. */
export function notesPaths(paths) {
  return [...paths].filter(p => sectionOf(p) === 'notes');
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Daily notes newest first, grouped by month: [{month: 'November 2026', days: [{path, day, label}]}]. */
export function dailyGroups(paths) {
  const days = [...paths].map(p => /^daily\/(\d{4})-(\d{2})-(\d{2})\.md$/.exec(p)).filter(Boolean)
    .map(m => ({ path: m[0], day: `${m[1]}-${m[2]}-${m[3]}`, y: +m[1], mo: +m[2], d: +m[3] }))
    .sort((a, b) => (a.day < b.day ? 1 : -1));
  const out = [];
  for (const x of days) {
    const month = `${MONTHS[x.mo - 1]} ${x.y}`;
    let g = out[out.length - 1];
    if (!g || g.month !== month) out.push(g = { month, days: [] });
    const dow = DOW[new Date(Date.UTC(x.y, x.mo - 1, x.d)).getUTCDay()];
    g.days.push({ path: x.path, day: x.day, label: `${dow} ${x.d}` });
  }
  return out;
}
