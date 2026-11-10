// Synthetic ADO data for the roadmap action. Every name, id and date is made up. Shapes follow the public Azure
// DevOps REST API reference (WIQL, Work Items batch). "{{ADO}}" is the fake server's URL.

export const PAT = 'fake-pat-roadmap-0123456789';

const link = (rel, id) => ({ rel: `System.LinkTypes.Hierarchy-${rel}`, url: `{{ADO}}/Main/_apis/wit/workItems/${id}`, attributes: { isLocked: false } });
// Child and parent links, as ADO returns them with $expand=All (or Relations).
const kids = (...ids) => ids.map(id => link('Forward', id));
const up = id => [link('Reverse', id)];

function wi(n, rev, fields, relations) {
  const project = fields['System.TeamProject'];
  return {
    id: n,
    rev,
    fields: { 'System.Id': n, 'System.Rev': rev, ...fields },
    ...(relations ? { relations } : {}),
    _links: { html: { href: `{{ADO}}/Main/${encodeURIComponent(project)}/_workitems/edit/${n}` } },
    url: `{{ADO}}/Main/_apis/wit/workItems/${n}`
  };
}

const f = (type, state, title, extra = {}) => ({
  'System.TeamProject': 'Web App',
  'System.WorkItemType': type,
  'System.State': state,
  'System.Title': title,
  'System.AreaPath': 'Web App\\Team A',
  'System.IterationPath': 'Web App\\Sprint 12',
  'System.ChangedDate': '2026-10-14T15:30:00Z',
  ...extra
});

export function roadmapScenario() {
  return {
    pat: PAT,
    collections: {
      Main: {
        wiql: [
          // Epics and Features in Team A (with closed ones).
          // Slate's backlog: every type, open only.
          { match: ["IN ('Epic', 'Feature', 'User Story', 'Product Backlog Item', 'Bug', 'Issue')", "UNDER 'Web App\\Team A'", 'NOT IN'], ids: [701, 711, 802, 804] },
          { match: ["IN ('Epic', 'Feature')", "UNDER 'Web App\\Team A'", 'NOT IN'], ids: [701, 711, 712, 702] },
          { match: ["IN ('Epic', 'Feature')", "UNDER 'Web App\\Team A'"], ids: [701, 711, 712, 702, 713] }
        ],
        workItems: {
          701: wi(701, 5, f('Epic', 'Active', 'Synthetic version 1', { 'System.AssignedTo': 'Dev One <Dev.One@example.com>', 'Microsoft.VSTS.Scheduling.StartDate': '2026-10-01T00:00:00Z', 'Microsoft.VSTS.Scheduling.TargetDate': '2026-12-15T00:00:00Z' })),
          702: wi(702, 2, f('Epic', 'New', 'Synthetic version 2', { 'System.IterationPath': 'Web App' })),
          711: wi(711, 9, f('Feature', 'Active', 'Synthetic feature 711', { 'System.Parent': 701, 'Microsoft.VSTS.Scheduling.TargetDate': '2026-11-20T00:00:00Z' }), [...up(701), ...kids(801, 802, 803, 807, 808)]),
          // No System.Parent field (older servers): the parent comes from the Hierarchy-Reverse link.
          712: wi(712, 3, f('Feature', 'New', 'Synthetic feature 712', { 'System.AssignedTo': { displayName: 'Dev Two', uniqueName: 'dev.two@example.com' }, 'System.AreaPath': 'Web App\\Team A\\Sub' }), [...up(701), ...kids(804)]),
          713: wi(713, 4, f('Feature', 'Closed', 'Synthetic closed feature 713', { 'System.Parent': 702 }), [...up(702), ...kids(805)]),
          801: wi(801, 1, f('User Story', 'Closed', 'Synthetic story 801', { 'System.Parent': 711 })),
          802: wi(802, 1, f('User Story', 'Active', 'Synthetic story 802', { 'System.Parent': 711, 'System.Tags': 'api; urgent', 'Microsoft.VSTS.Common.Priority': 2, 'Microsoft.VSTS.Scheduling.StoryPoints': 5, 'System.CommentCount': 1, 'Custom.Team': 'Blue' })),
          803: wi(803, 1, f('Issue', 'Resolved', 'Synthetic issue 803', { 'System.Parent': 711, 'System.AreaPath': 'Other Project\\Team Z' })),
          804: wi(804, 1, f('User Story', 'New', 'Synthetic story 804', { 'System.Parent': 712 })),
          805: wi(805, 1, f('User Story', 'Done', 'Synthetic story 805', { 'System.Parent': 713 })),
          // Children of 711 that are not counted: a Task (not a story type) and a removed story.
          807: wi(807, 1, f('Task', 'Active', 'Synthetic task 807', { 'System.Parent': 711 })),
          808: wi(808, 1, f('User Story', 'Removed', 'Synthetic removed story 808', { 'System.Parent': 711 })),
          // A story whose parent is not a Feature in the result: not counted anywhere.
          806: wi(806, 1, f('User Story', 'Closed', 'Synthetic story 806', { 'System.Parent': 999 }))
        }
      }
    }
  };
}
