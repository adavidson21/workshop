// Areas (docs/apps.md, Areas): switches that turn a whole kind of work on or off at once, so a personal computer
// is not cluttered with work things. Plain data plus pure helpers, no imports: the agent, the shell, the SDK,
// Settings and the apps all read it.
//
// The area wins: while an area is off, its apps are off (whatever their own switch says), its Settings pages
// leave the nav, its connectors leave Status, and the app parts it lists are hidden. Turning the area back on
// brings back each app's own switch. Areas are on by default.
//
//   apps        app ids that are off while the area is off
//   pages       Settings page ids (apps/settings/js/pages.js) that leave the nav
//   connectors  connector ids that leave Settings' Status and Needs you (their config is kept as is)
//   parts       {appId: [part ids]} an app hides while the area is off (the app decides what a part is)
export const AREAS = Object.freeze({
  management: Object.freeze({
    label: 'Management',
    about: 'Managing people: People, Directory, and Tasks\' People place.',
    apps: Object.freeze(['people']),
    pages: Object.freeze(['people', 'team']),
    connectors: Object.freeze([]),
    parts: Object.freeze({ tasks: Object.freeze(['people']) })
  }),
  work: Object.freeze({
    label: 'Work',
    about: 'Team delivery: Roadmaps and Azure DevOps.',
    apps: Object.freeze(['roadmaps']),
    pages: Object.freeze(['connections', 'work-items', 'pull-requests']),
    connectors: Object.freeze(['ado']),
    parts: Object.freeze({})
  })
});
export const AREA_IDS = Object.freeze(Object.keys(AREAS));

/** The known area ids in `list` (anything else is dropped), as a Set. */
export function cleanAreas(list) {
  return new Set((Array.isArray(list) ? list : []).filter(id => typeof id === 'string' && Object.hasOwn(AREAS, id)));
}

/** The area that turns off an app, a Settings page or a connector, given the areas off, or ''. */
export function areaHiding(kind, id, areasOff) {
  for (const a of AREA_IDS) if (areasOff.has(a) && AREAS[a][kind].includes(id)) return a;
  return '';
}

/** The app ids off because of `areasOff`, as a Set. */
export function appsOffBy(areasOff) {
  const out = new Set();
  for (const a of AREA_IDS) if (areasOff.has(a)) for (const id of AREAS[a].apps) out.add(id);
  return out;
}

/** Whether an app should show a part (like Tasks' Handed off view), given the areas off. */
export function partOn(app, part, areasOff) {
  for (const a of AREA_IDS) if (areasOff.has(a) && (AREAS[a].parts[app] || []).includes(part)) return false;
  return true;
}
