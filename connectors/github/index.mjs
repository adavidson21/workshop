// GitHub connector: issues assigned to you, pull requests waiting on your review, and roadmaps (milestones, Features
// and stories), in the same shapes as the ADO connector, so Docket, Loom and Runway treat both trackers alike. Read only. See connectors/github/README.md.
import { GhError, SettingsError } from './lib/client.mjs';
import { DEFAULT_TYPES, normalize, pickConnection } from './lib/config.mjs';
import { areasMine, cleanKnown, cleanKnownPrs, getIssue, sync } from './lib/issues.mjs';
import { syncPrs } from './lib/prs.mjs';
import { iterationsList, roadmapList } from './lib/roadmap.mjs';
import { clientFor } from './lib/client.mjs';
import { configFromUrl } from './lib/url.mjs';
import { authTracker, tokenStatus } from './lib/token.mjs';

const stringList = (title, description, def) => ({ type: 'array', title, ...(description ? { description } : {}), items: { type: 'string' }, ...(def ? { default: def } : {}) });

export const configSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['connections'],
  properties: {
    connections: {
      type: 'array',
      title: 'Connections',
      description: 'One per GitHub account or GitHub Enterprise server. Most people need one.',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'tokenEnv'],
        properties: {
          name: { type: 'string', title: 'Name', pattern: '^[A-Za-z0-9_-]{1,40}$', default: 'github', description: 'Any short name, letters, digits, - or _.' },
          apiUrl: { type: 'string', title: 'API URL', format: 'uri', default: 'https://api.github.com', description: 'https://api.github.com for github.com, or https://<your server>/api/v3 for GitHub Enterprise Server.' },
          tokenEnv: { type: 'string', title: 'Token environment variable', 'x-workshop-env': true, default: 'GITHUB_PAT', description: 'A fine-grained token with Issues and Pull requests (Read), and Members (Read) for team reviews. Save it with: workshop pat GITHUB_PAT' },
          tokenExpires: { type: 'string', title: 'Token expires', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', maxLength: 10, description: 'Optional, YYYY-MM-DD. GitHub usually tells Workshop on its own; Workshop warns 14 days before.' }
        }
      }
    },
    defaultConnection: { type: 'string', title: 'Default connection', description: 'Its name. Not needed with one connection.' },
    repos: { ...stringList('Repos', 'owner/repo, one per line. Only these count for your issues and reviews. Empty means every repo you can see.', []), 'x-workshop-hosted': true },
    types: { ...stringList('Issue types to sync', 'From labels: epic, feature, story, bug, task. An issue with none of them is an Issue.', DEFAULT_TYPES) },
    areaLabelPrefix: { type: 'string', title: 'Area label prefix', default: 'area:', maxLength: 40, description: 'A label like "area: billing" puts an issue in the area owner/repo/billing. Without one, the repo is the area.' },
    prs: { type: 'boolean', title: 'Sync pull requests waiting on my review', default: true },
    prTeams: { ...stringList('Teams that count as mine', 'org/team, one per line. Empty means every team you are on.', []) },
    prNotNeeded: {
      type: 'object',
      title: 'PRs that don\'t need you',
      description: 'Left out of Docket and Loom. A PR where you are the only reviewer asked and a review is required always needs you.',
      additionalProperties: false,
      properties: {
        teamOnly: { type: 'boolean', title: 'Team-only PRs (only your team was asked, not you by name)', default: true },
        canMerge: { type: 'boolean', title: 'Already approved enough to merge', default: true },
        approvals: { type: 'integer', title: 'This many others already approved (0 turns this off)', minimum: 0, maximum: 20, default: 2 }
      }
    }
  }
};

let running = null;
let problem = null;
let details = null;
const auth = authTracker();
const reader = ctx => name => ctx.env(name);

function deps(ctx) {
  const { config, problems } = normalize(ctx.config);
  if (!config.connections.length) throw new SettingsError(problems[0] || 'Add a GitHub connection in Settings.');
  const env = reader(ctx);
  env.onAuth = auth.hooks(env);
  return { cfg: config, env, signal: ctx.signal, now: new Date() };
}

async function guarded(ctx, label, fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof GhError || e instanceof SettingsError) {
      ctx.log.warn(`${label} failed: ${e.message}`);
      throw e;
    }
    ctx.log.error(`${label} failed unexpectedly: ${e && e.name}`);
    const err = new Error('The GitHub connector hit an unexpected problem. See the Workshop log.');
    err.status = 500;
    err.code = 'internal';
    throw err;
  }
}

