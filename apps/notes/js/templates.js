/* Notes: templates and the daily note. Pure: no DOM and no SDK.

   Templates are ordinary notes under templates/, so they are edited like any other note. A new note made from
   one gets {{title}}, {{slug}} (the title as a file name), {{date}} (YYYY-MM-DD) and {{time}} (HH:MM) filled in, and
   {{docket}}: the day's tasks from Docket as links (daily.js docketPlan), or an empty checkbox without Docket.
   templates/product.md is the product note template (products.js), also used by Tandem. The daily note is daily/<date>.md,
   made from templates/daily.md when there is one. */
import { isNote, slugify, stem } from './model.js';
import { PRODUCT_TEMPLATE } from './products.js';

export const PRODUCT_TPL = 'templates/product.md';

export const TEMPLATES = 'templates';
export const DAILY = 'daily';

/* The starter set, written by "Add starter templates". 1:1 notes stay in Rapport, so there is no 1:1 template. */
export const STARTERS = {
  'templates/meeting.md': '# {{title}}\n\n{{date}}\n\n## Attendees\n\n- \n\n## Notes\n\n- \n\n## Decisions\n\n- \n\n## Action items\n\n- [ ] \n',
  'templates/incident.md': '# {{title}}\n\nStarted {{date}} {{time}}. Status: investigating.\n\n## Impact\n\n## Timeline\n\n- {{time}} \n\n## Cause\n\n## Follow-ups\n\n- [ ] \n',
  'templates/adr.md': '# {{title}}\n\nStatus: proposed. Date: {{date}}.\n\n## Context\n\n## Decision\n\n## Consequences\n\n## Options considered\n',
  'templates/runbook.md': '# {{title}}\n\n## When to use this\n\n## Before you start\n\n## Steps\n\n1. \n\n## Check it worked\n\n## Roll back\n',
  'templates/retro.md': '# {{title}}\n\n{{date}}\n\n## Went well\n\n- \n\n## Could be better\n\n- \n\n## Try next\n\n- [ ] \n',
  'templates/daily.md': '# {{date}}\n\n## Plan\n\n{{docket}}\n\n## Notes\n\n## Wins\n\n',
  [PRODUCT_TPL]: PRODUCT_TEMPLATE
};

const pad = (n) => String(n).padStart(2, '0');
/** Today as YYYY-MM-DD in local time. */
export function dayOf(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
const timeOf = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));

/** The templates among these paths: [{path, name}], sorted by name. */
export function templatesIn(paths) {
  return [...paths].filter(p => isNote(p) && p.startsWith(`${TEMPLATES}/`) && !p.slice(TEMPLATES.length + 1).includes('/'))
    .map(p => ({ path: p, name: stem(p) })).sort((a, b) => a.name.localeCompare(b.name));
}

/* What {{docket}} becomes with no tasks from Docket: one empty checkbox to plan by hand. */
export const NO_PLAN = '- [ ] ';

/** A template's text with {{title}}, {{slug}}, {{date}}, {{time}} and {{docket}} filled in. Unknown {{names}} stay. */
export function fill(text, { title = '', now = new Date(), docket = '' } = {}) {
  const v = { title, slug: slugify(title), date: dayOf(now), time: timeOf(now), docket: docket || NO_PLAN };
  return String(text).replace(/\{\{\s*(title|slug|date|time|docket)\s*\}\}/g, (_, k) => v[k]);
}

/** The daily note's path for a day. */
export function dailyPath(day) {
  if (!isDay(day)) throw new RangeError('A day is YYYY-MM-DD.');
  return `${DAILY}/${day}.md`;
}

/** The daily note's text for a day, from the daily template's text (or the starter one). docket: docketPlan(). */
export function dailyText(day, template, docket = '') {
  const [y, m, d] = day.split('-').map(Number);
  const at = new Date(y, m - 1, d, 9, 0);
  return fill(template || STARTERS['templates/daily.md'], { title: day, now: at, docket });
}

/** Starter templates not yet in `paths` (a Set), as [{path, content}]. */
export function missingStarters(paths) {
  return Object.entries(STARTERS).filter(([p]) => !paths.has(p)).map(([path, content]) => ({ path, content }));
}
