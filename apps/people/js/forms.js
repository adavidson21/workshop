/* People: what the person and group forms turn into (docs/people.md). Pure, so test/forms.test.mjs can import
   it. The directory model and its rules are shared/people.js; main.js draws the page and saves through
   ws.people. */
import { RELATIONS } from '../../../shared/people.js';

const s = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Fields for ws.people.add or update from a person form's entries ([name, value] pairs, as FormData gives). */
export function personFields(entries) {
  const f = Object.fromEntries(entries);
  return {
    name: s(f.name), handle: s(f.handle, 40).replace(/^@/, '').toLowerCase(),
    relation: RELATIONS.includes(f.relation) ? f.relation : 'contact',
    team: f.team === 'on', adoIdentity: s(f.adoIdentity), role: s(f.role),
    owns: ownsList(f.owns)
  };
}

/** What a person owns, from one line of text: products, repos or area paths, separated by commas or new lines.
    Trimmed, no repeats (case ignored), up to 30 of up to 200 characters (docs/people.md, owns). */
export function ownsList(text) {
  const out = [];
  for (const raw of String(text || '').split(/[,\n;]/)) {
    const t = raw.trim().slice(0, 200);
    if (t && !out.some(x => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.slice(0, 30);
}

/** Fields for a group form: name, handle and the checked members (`member` entries, in form order). */
export function groupFields(entries) {
  const list = [...entries];
  const f = Object.fromEntries(list);
  return {
    name: s(f.name), handle: s(f.handle, 40).replace(/^@/, '').toLowerCase(),
    members: [...new Set(list.filter(([k]) => k === 'member').map(([, v]) => String(v)))]
  };
}
