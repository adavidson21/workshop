// Synthetic ADO data for the golden tests. Every name, id and date is made up. Shapes follow the public
// Azure DevOps REST API reference (Work Items, WIQL, Work Item Updates, Teams, Pull Requests,
// Classification Nodes, Connection Data). "{{ADO}}" is replaced with the fake server's URL at run time.

export const PAT = 'fake-pat-0123456789abcdef';
export const NOW = '2026-10-15T12:00:00+00:00';

const ME = 'u-me';
const id = (displayName, uniqueName) => ({ displayName, uniqueName, id: `u-${displayName.toLowerCase().replace(/\s+/g, '-')}` });
const DEV_A = id('Engineer A', 'engineer.a@example.com');
const DEV1 = id('Dev One', 'dev.one@example.com');
const DEV2 = id('Dev Two', 'dev.two@example.com');

function wi(n, fields, { link = true } = {}) {
  const project = fields['System.TeamProject'];
  return {
    id: n,
    rev: 3,
    fields,
    ...(link ? { _links: { html: { href: `{{ADO}}/Main/${encodeURIComponent(project)}/_workitems/edit/${n}` } } } : {}),
    url: `{{ADO}}/Main/_apis/wit/workItems/${n}`
  };
}

const base = (n, type, state, project, extra = {}) => ({
  'System.Id': n,
  'System.TeamProject': project,
  'System.WorkItemType': type,
  'System.State': state,
  'System.Title': `Synthetic ${type.toLowerCase()} ${n}`,
  'System.ChangedDate': '2026-10-14T15:30:00.47Z',
  ...extra
});

const workItems = {
  101: wi(101, base(101, 'Bug', 'Active', 'Web App', { 'System.AssignedTo': DEV_A, 'Microsoft.VSTS.Common.Priority': 2, 'Microsoft.VSTS.Scheduling.DueDate': '2026-10-20T00:00:00Z', 'System.Title': "Fix the user's renewal timeout" })),
  102: wi(102, base(102, 'User Story', 'New', 'Mobile', { 'System.AssignedTo': 'Engineer A <engineer.a@example.com>', 'Microsoft.VSTS.Common.Priority': 3, 'Microsoft.VSTS.Scheduling.TargetDate': '2026-11-01T00:00:00Z' }), { link: false }),
  103: wi(103, base(103, 'Issue', 'Active', 'Web App', { 'System.AssignedTo': DEV_A })),
  201: wi(201, base(201, 'Bug', 'Closed', 'Web App', { 'System.AssignedTo': DEV_A })),
  202: wi(202, base(202, 'Bug', 'Removed', 'Web App', { 'System.AssignedTo': DEV_A })),
  203: wi(203, base(203, 'Task', 'Active', 'Web App', { 'System.AssignedTo': DEV_A })),
  204: wi(204, base(204, 'Bug', 'Active', 'Web App', { 'System.AssignedTo': DEV2, 'Microsoft.VSTS.Common.Priority': 1 })),
  // 205 does not exist
  301: wi(301, base(301, 'Bug', 'Closed', 'Web App', {
    'System.AssignedTo': DEV2, 'System.AreaPath': 'Web App\\Team A', 'System.IterationPath': 'Web App\\Sprint 12',
    'System.CreatedDate': '2026-09-10T09:00:00.123Z', 'System.CreatedBy': id('Engineer C', 'engineer.c@example.com'),
    'Microsoft.VSTS.Common.ClosedDate': '2026-10-01T11:00:00Z', 'Microsoft.VSTS.Common.Priority': 1,
    'Microsoft.VSTS.Scheduling.RemainingWork': null, 'Microsoft.VSTS.Scheduling.Effort': 5, 'System.Tags': 'api; urgent'
  })),
  302: wi(302, base(302, 'User Story', 'Active', 'Web App', {
    'System.AssignedTo': 'Dev One <dev.one@example.com>', 'System.AreaPath': 'Web App\\Team A', 'System.IterationPath': 'Web App\\Release 3\\Sprint 13',
    'System.CreatedDate': '2026-09-04T00:00:00Z', 'System.CreatedBy': 'Engineer C <engineer.c@example.com>',
    'Microsoft.VSTS.Scheduling.StoryPoints': 3.5, 'Microsoft.VSTS.Common.Priority': 2
  })),
  303: wi(303, base(303, 'Bug', 'Active', 'Web App', {
    'System.AssignedTo': DEV1, 'System.AreaPath': 'Web App\\Team A', 'System.IterationPath': 'Web App',
    'System.CreatedDate': '2026-08-01T00:00:00Z', 'Microsoft.VSTS.Common.Priority': 2
  })),
  304: wi(304, base(304, 'Issue', 'New', 'Mobile', {
    'System.AreaPath': 'Mobile', 'System.IterationPath': 'Mobile\\Sprint 2', 'System.CreatedDate': '2026-10-02T00:00:00Z',
    'Microsoft.VSTS.Scheduling.OriginalEstimate': 8, 'System.Tags': ''
  }), { link: false })
};

