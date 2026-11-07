/* Notes: templates and the daily note. Pure: no DOM and no SDK.

   Templates are ordinary notes under templates/, so they are edited like any other note. A new note made from
   one gets {{title}}, {{slug}} (the title as a file name), {{date}} (YYYY-MM-DD) and {{time}} (HH:MM) filled in, and
   {{docket}}: the day's tasks from Docket as links (daily.js docketPlan), or an empty checkbox without Docket.
   templates/product.md is the product note template (products.js), also used by Tandem. The daily note is daily/<date>.md,
   made from templates/daily.md when there is one. */
import { isNote, slugify } from './model.js';
import { PRODUCT_TEMPLATE } from './products.js';
import { TEMPLATES, isTemplate, stripTemplateFields, templateInfo } from './template-info.js';
import { frontmatter } from './markdown.js';

export { TEMPLATES, TEMPLATE_INFO, isTemplate, templateInfo } from './template-info.js';

export const PRODUCT_TPL = 'templates/product.md';

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

/** The templates among these paths: [{path, name, use}], sorted by name. contentOf(path) gives a template's text, for
    the name and use in its frontmatter (template-info.js). */
export function templatesIn(paths, contentOf = () => '', { starters = false } = {}) {
  const have = [...paths].filter(p => isNote(p) && isTemplate(p));
  const list = have.map(p => ({ path: p, ...templateInfo(p, contentOf(p)), builtIn: false, starter: Object.prototype.hasOwnProperty.call(STARTERS, p) }));
  // With starters: the starter set is always offered; a file of the same name wins over the built-in one.
  if (starters) for (const p of Object.keys(STARTERS)) if (!have.includes(p)) list.push({ path: p, ...templateInfo(p, STARTERS[p]), builtIn: true, starter: true });
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

/** A template's text: its file's, or the starter's when there is no file yet. null for neither. */
export function templateText(path, contentOf = () => null) {
  const t = contentOf(path);
  if (typeof t === 'string') return t;
  return Object.prototype.hasOwnProperty.call(STARTERS, path) ? STARTERS[path] : null;
}

/* The placeholders a template can use, with what each becomes (the template bar's chips, the preview's tooltips). */
export const PLACEHOLDERS = {
  title: 'The title you type for the new note',
  date: "The day the note is made, YYYY-MM-DD",
  time: 'The time the note is made, HH:MM',
  slug: 'The title as a file name, like deploy-plan',
  docket: "Today's tasks from Docket (daily template only)"
};
/** The placeholder names to offer for a template: docket only on the daily template. */
export const placeholdersFor = (path) => Object.keys(PLACEHOLDERS).filter(k => k !== 'docket' || path === 'templates/daily.md');

/** The frontmatter `template:` and `description:` of a text, as written (empty when missing). */
export function templateFields(text) {
  const { data } = frontmatter(text);
  return { name: data.template || '', description: data.description || '' };
}

/** The text with `template:` and `description:` set (an empty value removes the line). Other frontmatter stays. */
export function setTemplateFields(text, { name = '', description = '' } = {}) {
  const src = String(text || '');
  const clean = (v) => String(v).replace(/[\r\n]+/g, ' ').trim();
  const add = [];
  if (clean(name)) add.push(`template: ${clean(name)}`);
  if (clean(description)) add.push(`description: ${clean(description)}`);
  const m = /^(\uFEFF?)---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(src);
  if (!m) return add.length ? `---\n${add.join('\n')}\n---\n${src}` : src;
  const kept = m[2].split(/\r?\n/).filter(l => !/^(template|description)\s*:/i.test(l));
  const lines = [...add, ...kept.filter(l => l.trim())];
  const rest = src.slice(m[0].length);
  return lines.length ? `${m[1]}---\n${lines.join('\n')}\n---\n${rest}` : m[1] + rest;
}

/** A note turned into a template: its first "# " heading becomes "# {{title}}" and `template:` names it. */
export function asTemplate(text, name) {
  const body = stripTemplateFields(String(text || ''));
  const titled = /^#[ \t]+.*$/m.test(body) ? body.replace(/^#[ \t]+.*$/m, '# {{title}}') : `# {{title}}\n\n${body}`;
  return setTemplateFields(titled, { name });
}

/* What {{docket}} becomes with no tasks from Docket: one empty checkbox to plan by hand. */
export const NO_PLAN = '- [ ] ';

/** A template's text with {{title}}, {{slug}}, {{date}}, {{time}} and {{docket}} filled in. Unknown {{names}} stay.
    The template's own `template:` and `description:` frontmatter lines are left out. */
export function fill(text, { title = '', now = new Date(), docket = '' } = {}) {
  const v = { title, slug: slugify(title), date: dayOf(now), time: timeOf(now), docket: docket || NO_PLAN };
  return stripTemplateFields(text).replace(/\{\{\s*(title|slug|date|time|docket)\s*\}\}/g, (_, k) => v[k]);
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