export default {
  api: 1,
  id: 'github',
  name: 'GitHub',
  version: '1.1.0',
  configSchema,
  test: { action: 'workitem.get', arg: 'id', label: 'Issue (owner/repo#12)' },
  actions: {
    sync: {
      title: 'Sync my issues',
      write: false,
      argsSchema: {
        type: 'object',
        properties: {
          known: { type: 'array', description: 'Issue ids (owner/repo#12) already on the board.' },
          knownPrs: { type: 'array', description: 'PR keys already on the board.' },
          prs: { type: 'boolean', description: 'Also sync PRs (default true).' }
        }
      },
      async run(args, ctx) {
        return guarded(ctx, 'sync', async () => {
          const out = await sync(deps(ctx), cleanKnown(args?.known), cleanKnownPrs(args?.knownPrs), { prs: args?.prs !== false });
          ctx.log.info(`sync: ${out.items.length} issues, ${out.gone.length} gone${out.prs ? `, ${out.prs.items.length} PRs` : ''}`);
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
          const d = deps(ctx);
          const out = await syncPrs(d, cleanKnownPrs(args?.knownPrs), clientFor(pickConnection(d.cfg), d.env, d.signal));
          ctx.log.info(`sync.prs: ${out.items.length} PRs, ${out.gone.length} gone`);
          return out;
        });
      }
    },
    'areas.mine': {
      title: 'Areas of my open issues (repo, or repo/area label)',
      write: false,
      argsSchema: { type: 'object', properties: { connection: { type: 'string', maxLength: 40 } } },
      async run(args, ctx) {
        return guarded(ctx, 'areas.mine', () => areasMine(deps(ctx), args || {}));
      }
    },
    'workitem.get': {
      title: 'Get an issue',
      write: false,
      argsSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: ['string', 'integer'], description: 'owner/repo#12, or a number with repo.' },
          repo: { type: 'string', maxLength: 200 },
          connection: { type: 'string', maxLength: 40 },
          details: { type: 'boolean' },
          extras: { type: 'boolean' },
          comments: { type: 'boolean' }
        }
      },
      async run(args, ctx) {
        return guarded(ctx, 'workitem.get', () => getIssue(deps(ctx), args || {}));
      }
    },
    roadmap: {
      title: 'Epics (milestones), Features and stories for Runway',
      write: false,
      argsSchema: {
        type: 'object',
        required: ['areas'],
        properties: {
          areas: { type: 'array', items: { type: 'string', maxLength: 400 }, minItems: 1, maxItems: 50 },
          includeClosed: { type: 'boolean' },
          stories: { type: 'boolean' },
          fields: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 20 },
          connection: { type: 'string', maxLength: 40 }
        }
      },
      async run(args, ctx) {
        return guarded(ctx, 'roadmap', async () => {
          const out = await roadmapList(deps(ctx), args || {});
          ctx.log.info(`roadmap: ${out.items.length} items`);
          return out;
        });
      }
    },
    'iterations.list': {
      title: 'Sprints (none on GitHub outside Projects)',
      write: false,
      argsSchema: { type: 'object', properties: { project: { type: 'string', maxLength: 200 }, connection: { type: 'string', maxLength: 40 } } },
      async run(args, ctx) {
        return guarded(ctx, 'iterations.list', async () => iterationsList(deps(ctx), args || {}));
      }
    },
    'connection.resolve': {
      title: 'Which connection would be used, and whether its token is set',
      write: false,
      setup: true,
      argsSchema: { type: 'object', properties: { connection: { type: 'string', maxLength: 40 } } },
      async run(args, ctx) {
        const { config } = normalize(ctx.config);
        const c = pickConnection(config, args?.connection);
        let set = false;
        try { set = !!String(ctx.env(c.tokenEnv) || '').trim(); } catch { set = false; }
        return { connection: c.name, apiUrl: c.apiUrl, tokenEnv: c.tokenEnv, tokenSet: set };
      }
    },
    'config.fromUrl': {
      title: 'Fill in the settings from a link copied out of GitHub',
      write: false,
      setup: true,
      argsSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string', maxLength: 2000 } } },
      async run(args, ctx) {
        try { return configFromUrl(args?.url, ctx.config); }
        catch (e) { throw new SettingsError(e.message); }
      }
    }
  },
  async start(ctx) {
    const { config, problems } = normalize(ctx.config);
    details = { connections: config.connections.length, repos: config.repos.length };
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
  status() {
    if (!running) return { state: 'stopped', message: null };
    if (problem) return { state: 'error', message: problem, ...(details ? { details } : {}) };
    const read = reader(running);
    const { config } = normalize(running.config);
    const s = tokenStatus(config, read, auth);
    return { state: s.state, message: s.message, details: { ...details, ...s.details } };
  }
};
