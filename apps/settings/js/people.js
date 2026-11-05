/* Settings: what the People card's forms turn into (docs/people.md). Pure, so test/people.test.mjs can import
   it. The directory model and its rules are shared/people.js; settings.js draws the card and saves through
   ws.people. */
import { RELATIONS } from '../../../shared/people.js';

const s = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Fields for ws.people.add or update from a person form's entries ([name, value] pairs, as FormData gives). */
export function personFields(entries) {
  const f = Object.fromEntries(entries);
  return {
    name: s(f.name), handle: s(f.handle, 40).replace(/^@/, '').toLowerCase(),
    relation: RELATIONS.includes(f.relation) ? f.relation : 'contact',
    team: f.team === 'on', adoIdentity: s(f.adoIdentity), role: s(f.role), since: s(f.since, 10)
  };
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
