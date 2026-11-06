/* Notes: what a template is called and what it is for. Pure: no DOM and no SDK.

   A template's own heading is usually "# {{title}}", which is no use as a name in the tree. So a template is named,
   in order, by its frontmatter `template:`, by the starter set's name for that file, or by its file name. Its use
   is its frontmatter `description:`, or the starter set's. Both fields stay in the template and are taken out of
   notes made from it (templates.js fill). */
import { frontmatter } from './markdown.js';

export const TEMPLATES = 'templates';

/* The starter set's names and uses, by file name. Files made before these names existed get them too. */
export const TEMPLATE_INFO = {
  meeting: { name: 'Meeting notes', use: 'Any meeting: who came, what was said, decisions and action items.' },
  incident: { name: 'Incident', use: 'Track impact and a timeline while it is happening, then the cause and follow-ups.' },
  adr: { name: 'Decision record (ADR)', use: 'Write down a technical decision, why it was made and what else was considered.' },
  runbook: { name: 'Runbook', use: 'Steps for a task someone will repeat, with a way to check it worked and to roll back.' },
  retro: { name: 'Retro', use: 'What went well, what could be better, and what to try next sprint.' },
  daily: { name: 'Daily note', use: "Used by Today's note: the day's plan (your Docket tasks), notes and wins." },
  product: { name: 'Product note', use: 'What you and Tandem know about one product. New ones go in products/.' }
};

/** True for a note directly under templates/. */
export const isTemplate = (p) => typeof p === 'string' && p.startsWith(`${TEMPLATES}/`) && p.endsWith('.md')
  && !p.slice(TEMPLATES.length + 1).includes('/');

const humanize = (stem) => { const s = stem.replace(/-/g, ' ').trim(); return s ? s[0].toUpperCase() + s.slice(1) : stem; };

/** {name, use} for a template, from its frontmatter, the starter set, or its file name. */
export function templateInfo(path, content = '') {
  const stem = String(path).split('/').pop().replace(/\.md$/, '');
  const { data } = frontmatter(content);
  const known = TEMPLATE_INFO[stem];
  return { name: data.template || (known && known.name) || humanize(stem), use: data.description || (known && known.use) || '' };
}

/** The text without the frontmatter `template:` and `description:` lines; frontmatter left empty is dropped. */
export function stripTemplateFields(text) {
  const src = String(text || '');
  const m = /^(﻿?)---[ \t]*(\r?\n)([\s\S]*?)(\r?\n)---[ \t]*(?:\r?\n|$)/.exec(src);
  if (!m) return src;
  const lines = m[3].split(/\r?\n/);
  const kept = lines.filter(l => !/^(template|description)\s*:/i.test(l));
  if (kept.length === lines.length) return src;
  const rest = src.slice(m[0].length);
  if (!kept.some(l => l.trim())) return m[1] + rest;
  return `${m[1]}---${m[2]}${kept.join(m[2])}${m[2]}---${m[2]}${rest}`;
}