// Single-item GET (workitem.get) answers with relations and rich text.
workItems[101].relations = [
  { rel: 'System.LinkTypes.Hierarchy-Reverse', url: '{{ADO}}/Main/_apis/wit/workItems/90', attributes: { name: 'Parent' } },
  { rel: 'ArtifactLink', url: 'vstfs:///Git/Commit/abc', attributes: { name: 'Fixed in Commit' } }
];
workItems[101].fields['System.Description'] = '<div>Renewal times out after <b>30s</b>.</div><ul><li>Step one</li><li>Step&nbsp;two &amp; three</li></ul>';
workItems[101].fields['Microsoft.VSTS.Common.AcceptanceCriteria'] = '<p>Renewal finishes in under 5s.</p>';

const field = (oldValue, newValue) => ({ ...(oldValue !== undefined ? { oldValue } : {}), ...(newValue !== undefined ? { newValue } : {}) });
const upd = (rev, fields, extra = {}) => ({ id: rev, workItemId: 0, rev, fields, ...extra });

const updates = {
  301: [
    upd(1, { 'System.ChangedDate': field(undefined, '2026-09-10T09:00:00.123Z'), 'Microsoft.VSTS.Common.Priority': field(undefined, 2),
      'System.IterationPath': field(undefined, 'Web App\\Sprint 11'), 'System.AssignedTo': field(undefined, DEV1),
      'System.ChangedBy': field(undefined, id('Engineer C', 'engineer.c@example.com')) }),
    upd(2, { 'System.ChangedDate': field('2026-09-10T09:00:00.123Z', '2026-09-12T10:00:00Z'), 'Microsoft.VSTS.Common.Priority': field(2, 1),
      'System.ChangedBy': field(undefined, 'Engineer C <engineer.c@example.com>') }),
    upd(3, { 'System.ChangedDate': field(undefined, '2026-09-20T08:00:00Z'), 'System.IterationPath': field('Web App\\Sprint 11', 'Web App\\Sprint 12') }),
    upd(4, { 'System.ChangedDate': field(undefined, '2026-09-21T08:00:00Z'), 'System.AssignedTo': field(DEV1, DEV2) }),
    upd(5, { 'System.AuthorizedDate': field(undefined, '2026-10-01T11:00:00Z'), 'System.State': field('Active', 'Closed') }, { revisedBy: id('Dev Two', 'dev.two@example.com') }),
    upd(6, { 'System.Tags': field('', 'api; urgent') }, { revisedDate: '2026-10-02T00:00:00Z', revisedBy: id('Build Bot', 'bot@example.com') })
  ],
  302: [
    upd(1, { 'System.ChangedDate': field(undefined, '2026-09-04T00:00:00Z'), 'Microsoft.VSTS.Common.Priority': field(undefined, 2),
      'System.AssignedTo': field(undefined, 'Dev One <dev.one@example.com>') }),
    // 203 tag-only updates push the history past one page of 200.
    ...Array.from({ length: 203 }, (_, i) => upd(i + 2, { 'System.ChangedDate': field(undefined, `2026-09-${String(5 + (i % 20)).padStart(2, '0')}T00:00:00Z`), 'System.Tags': field('', `t${i}`) })),
    upd(205, { 'System.ChangedDate': field(undefined, '2026-10-10T08:00:00Z'), 'System.State': field('New', 'Active') })
  ],
  303: [
    upd(1, { 'System.ChangedDate': field(undefined, '2026-08-01T00:00:00Z'), 'Microsoft.VSTS.Common.Priority': field(undefined, 3) }),
    upd(2, { 'System.ChangedDate': field(undefined, '2026-09-05T00:00:00Z'), 'Microsoft.VSTS.Common.Priority': field('3', '2') }),
    upd(3, { 'System.ChangedDate': field(undefined, '2026-09-06T00:00:00Z'), 'System.AssignedTo': field(undefined, DEV1) }),
    upd(4, { 'System.ChangedDate': field(undefined, '2026-09-07T00:00:00Z'), 'Microsoft.VSTS.Common.Priority': field(undefined, 1) }),
    upd(5, { 'System.Tags': field('', 'x') }, { revisedDate: '9999-01-01T00:00:00Z' })
  ]
};

