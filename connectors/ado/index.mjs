// Azure DevOps connector: one ADO integration for every Workshop app, replacing
// prioritizer/ado-helper/ado_helper.py. Read-only. See connectors/ado/README.md.
import { AdoError, SettingsError } from './lib/client.mjs';
import { normalize } from './lib/config.mjs';
import { dataset } from './lib/dataset.mjs';
import { importConfig } from './lib/import.mjs';
import { cleanKnown, cleanKnownPrs, sync, syncPrs } from './lib/sync.mjs';
import { connectionInfo, getWorkItem } from './lib/workitem.mjs';

const stringList = (title, description, def) => ({ type: 'array', title, ...(description ? { description } : {}), items: { type: 'string' }, ...(def ? { default: def } : {}) });

export const configSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['connections'],
  properties: {
    connections: {
      type: 'array',
      title: 'Connections',
      description: 'One per ADO server and collection.',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'serverUrl', 'collection', 'patEnv'],
        properties: {
          name: { type: 'string', title: 'Name', pattern: '^[A-Za-z0-9_-]{1,40}$' },
          serverUrl: { type: 'string', title: 'Server URL', format: 'uri', description: 'The part before the collection, for example https://ado.example.com or https://ado.example.com/tfs.' },
          collection: { type: 'string', title: 'Collection' },
          project: { type: 'string', title: 'Project', description: 'Used when a work item does not say its project.' },
          patEnv: { type: 'string', title: 'PAT environment variable', 'x-workshop-env': true, default: 'ADO_PAT' },
          apiVersion: { type: 'string', title: 'API version', default: '6.0', pattern: '^[0-9]+\\.[0-9]+$' },
          useSystemCa: { type: 'boolean', title: 'Trust certificates trusted by this computer', description: 'Needed when the ADO server uses a company certificate.', default: true },
          verifyTls: { type: 'boolean', title: 'Check the server certificate', description: 'Turn off only if your ADO server has a broken certificate and you accept the risk.', default: true }
        }
      }
    },
    defaultConnection: { type: 'string', title: 'Default connection' },
    syncConnection: { type: 'string', title: 'Connection for my work items', description: 'Empty means the default connection.' },
    paths: {
      type: 'array',
      title: 'Repo and path mapping',
      description: 'Which connection and project a repo or folder uses. * matches any characters.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'connection'],
        properties: {
          path: { type: 'string', title: 'Repo or folder' },
          connection: { type: 'string', title: 'Connection' },
          project: { type: 'string', title: 'Project' }
        }
      }
    },
    types: stringList('Work item types', null, ['Issue', 'Bug', 'User Story']),
    closedStates: stringList('States that count as done', null, ['Resolved', 'Closed', 'Done']),
    removedStates: stringList('States that count as won\'t do', null, ['Removed']),
    prSources: {
      type: 'array',
      title: 'Pull request sources',
      description: 'Where to look for pull requests waiting on you. Empty skips PRs.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['connection', 'project'],
        properties: {
          connection: { type: 'string', title: 'Connection' },
          project: { type: 'string', title: 'Project' },
          repos: stringList('Only these repos', 'Empty means every repo in the project.')
        }
      }
    },
    prTeams: stringList('Teams that count as mine', 'Empty means every team you are on.', []),
    reports: {
      type: 'object',
      title: 'Team reports',
      additionalProperties: false,
      properties: {
        workloadTypes: stringList('Work item types in reports', 'Empty means the same as Work item types.', []),
        bugTypes: stringList('Types counted as bugs', null, ['Bug']),
        highPriorities: { type: 'array', title: 'Priorities that count as high', items: { type: 'string', pattern: '^[0-9]+$' }, default: ['1', '2'] },
        escalationPriority: { type: 'integer', title: 'Raised to this priority counts as an escalation', minimum: 1, maximum: 4, default: 1 },
        effortFields: stringList('Effort fields, first one set wins', null, ['Microsoft.VSTS.Scheduling.RemainingWork', 'Microsoft.VSTS.Scheduling.Effort',
          'Microsoft.VSTS.Scheduling.StoryPoints', 'Microsoft.VSTS.Scheduling.OriginalEstimate']),
        maxItems: { type: 'integer', title: 'Most changed items to read history for', minimum: 50, maximum: 5000, default: 1500 }
      }
    }
  }
};

let state = 'stopped';
let message = null;
let details = null;

/** Everything an action needs, from the agent's ctx. */
function deps(ctx) {
  const { config, problems } = normalize(ctx.config);
  if (!config.connections.length) throw new SettingsError(problems[0] || 'Add an ADO connection in Settings.');
  return { cfg: config, env: name => ctx.env(name), signal: ctx.signal, now: new Date() };
}

