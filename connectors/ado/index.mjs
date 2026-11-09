// Azure DevOps connector: one ADO integration for every Workshop app, replacing
// Docket's ado-helper/ado_helper.py. Read actions, plus two write actions (workitem.update, for Runway's and Slate's Publish,
// and workitem.create, for Slate's Publish) that the agent only runs with `confirm: true`. See connectors/ado/README.md.
import { AdoError, SettingsError } from './lib/client.mjs';
import { normalize } from './lib/config.mjs';
import { dataset } from './lib/dataset.mjs';
import { importConfig, importFile } from './lib/import.mjs';
import { configFromUrl } from './lib/url.mjs';
import { authTracker, patStatus } from './lib/pat.mjs';
import { areasMine, cleanKnown, cleanKnownPrs, sync, syncPrs } from './lib/sync.mjs';
import { connectionInfo, getWorkItem } from './lib/workitem.mjs';
import { workItemPrs } from './lib/prs.mjs';
import { iterationsList } from './lib/items.mjs';
import { BACKLOG_TYPES, backlogList, roadmapList } from './lib/roadmap.mjs';
import { CREATE_TYPES, createWorkItem, updateWorkItem } from './lib/write.mjs';
import { ConflictError } from './lib/client.mjs';

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
          name: { type: 'string', title: 'Name', pattern: '^[A-Za-z0-9_-]{1,40}$', default: 'work', description: 'Any short name for this connection, letters, digits, - or _ (for example work).' },
          serverUrl: { type: 'string', title: 'Server URL', format: 'uri', description: 'The part before the collection, for example https://ado.example.com or https://ado.example.com/tfs.' },
          collection: { type: 'string', title: 'Collection', description: 'The part of your ADO address right after the server, for example DefaultCollection in https://ado.example.com/DefaultCollection/MyProject.' },
          project: { type: 'string', title: 'Project', description: 'Used when a work item does not say its project.' },
          patEnv: { type: 'string', title: 'PAT environment variable', 'x-workshop-env': true, default: 'ADO_PAT', description: 'Save the PAT with: workshop pat ADO_PAT (or the name you use here).' },
          patExpires: { type: 'string', title: 'PAT expires', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', maxLength: 10, description: 'Optional, YYYY-MM-DD: the expiry date ADO showed when you made the PAT. Workshop warns 14 days before.' },
          apiVersion: { type: 'string', title: 'API version', default: '6.0', pattern: '^[0-9]+\\.[0-9]+$' },
          useSystemCa: { type: 'boolean', title: 'Trust certificates trusted by this computer', description: 'Needed when the ADO server uses a company certificate.', default: true },
          verifyTls: { type: 'boolean', title: 'Check the server certificate', description: 'Turn off only if your ADO server has a broken certificate and you accept the risk.', default: true }
        }
      }
    },
    defaultConnection: { type: 'string', title: 'Default connection', description: 'Its name. Used when a repo has no mapping. Not needed with one connection.' },
    syncConnection: { type: 'string', title: 'Connection for my work items', description: 'Empty means the default connection.', 'x-workshop-page': 'work-items' },
    paths: {
      type: 'array',
      title: 'Repo and path mapping',
      description: 'Which connection and project a repo or folder uses. * matches any characters.',
      'x-workshop-page': 'repos',
      'x-workshop-hosted': true,
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
    types: { ...stringList('Work item types', null, ['Issue', 'Bug', 'User Story']), 'x-workshop-page': 'work-items' },
    closedStates: { ...stringList('States that count as done', null, ['Resolved', 'Closed', 'Done']), 'x-workshop-page': 'work-items' },
    removedStates: { ...stringList('States that count as won\'t do', null, ['Removed']), 'x-workshop-page': 'work-items' },
    prSources: {
      type: 'array',
      title: 'Pull request sources',
      description: 'Where to look for pull requests waiting on you. Empty skips PRs.',
      'x-workshop-page': 'pull-requests',
      'x-workshop-hosted': true,
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
    prTeams: { ...stringList('Teams that count as mine', 'Empty means every team you are on.', []), 'x-workshop-page': 'pull-requests' },
    prNotNeeded: {
      type: 'object',
      title: 'PRs that don\'t need you',
      description: 'Left out of Docket and Dispatch. A PR where you are a required reviewer always needs you.',
      'x-workshop-page': 'pull-requests',
      additionalProperties: false,
      properties: {
        teamOnly: { type: 'boolean', title: 'Team-only PRs (only your team was added, not you by name)', default: true },
        canMerge: { type: 'boolean', title: 'Every required reviewer already approved', default: true },
        approvals: { type: 'integer', title: 'This many others already approved (0 turns this off)', minimum: 0, maximum: 20, default: 2 }
      }
    },
    reports: {
      type: 'object',
      title: 'Team reports',
      description: 'How Runway\'s ADO reports count work. Most people never change these.',
      'x-workshop-page': 'work-items',
      'x-workshop-section': 'Team reports (used by Runway)',
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

let running = null; // the ctx from start(), until stop()
let problem = null;  // a settings problem found at start
let details = null;
const auth = authTracker();

/** Reads a variable through the agent, which looks up saved user variables live on Windows. */
const reader = ctx => name => ctx.env(name);

/** Everything an action needs, from the agent's ctx. */
function deps(ctx) {
  const { config, problems } = normalize(ctx.config);
  if (!config.connections.length) throw new SettingsError(problems[0] || 'Add an ADO connection in Settings.');
  const env = reader(ctx);
  env.onAuth = auth.hooks(env);
  return { cfg: config, env, signal: ctx.signal, now: new Date() };
}

/** Keeps plain-words errors and maps anything unexpected to a safe message. */
async function guarded(ctx, label, fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AdoError || e instanceof SettingsError || e instanceof ConflictError) {
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
  version: '1.12.0',
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
    'areas.mine': {
      title: 'Area paths of my open work items (for Team area paths)',
      write: false,
      argsSchema: { type: 'object', properties: {} },
      async run(args, ctx) {
        return guarded(ctx, 'areas.mine', () => areasMine(deps(ctx)));
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
          details: { type: 'boolean' },
          html: { type: 'boolean', description: 'With details: also the raw ADO HTML of description, acceptance criteria and repro steps (untrusted).' },
          pullRequests: { type: 'boolean', description: 'With details: linked pull requests.' },
          comments: { type: 'boolean', description: 'Also the comments, oldest first.' },
          history: { type: 'boolean', description: 'Also changes to state, assignee, priority, sprint, area, tags and title, newest first.' },
          extras: { type: 'boolean', description: 'Also assignee, priority, severity, story points, system info, comment count, links and the `fields` asked for (Slate).' },
          pointsFields: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 200, pattern: '^[A-Za-z][A-Za-z0-9_.]*$' } },
          fields: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 200, pattern: '^[A-Za-z][A-Za-z0-9_.]*$' } }
        }
      },
      async run(args, ctx) {
        return guarded(ctx, 'workitem.get', () => getWorkItem(deps(ctx), args));
      }
    },

    'workitem.prs': {
      title: 'Pull requests linked to a work item and its child items, with their status (Slate)',
      write: false,
      argsSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'integer', minimum: 1 },
          connection: { type: 'string', maxLength: 40 },
          children: { type: 'boolean', description: 'Also the PRs linked to child items (default true).' }
        }
      },
      async run(args, ctx) {
        return guarded(ctx, 'workitem.prs', async () => {
          const out = await workItemPrs(deps(ctx), args);
          ctx.log.info(`workitem.prs: ${args.id} has ${out.prs.length} PRs (${out.status})`);
          return out;
        });
      }
    },

    roadmap: {
      title: 'Epics and Features in my team\'s areas, with story progress (and the stories, when asked)',
      write: false,
      argsSchema: {
        type: 'object',
        required: ['areas'],
        properties: {
          connection: { type: 'string', maxLength: 40 },
          areas: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 400 } },
          includeClosed: { type: 'boolean' },
          stories: { type: 'boolean' }
        }
      },
      async run(args, ctx) {
        return guarded(ctx, 'roadmap', async () => {
          const out = await roadmapList(deps(ctx), args || {});
          ctx.log.info(`roadmap: ${out.items.length} items${out.truncated ? ` of ${out.total}` : ''}`);
          return out;
        });
      }
    },

    backlog: {
      title: 'Open work items in my team\'s areas, any type and parent (Slate)',
      write: false,
      argsSchema: {
        type: 'object',
        required: ['areas'],
        properties: {
          connection: { type: 'string', maxLength: 40 },
          areas: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 400 } },
          types: { type: 'array', maxItems: 10, items: { type: 'string', enum: BACKLOG_TYPES } },
          pointsFields: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 200, pattern: '^[A-Za-z][A-Za-z0-9_.]*$' } },
          fields: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 200, pattern: '^[A-Za-z][A-Za-z0-9_.]*$' } }
        }
      },
      async run(args, ctx) {
        return guarded(ctx, 'backlog', async () => {
          const out = await backlogList(deps(ctx), args || {});
          ctx.log.info(`backlog: ${out.items.length} items${out.truncated ? ` of ${out.total}` : ''}`);
          return out;
        });
      }
    },

    'iterations.list': {
      title: 'Sprints of a project',
      write: false,
      argsSchema: { type: 'object', properties: { connection: { type: 'string', maxLength: 40 }, project: { type: 'string', maxLength: 200 } } },
      async run(args, ctx) {
        return guarded(ctx, 'iterations.list', () => iterationsList(deps(ctx), args || {}));
      }
    },
    'workitem.update': {
      title: 'Change a work item (title, state, assignee, priority, sprint, area, dates, tags), comment on it, or link related items',
      write: true,
      argsSchema: {
        type: 'object',
        required: ['id', 'rev', 'changes'],
        properties: {
          id: { type: 'integer', minimum: 1 },
          rev: { type: 'integer', minimum: 1 },
          connection: { type: 'string', maxLength: 40 },
          changes: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { type: 'string', minLength: 1, maxLength: 255 },
              state: { type: 'string', minLength: 1, maxLength: 100 },
              area: { type: 'string', minLength: 1, maxLength: 400 },
              startDate: { type: 'string', pattern: '^(\\d{4}-\\d{2}-\\d{2})?$', description: 'YYYY-MM-DD; empty string clears it.' },
              targetDate: { type: 'string', pattern: '^(\\d{4}-\\d{2}-\\d{2})?$', description: 'YYYY-MM-DD; empty string clears it.' },
              assignedTo: { type: 'string', maxLength: 300, description: 'Email or "Name <email>". Empty string unassigns.' },
              priority: { type: 'integer', minimum: 1, maximum: 4 },
              iteration: { type: 'string', minLength: 1, maxLength: 400 },
              description: { type: 'string', maxLength: 32000, description: 'Plain text or Markdown; sent as HTML with line breaks kept.' },
              acceptance: { type: 'string', maxLength: 32000, description: 'Acceptance criteria, plain text or Markdown; sent as HTML with line breaks kept.' },
              tagsAdd: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 100 } },
              tagsRemove: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 100 } },
              comment: { type: 'string', minLength: 1, maxLength: 32000, description: 'Added to the Discussion, plain text or Markdown; sent as HTML with line breaks kept.' },
              related: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'integer', minimum: 1 }, description: 'Work item ids to add Related links to. Ones already linked are skipped.' }
            }
          }
        }
      },
      async run(args, ctx) {
        return guarded(ctx, 'workitem.update', async () => {
          const out = await updateWorkItem(deps(ctx), args);
          ctx.log.info(`workitem.update: ${args.id} now rev ${out.rev} (${Object.keys(args.changes || {}).join(', ')})`);
          return out;
        });
      }
    },

    'workitem.create': {
      title: 'Create a work item (Slate: epic, feature, story or bug, with its description and acceptance criteria)',
      write: true,
      argsSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'title'],
        properties: {
          type: { type: 'string', enum: CREATE_TYPES },
          title: { type: 'string', minLength: 1, maxLength: 255 },
          project: { type: 'string', maxLength: 200 },
          connection: { type: 'string', maxLength: 40 },
          parent: { type: 'integer', minimum: 1, description: 'The new item goes under this one (a parent link).' },
          fields: {
            type: 'object',
            additionalProperties: false,
            properties: {
              description: { type: 'string', maxLength: 32000 },
              acceptance: { type: 'string', maxLength: 32000 },
              area: { type: 'string', minLength: 1, maxLength: 400 },
              iteration: { type: 'string', minLength: 1, maxLength: 400 },
              assignedTo: { type: 'string', maxLength: 300 },
              priority: { type: 'integer', minimum: 1, maximum: 4 },
              tags: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 100 } }
            }
          }
        }
      },
      async run(args, ctx) {
        return guarded(ctx, 'workitem.create', async () => {
          const out = await createWorkItem(deps(ctx), args);
          ctx.log.info(`workitem.create: ${args.type} ${out.id}${args.parent ? ` under ${args.parent}` : ''}`);
          return out;
        });
      }
    },

    'connection.resolve': {
      title: 'Show which connection a repo or folder uses',
      write: false,
      setup: true,
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
      setup: true,
      argsSchema: { type: 'object', properties: { helper: { type: 'object' }, engAgents: { type: 'object' }, file: { type: 'object' } } },
      async run(args, ctx) {
        // file: one parsed file from Settings (docs/connector.md, Import from a file); which kind it is is guessed.
        if (args?.file) return importFile(args.file, ctx.config);
        return importConfig({ helper: args?.helper, engAgents: args?.engAgents, current: ctx.config });
      }
    },
    'config.fromUrl': {
      title: 'Fill in the settings from a link copied out of ADO',
      write: false,
      setup: true,
      argsSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string', maxLength: 2000 } } },
      async run(args, ctx) {
        try { const { config, notes } = configFromUrl(args?.url, ctx.config); return { config, notes }; }
        catch (e) { throw new SettingsError(e.message); }
      }
    }
  },
  async start(ctx) {
    const { config, problems } = normalize(ctx.config);
    details = { connections: config.connections.length, prSources: config.prSources.length };
    problem = problems[0] || null;
    auth.clear();
    auth.onChange(() => ctx.statusChanged());
    running = ctx;
  },
  async stop() {
    running = null;
    problem = null;
    auth.onChange(() => {});
  },
  // Worked out on every call, so a PAT saved while Workshop runs (workshop pat) counts at once: missing
  // PATs, a PAT ADO rejected (until a new one is saved), and PATs near the "PAT expires" date.
  status() {
    if (!running) return { state: 'stopped', message: null };
    if (problem) return { state: 'error', message: problem, ...(details ? { details } : {}) };
    const read = reader(running);
    const { config } = normalize(running.config);
    const s = patStatus(config, read, auth.active(read));
    return { state: s.state, message: s.message, details: { ...details, ...s.details } };
  }
};
