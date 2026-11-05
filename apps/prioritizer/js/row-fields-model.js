/* Docket: which optional fields task rows show. Pure, no DOM, so Node tests can import it.

   One global setting, saved in prioritizer.settings meta as rowFields: {hidden: [keys]}. The hidden list is
   stored (not the shown one) so a field added later starts visible. Keys this version doesn't know are kept, so a
   newer version's choices survive a save here.

   The setting only takes away: a view that already leaves a field out (compact rows have no people) still does.
   Alerts that need you show whatever the setting says: overdue, a blocking or asked PR, a nudge that is due,
   still urgent, and Pause on the running task. */

export const ROW_GROUPS = ['Work links', 'Dates', 'Follow-up', 'Health', 'Context', 'Actions'];

export const ROW_FIELDS = [
  {key: 'ado', group: 'Work links', label: 'ADO item number'},
  {key: 'pr', group: 'Work links', label: 'PR number'},
  {key: 'prai', group: 'Work links', label: 'AI review'},
  {key: 'agent', group: 'Work links', label: 'Agent status'},
  {key: 'due', group: 'Dates', label: 'Due date'},
  {key: 'repeat', group: 'Dates', label: 'Repeat'},
  {key: 'waiting', group: 'Follow-up', label: 'Waiting on someone'},
  {key: 'stale', group: 'Health', label: 'Untouched a while'},
  {key: 'people', group: 'Context', label: 'People'},
  {key: 'list', group: 'Context', label: 'List color'},
  {key: 'crumb', group: 'Context', label: 'Where you left off (Today)'},
  {key: 'score', group: 'Actions', label: 'Score'},
  {key: 'start', group: 'Actions', label: 'Start button'},
  {key: 'today', group: 'Actions', label: 'Add to Today button'}
];

// What still shows when a group's fields are off, said under the group in settings.
export const ROW_KEEPS = {
  'Work links': 'Blocking and asked reviews still show.',
  'Dates': 'Overdue dates still show.',
  'Follow-up': 'Nudges that are due still show.',
  'Actions': 'Pause still shows on the task you are working on.'
};

const KEY = /^[a-z][a-z0-9_-]{0,31}$/;

/* The setting as saved: hidden keys, unique, known or not, at most 50. Anything else reads as all shown. */
export function cleanRowFields(v){
  const hidden = v && typeof v === 'object' && Array.isArray(v.hidden) ? v.hidden : [];
  return {hidden: [...new Set(hidden.filter(k => typeof k === 'string' && KEY.test(k)))].slice(0, 50)};
}

/* A test for one row: shown('due') is false when the due date is hidden. */
export function rowShown(hidden){
  const off = new Set(Array.isArray(hidden) ? hidden : []);
  return key => !off.has(key);
}

/* The hidden list after settings are saved: the known fields unchecked, plus unknown keys already there. */
export function withHidden(prev, knownOff){
  const known = new Set(ROW_FIELDS.map(f => f.key));
  const keep = cleanRowFields(prev).hidden.filter(k => !known.has(k));
  return cleanRowFields({hidden: [...ROW_FIELDS.map(f => f.key).filter(k => knownOff.has(k)), ...keep]});
}