/** Keeps plain-words errors and maps anything unexpected to a safe message. */
async function guarded(ctx, label, fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AdoError || e instanceof SettingsError) {
      ctx.log.warn(`${label} failed: ${e.message}`);
      throw e;
    }
    ctx.log.error(`${label} failed unexpectedly: ${e && e.name}`);
    const err = new Error('The ADO connector hit an unexpected problem. See the Workshop log.');
    err.status = 500;
    err.code = 'internal';
    throw err;
  }
}

export default {
  api: 1,
  id: 'ado',
  name: 'Azure DevOps',
  version: '1.0.0',
  configSchema,
  test: { action: 'workitem.get', arg: 'id', label: 'Work item ID' },
  actions: {
    sync: {
      title: 'Sync my work items',
      write: false,
      argsSchema: {
        type: 'object',
        properties: {
          known: { type: 'array', description: 'Work item IDs already on the board.' },
          knownPrs: { type: 'array', description: 'PR keys already on the board.' },
          prs: { type: 'boolean', description: 'Also sync PRs (default true).' }
        }
      },
      async run(args, ctx) {
        return guarded(ctx, 'sync', async () => {
          const out = await sync(deps(ctx), cleanKnown(args?.known), cleanKnownPrs(args?.knownPrs), { prs: args?.prs !== false });
          ctx.log.info(`sync: ${out.items.length} items, ${out.gone.length} gone${out.prs ? `, ${out.prs.items.length} PRs` : ''}`);
          return out;
        });
      }
    },
    'sync.prs': {
      title: 'Sync PRs waiting for my review',
      write: false,
      argsSchema: { type: 'object', properties: { knownPrs: { type: 'array' } } },
      async run(args, ctx) {
        return guarded(ctx, 'sync.prs', async () => {
          const out = await syncPrs(deps(ctx), cleanKnownPrs(args?.knownPrs));
          ctx.log.info(`sync.prs: ${out.items.length} PRs, ${out.gone.length} gone`);
          return out;
        });
      }
    },
    dataset: {
      title: 'Team report dataset',
      write: false,
      argsSchema: {
        type: 'object',
        properties: {
          connection: { type: 'string', maxLength: 40 },
          base: { type: 'string', maxLength: 500 },
          areas: { type: 'array', items: { type: 'string' } },
          people: { type: 'array', items: { type: 'string' } },
          days: { type: 'integer', minimum: 1, maximum: 365 }
        }
      },
      async run(args, ctx) {
        return guarded(ctx, 'dataset', async () => {
          const out = await dataset(deps(ctx), args || {});
          ctx.log.info(`dataset: ${out.items.length} items, ${out.events.length} events`);
          return out;
        });
      }
    },
    'workitem.get': {
      title: 'Get a work item',
      write: false,
      argsSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'integer', minimum: 1 },
          connection: { type: 'string', maxLength: 40 },
          path: { type: 'string', maxLength: 1000 },
          details: { type: 'boolean' }
        }
      },
      async run(args, ctx) {
        return guarded(ctx, 'workitem.get', () => getWorkItem(deps(ctx), args));
      }
    },
    'connection.resolve': {
      title: 'Show which connection a repo or folder uses',
      write: false,
      argsSchema: { type: 'object', properties: { connection: { type: 'string', maxLength: 40 }, path: { type: 'string', maxLength: 1000 } } },
      async run(args, ctx) {
        return guarded(ctx, 'connection.resolve', async () => {
          const d = deps(ctx);
          const out = connectionInfo(d.cfg, args || {});
          let set = false;
          try { set = Boolean(String(d.env(out.patEnv) || '').trim()); } catch { /* not readable */ }
          return { ...out, patSet: set };
        });
      }
    },
    'config.import': {
      title: 'Turn ado-helper.json and eng-agents config.json into these settings',
      write: false,
      argsSchema: { type: 'object', properties: { helper: { type: 'object' }, engAgents: { type: 'object' } } },
      async run(args, ctx) {
        return importConfig({ helper: args?.helper, engAgents: args?.engAgents, current: ctx.config });
      }
    }
  },
  async start(ctx) {
    const { config, problems } = normalize(ctx.config);
    details = { connections: config.connections.length, prSources: config.prSources.length };
    if (problems.length) {
      state = 'error';
      message = problems[0];
      return;
    }
    const missing = [];
    for (const c of config.connections) {
      let v;
      try { v = ctx.env(c.patEnv); } catch { v = undefined; }
      if (!String(v || '').trim() && !missing.includes(c.patEnv)) missing.push(c.patEnv);
    }
    if (missing.length) {
      state = 'error';
      message = `${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not set. Set the PAT in that environment variable, then start Workshop again from a new terminal window.`;
      details.patsMissing = missing;
      return;
    }
    state = 'ready';
    message = null;
  },
  async stop() {
    state = 'stopped';
    message = null;
  },
  status() {
    return { state, message, ...(details ? { details } : {}) };
  }
};
