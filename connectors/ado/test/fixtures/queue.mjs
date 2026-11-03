// Synthetic ADO data for the Queue actions (queue.list, workitem.update and friends). Every name, id and date
// is made up. Shapes follow the public Azure DevOps REST API reference (WIQL, Work Items, Work Item Updates,
// Comments, Work Item Type States, Classification Nodes, Connection Data). "{{ADO}}" is the fake server's URL.

export const PAT = 'fake-pat-queue-0123456789';

const person = (displayName, uniqueName) => ({ displayName, uniqueName, id: `u-${displayName.toLowerCase().replace(/\s+/g, '-')}` });
export const ME = person('Engineer A', 'engineer.a@example.com');
export const DEV1 = person('Dev One', 'dev.one@example.com');

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
  'System.CreatedDate': '2026-10-01T09:00:00Z',
  'System.ChangedDate': '2026-10-14T15:30:00Z',
  ...extra
});

export function queueScenario() {
  return {
    pat: PAT,
    collections: {
      Main: {
        connectionData: { authenticatedUser: { id: 'u-me', providerDisplayName: 'Engineer A', properties: { Account: { $type: 'System.String', $value: 'Engineer.A@example.com' } } }, instanceId: 'i-1' },
        wiql: [
          { match: ["UNDER 'Web App\\Team A'", "[System.ChangedDate] >= '2026-10-10'"], ids: [501] },
          { match: ["UNDER 'Web App\\Team A'", "UNDER 'Web App\\Team B'"], ids: [501, 502, 503, 504] },
          { match: ["UNDER 'Web App\\Team A'", 'NOT IN'], ids: [501, 502, 503] },
          { match: ["UNDER 'Web App\\Team A'"], ids: [501, 502, 503, 510] }
        ],
        workItems: {
          501: wi(501, 4, f('Bug', 'Active', 'Synthetic bug 501', { 'System.AssignedTo': ME, 'Microsoft.VSTS.Common.Priority': 1, 'System.Tags': 'api; urgent',
            'System.Description': '<p>Steps <b>one</b></p><script>alert(1)</script>', 'Microsoft.VSTS.TCM.ReproSteps': '<ol><li>Open</li><li>Click</li></ol>',
            'Microsoft.VSTS.Common.StateChangeDate': '2026-10-05T10:00:00Z' }), [
            { rel: 'System.LinkTypes.Related', url: '{{ADO}}/Main/_apis/wit/workItems/502', attributes: { name: 'Related' } },
            { rel: 'ArtifactLink', url: 'vstfs:///Git/PullRequestId/p-1%2Fr-1%2F77', attributes: { name: 'Pull Request' } }
          ]),
          502: wi(502, 2, f('User Story', 'New', 'Synthetic story 502', { 'Microsoft.VSTS.Common.Priority': 2 })),
          503: wi(503, 7, f('Issue', 'Active', 'Synthetic issue 503', { 'System.AssignedTo': DEV1, 'System.IterationPath': 'Web App\\Sprint 11' })),
          504: wi(504, 1, f('Bug', 'New', 'Synthetic bug 504', { 'System.AreaPath': 'Web App\\Team B' })),
          510: wi(510, 3, f('Bug', 'Closed', 'Synthetic closed bug 510', { 'System.AssignedTo': ME }))
        },
        updates: {
          501: [
            { id: 1, rev: 1, revisedBy: ME, revisedDate: '2026-10-01T09:00:00Z', fields: { 'System.State': { newValue: 'New' }, 'System.ChangedDate': { newValue: '2026-10-01T09:00:00Z' } } },
            { id: 2, rev: 2, revisedBy: DEV1, revisedDate: '2026-10-02T09:00:00Z', fields: { 'System.AssignedTo': { newValue: ME }, 'System.ChangedDate': { newValue: '2026-10-02T09:00:00Z' } } },
            { id: 3, rev: 3, revisedBy: ME, revisedDate: '2026-10-03T09:00:00Z', fields: { 'System.History': { newValue: 'a comment' } } },
            { id: 4, rev: 4, revisedBy: ME, revisedDate: '2026-10-05T10:00:00Z', fields: { 'System.State': { oldValue: 'New', newValue: 'Active' }, 'Microsoft.VSTS.Common.Priority': { oldValue: 2, newValue: 1 }, 'System.ChangedDate': { newValue: '2026-10-05T10:00:00Z' } } }
          ]
        },
        comments: {
          501: [
            { id: 2, text: '<div>Second <img src="x" onerror="alert(1)"></div>', createdBy: DEV1, createdDate: '2026-10-04T09:00:00Z', modifiedDate: '2026-10-04T09:00:00Z' },
            { id: 1, text: '<p>First</p>', createdBy: ME, createdDate: '2026-10-03T09:00:00Z', modifiedDate: '2026-10-03T11:00:00Z' }
          ]
        },
        states: {
          Bug: [{ name: 'New', category: 'Proposed', color: 'b2b2b2' }, { name: 'Active', category: 'InProgress', color: '007acc' }, { name: 'Resolved', category: 'Resolved', color: 'ff9d00' }, { name: 'Closed', category: 'Completed', color: '339933' }],
          'User Story': [{ name: 'New', category: 'Proposed' }, { name: 'Active', category: 'InProgress' }, { name: 'Closed', category: 'Completed' }],
          Issue: [{ name: 'Active', category: 'InProgress' }, { name: 'Closed', category: 'Completed' }]
        },
        iterations: {
          'Web App': {
            id: 1, name: 'Web App', path: '\\Web App\\Iteration', children: [
              { id: 2, name: 'Sprint 11', path: '\\Web App\\Iteration\\Sprint 11', attributes: { startDate: '2026-09-23T00:00:00Z', finishDate: '2026-10-06T00:00:00Z' } },
              { id: 3, name: 'Sprint 12', path: '\\Web App\\Iteration\\Sprint 12', attributes: { startDate: '2026-10-07T00:00:00Z', finishDate: '2026-10-20T00:00:00Z' } },
              { id: 4, name: 'Backlog', path: '\\Web App\\Iteration\\Backlog' }
            ]
          }
        }
      },
      ReadOnly: {
        readOnly: true,
        workItems: { 601: wi(601, 1, f('Bug', 'Active', 'Synthetic bug 601')) },
        states: { Bug: [{ name: 'Active', category: 'InProgress' }] }
      }
    }
  };
}