const iterationsWeb = {
  id: 1, name: 'Web App', structureType: 'iteration', hasChildren: true, path: '\\Web App\\Iteration',
  children: [
    { id: 2, name: 'Sprint 11', path: '\\Web App\\Iteration\\Sprint 11', attributes: { startDate: '2026-08-31T00:00:00Z', finishDate: '2026-09-13T00:00:00Z' } },
    { id: 3, name: 'Sprint 12', path: '\\Web App\\Iteration\\Sprint 12', attributes: { startDate: '2026-09-14T00:00:00Z', finishDate: '2026-09-27T00:00:00Z' } },
    { id: 4, name: 'Release 3', path: '\\Web App\\Iteration\\Release 3', hasChildren: true, children: [
      { id: 5, name: 'Sprint 13', path: '\\Web App\\Iteration\\Release 3\\Sprint 13', attributes: { startDate: '2026-09-28T00:00:00Z', finishDate: '2026-10-11T00:00:00Z' } }
    ] },
    { id: 6, name: 'Sprint 14', path: '\\Web App\\Iteration\\Sprint 14' }
  ]
};

const reviewer = (rid, vote, extra = {}) => ({ id: rid, displayName: rid, vote, ...extra });
const pr = (n, repo, reviewers, extra = {}) => ({
  pullRequestId: n,
  status: 'active',
  title: `Synthetic change ${n}`,
  repository: { id: `r-${repo}`, name: repo },
  createdBy: { id: 'u-b', displayName: 'Engineer B', uniqueName: 'engineer.b@example.com' },
  creationDate: '2026-10-12T14:00:00.5Z',
  isDraft: false,
  reviewers,
  ...extra
});

const prsWeb = [
  pr(501, 'web-api', [reviewer(ME, 0, { isRequired: true }), reviewer('u-bo', 10, { isRequired: true }), reviewer('u-cy', 0)]),
  pr(502, 'web-api', [reviewer(ME, -5)]),
  pr(503, 'web ui', [reviewer('t-platform', 0)]),
  pr(504, 'web-api', [reviewer('t-platform', 0), reviewer('u-bo', 10, { votedFor: [{ id: 't-platform' }] })]),
  pr(505, 'web-api', [reviewer(ME, 0)], { createdBy: { id: ME, displayName: 'Engineer A' } }),
  pr(506, 'web-api', [reviewer(ME, 0)], { isDraft: true }),
  pr(507, 'web-api', [reviewer(ME, 10)]),
  pr(508, 'web-api', [reviewer(ME, 0)], { status: 'completed' }),
  pr(510, 'web-api', [reviewer('t-data', 0)]),
  pr(511, 'web-api', [reviewer(ME, 0, { isRequired: true }), reviewer('u-bo', 0, { isRequired: true })])
];

const prsField = [
  pr(601, 'field-app', [reviewer(ME, 0, { isRequired: true })]),
  pr(602, 'field-tools', [reviewer(ME, 0)])
];

export const scenario = {
  pat: PAT,
  root: { connectionData: { authenticatedUser: { id: ME, providerDisplayName: 'Engineer A' }, instanceId: 'i-1' } },
  collections: {
    Main: {
      connectionData: { authenticatedUser: { id: ME, providerDisplayName: 'Engineer A' }, instanceId: 'i-1' },
      wiql: [
        { match: ['[System.AssignedTo] = @Me'], ids: [101, 102, 103] },
        { match: ['[System.ChangedDate] >= @Today - '], ids: [301, 302, 303] },
        { match: ['[System.State] NOT IN', '[System.AreaPath] UNDER'], ids: [302, 304] },
        { match: ['[System.State] NOT IN', '[System.AssignedTo] IN'], ids: [302, 304] }
      ],
      workItems,
      updates,
      teams: { 'Web App': [{ id: 't-platform', name: 'Platform' }, { id: 't-data', name: 'Data' }] },
      pullRequests: { 'Web App': prsWeb },
      iterations: { 'Web App': iterationsWeb }
    },
    Apps: {
      connectionData: { $status: 404 },
      teams: { Field: { $status: 403 } },
      pullRequests: { Field: prsField }
    },
    Login: {
      connectionData: { authenticatedUser: { id: ME } },
      html: ['wit/wiql']
    }
  }
};

const key = (coll, project, n) => `{{ADO}}/${coll}|${project}|${n}`;

/** Helper-style configs (ado-helper.json) and calls. The Node side imports the same config. */
export const cases = [
  {
    name: 'sync-with-prs',
    config: {
      base_url: '{{ADO}}/Main', pat_env: 'TEST_ADO_PAT', pr_teams: ['platform'],
      pr_sources: [{ base_url: '{{ADO}}/Main', project: 'Web App', repos: [] }, { base_url: '{{ADO}}/Apps/', project: 'Field', repos: ['Field-App'] }]
    },
    call: {
      fn: 'sync',
      known: [101, 201, 202, 203, 204, 205],
      knownPrs: [key('Main', 'Web App', 504), key('Main', 'Web App', 505), key('Main', 'Web App', 507), key('Main', 'Web App', 508),
        key('Main', 'Web App', 'abc'), key('Apps', 'Field', 602), key('Apps', 'Field', 999), 'https://elsewhere.example.com/X|Y|1']
    }
  },
  {
    name: 'sync-no-prs',
    config: { base_url: '{{ADO}}/Main', pat_env: 'TEST_ADO_PAT', types: ['Bug', 'Issue'], closed_states: ['Closed'], removed_states: ['Removed', 'Cut'] },
    call: { fn: 'sync', known: [102, 201, 202], knownPrs: [] }
  },
  {
    name: 'sync-pr-error',
    config: { base_url: '{{ADO}}/Main', pat_env: 'TEST_ADO_PAT', pr_sources: [{ base_url: '{{ADO}}/Gone', project: 'Nope', repos: [] }] },
    call: { fn: 'sync', known: [], knownPrs: [] }
  },
  {
    name: 'sync-sign-in-page',
    config: { base_url: '{{ADO}}/Login', pat_env: 'TEST_ADO_PAT' },
    call: { fn: 'sync', known: [], knownPrs: [] }
  },
  {
    name: 'dataset',
    config: { base_url: '{{ADO}}/Main', pat_env: 'TEST_ADO_PAT' },
    call: { fn: 'dataset', req: { areas: ['Web App\\Team A'], people: ['dev.one@example.com'], days: 42 } }
  },
  {
    name: 'dataset-truncated',
    config: {
      base_url: '{{ADO}}/Main', pat_env: 'TEST_ADO_PAT', workload_max_items: 2, high_priorities: [1],
      bug_types: ['Bug', 'Defect'], workload_types: ['Bug', 'User Story'], escalation_priority: 2,
      effort_fields: ['Microsoft.VSTS.Scheduling.StoryPoints', 'Microsoft.VSTS.Scheduling.OriginalEstimate']
    },
    call: { fn: 'dataset', req: { base: '{{ADO}}/Main/', people: ['dev.one@example.com', ' dev.one@example.com ', ''], days: 3 } }
  },
  {
    name: 'dataset-no-scope',
    config: { base_url: '{{ADO}}/Main', pat_env: 'TEST_ADO_PAT' },
    call: { fn: 'dataset', req: { areas: [' '], days: 400 } }
  }
];
