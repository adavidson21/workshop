// The Google Play connector (README.md): reads your apps on Google Play (tracks, uploaded bundles, reviews, the app
// signing key) and changes them only from a release set a person approved in Workshop. Tandem's agents can read
// and propose through /api/tools and /api/mcp (docs/agent-api.md, Tools for agents); they can never apply. The
// service account key comes from this computer's secret store (`workshop secret set play --from-file key.json`),
// never an environment variable. Off in work mode: it is for your own computer. Node standard library only. It
// calls only the API and token addresses in its settings, plus your app's own site to check assetlinks.json.
import fs from 'node:fs';
import { DEFAULT_API, PlayError, SettingsError, clientFor } from './lib/client.mjs';
import { DEFAULT_TOKEN_URL } from './lib/key.mjs';
import { inspectBundle } from './lib/aab.mjs';
import {
  MAX_CHANGES, OPS, PACKAGE, DEFAULT_BUNDLE, TRACK_LABELS, appOf, applySet, assetlinks, bundlePath, checkSet,
  fingerprint, localFingerprints, normalize, preview, reviewOf, tracksOf, trackLabel
} from './lib/releases.mjs';
import * as store from './lib/store.mjs';

const enc = encodeURIComponent;
let running = null;      // ctx while started
let state = { verified: null, problem: null, email: null, checking: false };
let waiting = 0;
let fetchImpl = null;    // tests only
let homeDir;             // tests only

/** Tests point the client at a fake fetch, and ~ at a temporary home. */
export function setFetch(f) { fetchImpl = f; }
export function setHome(h) { homeDir = h; }

function guard(ctx, meta) {
  if (ctx.workMode()) throw new SettingsError('The Google Play connector is off in work mode. It is for your own computer.', 'disabled');
  if (meta && meta.caller === 'agent' && ctx.config.agents !== true) throw new SettingsError('Tandem may not use Google Play: "Let Tandem read and propose releases" is off in Settings, Google Play.', 'forbidden');
}

async function gp(ctx, meta) {
  guard(ctx, meta);
  try { return await clientFor(ctx, { fetchImpl }); }
  catch (e) { noteAuth(e); throw e; }
}

function noteAuth(e) {
  if (e instanceof PlayError && (e.upstream === 401 || /No service account key saved|not a service account key|cannot be read/.test(e.message))) {
    state.problem = e.message;
    if (running) running.statusChanged();
  }
}

/** Runs fn with a client and the app named in args.app; a rejected key shows on the connector's status. */
const withApp = fn => async (args, ctx, meta) => {
  const play = await gp(ctx, meta);
  const app = appOf(ctx.config, args && args.app);
  try { return await fn(play, app, args || {}, ctx, meta); } catch (e) { noteAuth(e); throw e; }
};

function countWaiting(ctx) {
  try { waiting = store.list(ctx.dataDir).filter(s => s.status === 'waiting').length; } catch { waiting = 0; }
  return waiting;
}
function changed(ctx) {
  countWaiting(ctx);
  try { ctx.emit('releases', { waiting }); } catch { /* best effort */ }
  ctx.statusChanged();
}

/** Steps as a set file keeps them: summaries (and problems) only. */
const stepsOf = checked => checked.steps.map(s => ({ summary: s.summary, ...(s.problem ? { problem: s.problem } : {}) }));
/** Problems as one message. */
const problems = checked => checked.steps.map((s, i) => (s.problem ? `${i + 1}. ${s.problem}` : '')).filter(Boolean).join(' ');

/** A waiting set checked again against the settings, the bundle file and Play now (never read from the file). */
async function recheck(ctx, meta, s) {
  const checked = checkSet(s.changes, ctx.config, s.app, { keepPin: true });
  if (checked.app.packageName !== s.app) throw new SettingsError(`${s.app} is not one of your apps anymore.`);
  return preview(await gp(ctx, meta), checked.app, checked, { home: homeDir });
}

const appArg = { type: 'string', minLength: 1, maxLength: 150 };
const changesArg = { type: 'array', minItems: 1, maxItems: MAX_CHANGES, items: { type: 'object' } };

const connector = {
  api: 1,
  id: 'play',
  name: 'Google Play',
  version: '1.1.0',
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      keySecret: { type: 'string', title: 'Service account key', 'x-workshop-secret': true, 'x-workshop-secret-kind': 'key-file', default: 'play', description: 'Click Add key file and choose the JSON key Google Cloud gave you, then delete the file. See the connector README for the Play Console permissions to give it.' },
      apps: {
        type: 'array', title: 'Apps',
        description: 'Your apps on Google Play. Tandem can only touch these, and uploads only the bundle in each app\'s project folder.',
        items: {
          type: 'object', additionalProperties: false, required: ['packageName'],
          properties: {
            packageName: { type: 'string', title: 'Package name', pattern: PACKAGE.source, description: 'Like org.example.wishlist. Play Console shows it under the app name.' },
            name: { type: 'string', title: 'Name', description: 'What you call it, so you and Tandem can say "wishlist".' },
            folder: { type: 'string', title: 'Project folder', description: 'The Android project on this computer (Bubblewrap or Gradle), a full path like ~/source/repos/wishlist-android.' },
            kind: { type: 'string', title: 'Kind of project', enum: ['bubblewrap', 'gradle'], 'x-workshop-labels': ['Bubblewrap (a PWA)', 'Gradle (Android Studio, Capacitor, Flutter...)'], default: 'bubblewrap' },
            bundle: { type: 'string', title: 'Bundle file', description: `Inside the project folder. Leave empty for ${DEFAULT_BUNDLE.bubblewrap} (Bubblewrap) or ${DEFAULT_BUNDLE.gradle} (Gradle).` },
            site: { type: 'string', format: 'uri', title: 'Site (PWAs)', description: 'The PWA\'s address, like https://wishlist.example.org, to check its assetlinks.json.' },
            signingSecret: { type: 'string', title: 'Signing password (secret name)', 'x-workshop-secret': true, 'x-workshop-secret-kind': 'password', description: 'Only "workshop play build" reads it, to sign the bundle. Click Add password to save it.' },
            keyPasswordSecret: { type: 'string', title: 'Key password (secret name), if different', 'x-workshop-secret': true, 'x-workshop-secret-kind': 'password' }
          }
        }
      },
      agents: { type: 'boolean', title: 'Let Tandem read and propose releases', default: true, description: 'Tandem can read your apps on Play and propose release sets. Only you approve them, in Approvals.' },
      apiUrl: { type: 'string', format: 'uri', title: 'API address', default: DEFAULT_API, 'x-workshop-section': 'Advanced' },
      tokenUrl: { type: 'string', format: 'uri', title: 'Token address', default: DEFAULT_TOKEN_URL, 'x-workshop-section': 'Advanced' }
    }
  },
  test: { action: 'tracks.list', arg: 'app', label: 'Package name' },
  actions: {
    'token.verify': {
      title: 'Check the service account key with Google', write: false, agent: true,
      async run(args, ctx, meta) {
        const play = await gp(ctx, meta);
        try {
          await play.token({ fresh: true });
          state = { ...state, verified: new Date().toISOString(), problem: null, email: play.email };
          ctx.statusChanged();
          return { ok: true, serviceAccount: play.email };
        } catch (e) { noteAuth(e); throw e; }
      }
    },
    'apps.list': {
      title: 'List your apps and their bundles on this computer', write: false, agent: true,
      async run(args, ctx, meta) {
        guard(ctx, meta);
        return (ctx.config.apps || []).map(a => {
          let file = null, problem = null;
          try { file = bundlePath(a, { home: homeDir }).file; } catch (e) { problem = e.message; }
          return { packageName: a.packageName, name: a.name || null, kind: a.kind || 'bubblewrap', folder: a.folder || null, bundle: file, bundleExists: !!(file && fs.existsSync(file)), site: a.site || null, ...(problem ? { problem } : {}) };
        });
      }
    },
    'bundle.inspect': {
      title: 'Read the app\'s bundle on this computer (package, version code, SHA-256)', write: false, agent: true,
      argsSchema: { type: 'object', properties: { app: appArg } },
      async run(args, ctx, meta) {
        guard(ctx, meta);
        const app = appOf(ctx.config, args.app);
        const { file } = bundlePath(app, { home: homeDir });
        if (!fs.existsSync(file)) return { file, exists: false, next: `Build it: workshop play build ${app.packageName}` };
        const b = await inspectBundle(file);
        return { file, exists: true, ...b, matches: b.packageName ? b.packageName === app.packageName : null };
      }
    },
    'tracks.list': {
      title: 'List an app\'s tracks and releases on Play', write: false, agent: true,
      argsSchema: { type: 'object', properties: { app: appArg } },
      run: withApp(async (play, app) => {
        const { out } = await play.withEdit(app.packageName, async (id, base) => tracksOf(await play.get(`${base}/tracks`)));
        return { app: app.packageName, tracks: out.map(t => ({ ...t, label: TRACK_LABELS[t.track] || t.track })) };
      })
    },
    'bundles.list': {
      title: 'List the bundles uploaded to Play for an app', write: false, agent: true,
      argsSchema: { type: 'object', properties: { app: appArg } },
      run: withApp(async (play, app) => {
        const { out } = await play.withEdit(app.packageName, async (id, base) => (await play.get(`${base}/bundles`)).bundles || []);
        return out.map(b => ({ versionCode: Number(b.versionCode), sha256: b.sha256 || null })).sort((a, b) => b.versionCode - a.versionCode).slice(0, 30);
      })
    },
    'reviews.list': {
      title: 'Read an app\'s recent reviews on Play (the last week, with text)', write: false, agent: true,
      argsSchema: { type: 'object', properties: { app: appArg, max: { type: 'integer', minimum: 1, maximum: 100 } } },
      run: withApp(async (play, app, args) => {
        const r = await play.get(`/applications/${enc(app.packageName)}/reviews`, { maxResults: String(args.max || 20) });
        return (r.reviews || []).map(reviewOf);
      })
    },
    'signing.info': {
      title: 'The app signing key\'s fingerprint, and the assetlinks.json for the app\'s site', write: false, agent: true,
      argsSchema: { type: 'object', properties: { app: appArg, versionCode: { type: 'integer', minimum: 1 } } },
      run: withApp(async (play, app, args) => {
        let vc = args.versionCode;
        if (!vc) {
          const { out } = await play.withEdit(app.packageName, async (id, base) => ((await play.get(`${base}/bundles`)).bundles || []).map(b => Number(b.versionCode)));
          vc = out.length ? Math.max(...out) : null;
        }
        if (!vc) throw new SettingsError(`Nothing is uploaded for ${app.packageName} yet, so Play has not signed it. Upload the first bundle in Play Console, then ask again.`);
        const g = await play.get(`/applications/${enc(app.packageName)}/generatedApks/${vc}`);
        const appSigning = [...new Set((g.generatedApks || []).map(x => fingerprint(x.certificateSha256Hash)).filter(Boolean))];
        let local = [];
        try { local = localFingerprints(bundlePath(app, { home: homeDir }).folder); } catch { /* no folder set */ }
        const all = [...new Set([...appSigning, ...local])];
        return {
          versionCode: vc, appSigning, local, assetlinks: assetlinks(app.packageName, all),
          next: app.site ? `Serve this as ${new URL('/.well-known/assetlinks.json', app.site).href} (in the site's repo: .well-known/assetlinks.json), then check it with assetlinks.check.` : 'Serve this as /.well-known/assetlinks.json on the PWA\'s site.'
        };
      })
    },
    'assetlinks.check': {
      title: 'Check that the app\'s site serves an assetlinks.json Android accepts for it', write: false, agent: true,
      argsSchema: { type: 'object', properties: { app: appArg } },
      async run(args, ctx, meta) {
        guard(ctx, meta);
        const app = appOf(ctx.config, args.app);
        if (!app.site) throw new SettingsError(`Set the Site for ${app.packageName} in Settings, Google Play, first.`);
        let url;
        try { url = new URL('/.well-known/assetlinks.json', app.site); } catch { throw new SettingsError(`The Site for ${app.packageName} is not an address.`); }
        if (url.protocol !== 'https:') throw new SettingsError('The site must be https: Android only trusts assetlinks.json over https.');
        // The app signing key, when Play can say (it needs a bundle uploaded and a working key).
        let expect = [], why = null;
        try { expect = (await connector.actions['signing.info'].run({ app: app.packageName }, ctx, meta)).appSigning; } catch (e) { why = e.message; }
        let res;
        try { res = await (fetchImpl || globalThis.fetch)(url.href, { redirect: 'manual', headers: { Accept: 'application/json', 'User-Agent': 'Workshop' }, signal: ctx.signal }); }
        catch { return { url: url.href, ok: false, problem: `Could not reach ${url.host}.` }; }
        if (res.status >= 300 && res.status < 400) return { url: url.href, ok: false, problem: `It redirects (HTTP ${res.status}). Android does not follow redirects for assetlinks.json: serve it at this exact address.` };
        if (res.status !== 200) return { url: url.href, ok: false, problem: `It answered HTTP ${res.status}. Add .well-known/assetlinks.json to the site.` };
        let j;
        try { j = JSON.parse(await res.text()); } catch { return { url: url.href, ok: false, problem: 'It is not valid JSON.' }; }
        const type = String(res.headers.get('content-type') || '');
        const stmts = (Array.isArray(j) ? j : []).filter(s => s && s.target && s.target.namespace === 'android_app' && s.target.package_name === app.packageName && Array.isArray(s.relation) && s.relation.includes('delegate_permission/common.handle_all_urls'));
        const listed = [...new Set(stmts.flatMap(s => s.target.sha256_cert_fingerprints || []).map(fingerprint).filter(Boolean))];
        const missing = expect.filter(f => !listed.includes(f));
        const problem = !stmts.length ? `It has no entry for ${app.packageName}. Use signing.info for the right one.`
          : missing.length ? 'It does not list Play\'s app signing key, so Android shows the address bar. Add the fingerprint from signing.info.'
          : !/application\/json/i.test(type) ? `It is served as "${type || 'no type'}"; Android wants application/json.` : null;
        return { url: url.href, ok: !problem, listed, expected: expect, missing, ...(problem ? { problem } : {}), ...(why && !expect.length ? { note: `Could not read Play's app signing key: ${why}` } : {}) };
      }
    },
    'releases.check': {
      title: 'Check a release set without saving it', write: false, agent: true,
      argsSchema: { type: 'object', required: ['changes'], properties: { app: appArg, changes: changesArg } },
      async run(args, ctx, meta) {
        guard(ctx, meta);
        const checked = checkSet(args.changes, ctx.config, args.app);
        const out = await preview(await gp(ctx, meta), checked.app, checked, { pin: true, home: homeDir });
        return { app: out.app.packageName, ok: out.ok, steps: stepsOf(out) };
      }
    },
    'releases.propose': {
      title: 'Propose a release set for you to approve', write: false, agent: true,
      argsSchema: { type: 'object', required: ['title', 'changes'], properties: {
        title: { type: 'string', minLength: 3, maxLength: 120 }, why: { type: 'string', maxLength: 2000 },
        item: { type: 'string', maxLength: 80 }, app: appArg, changes: changesArg
      } },
      async run(args, ctx, meta) {
        guard(ctx, meta);
        const first = checkSet(args.changes, ctx.config, args.app);
        const checked = await preview(await gp(ctx, meta), first.app, first, { pin: true, home: homeDir });
        if (!checked.ok) {
          const e = new SettingsError(`Not saved. Fix these first: ${problems(checked)}`);
          e.extra = { steps: stepsOf(checked) };
          throw e;
        }
        const now = new Date();
        const set = {
          id: store.newId(now), title: args.title.trim(), why: (args.why || '').trim(), item: (args.item || '').trim() || null, app: checked.app.packageName,
          from: meta && meta.caller === 'agent' ? 'Tandem' : 'you', created: now.toISOString(), status: 'waiting',
          changes: checked.steps.map(s => s.change), steps: stepsOf(checked)
        };
        store.save(ctx.dataDir, set);
        ctx.log.info(`Release set ${set.id} for ${set.app} proposed by ${set.from}: ${set.title} (${set.steps.length} changes).`);
        const asked = await ctx.requestApproval('releases.apply', { id: set.id, digest: store.digest(set) }, { title: `Google Play: ${set.title}`, by: set.from === 'Tandem' ? 'agent' : 'you' });
        if (asked.approval) store.save(ctx.dataDir, { ...set, approval: asked.approval.id });
        changed(ctx);
        if (asked.rule) {
          const done = store.load(ctx.dataDir, set.id);
          return { id: set.id, status: done ? done.status : 'applied', steps: set.steps, rule: asked.rule, results: asked.result && asked.result.results, next: 'An always-allow rule covered it, so it was applied. Check it with releases.get.' };
        }
        return { id: set.id, status: set.status, steps: set.steps, approval: asked.approval.id, next: 'Waiting for you to approve it in Workshop (Approvals, or Needs you). Check back with releases.get.' };
      }
    },
    'releases.list': {
      title: 'List release sets', write: false, agent: true,
      argsSchema: { type: 'object', properties: { status: { type: 'string', enum: store.STATUSES } } },
      async run(args, ctx, meta) {
        guard(ctx, meta);
        return store.list(ctx.dataDir).filter(s => !args.status || s.status === args.status).slice(0, 50).map(store.brief);
      }
    },
    'releases.get': {
      title: 'Read one release set and what happened to it', write: false, agent: true,
      argsSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', maxLength: 40 } } },
      async run(args, ctx, meta) {
        guard(ctx, meta);
        const s = store.load(ctx.dataDir, args.id);
        if (!s) throw Object.assign(new Error(`There is no release set ${args.id}.`), { status: 404, code: 'not_found' });
        if (s.status !== 'waiting') return s;
        // A waiting set's steps are worked out again from its changes, the bundle file and Play now (never taken
        // from the file, which anything running as you could have edited). `digest` goes back with Apply.
        const checked = await recheck(ctx, meta, s);
        return { ...s, steps: stepsOf(checked), ok: checked.ok, digest: store.digest(s) };
      }
    },
    'releases.apply': {
      title: 'Make a release set\'s changes on Google Play', write: true, agent: 'ask',
      argsSchema: { type: 'object', required: ['id', 'digest'], properties: { id: { type: 'string', maxLength: 40 }, digest: { type: 'string', pattern: '^[0-9a-f]{64}$' } } },
      // What Approvals shows: the steps worked out from the set's changes, the bundle file and Play now.
      async describe(args, ctx) {
        const s = store.load(ctx.dataDir, args.id);
        if (!s) throw new Error(`There is no release set ${args.id}.`);
        if (s.status !== 'waiting') throw new Error(`Release set ${s.id} was already ${s.status}.`);
        if (store.digest(s) !== args.digest) throw new Error(`Release set ${s.id} changed after it was proposed. Reject this and ask for a new one.`);
        const checked = await recheck(ctx, null, s);
        const bad = checked.steps.filter(st => st.problem);
        if (bad.length) throw new Error(bad.map(st => st.problem).join(' '));
        const app = checked.app;
        return [`App: ${app.name ? `${app.name} (${app.packageName})` : app.packageName}`, ...(s.why ? [`Why: ${s.why}`] : []), ...checked.steps.map((st, i) => `${i + 1}. ${st.summary}`)];
      },
      // What an always-allow rule can cover: <package>:<track> for each track it changes, <package>:reviews for replies.
      scope(args, ctx) {
        const s = store.load(ctx.dataDir, args.id);
        return s ? scopesOf(s.app, s.changes || []) : [];
      },
      async onReject(args, ctx, note) {
        const s = store.load(ctx.dataDir, args.id);
        if (!s || s.status !== 'waiting') return;
        const done = { ...s, status: 'rejected', decided: new Date().toISOString(), note: String(note || '').trim() || null };
        store.save(ctx.dataDir, done);
        store.appendLog(ctx.dataDir, done);
        changed(ctx);
      },
      async run(args, ctx, meta) {
        const s = store.load(ctx.dataDir, args.id);
        if (!s) throw Object.assign(new Error(`There is no release set ${args.id}.`), { status: 404, code: 'not_found' });
        if (s.status !== 'waiting') throw Object.assign(new Error(`Release set ${s.id} was already ${s.status}.`), { status: 409, code: 'conflict' });
        // The set must be exactly the one the person read: an edit since then is refused.
        if (store.digest(s) !== args.digest) throw Object.assign(new Error(`Release set ${s.id} changed since you read it. Nothing was done. Read it again before approving.`), { status: 409, code: 'conflict' });
        // Checked again against the settings, the bundle file and Play as they are now.
        const checked = await recheck(ctx, meta, s);
        const bad = checked.steps.filter(st => st.problem);
        if (bad.length) throw new SettingsError(`Nothing was done. ${bad.map(st => st.problem).join(' ')}`);
        const r = await applySet(await gp(ctx, meta), checked.app, checked.steps.map(st => st.change));
        const done = { ...s, status: r.status, decided: new Date().toISOString(), results: r.results };
        store.save(ctx.dataDir, done);
        store.appendLog(ctx.dataDir, done);
        ctx.log.info(`Release set ${s.id} for ${s.app}: ${r.status} (${r.results.filter(x => x.ok).length} of ${r.results.length} done).`);
        changed(ctx);
        return { id: s.id, status: r.status, results: r.results };
      }
    }
  },
  async start(ctx) {
    running = ctx;
    state = { verified: null, problem: null, email: null, checking: false };
    countWaiting(ctx);
    if (ctx.workMode()) return;
    state.checking = true;
    // Check the key once in the background; status says what it found.
    (async () => {
      try {
        const play = await clientFor(ctx, { fetchImpl });
        await play.token({ fresh: true });
        state.problem = null;
        state.email = play.email;
        state.verified = new Date().toISOString();
      } catch (e) { state.problem = e && e.message ? e.message : 'Could not check the service account key.'; }
      state.checking = false;
      if (running === ctx) ctx.statusChanged();
    })();
  },
  async stop() { running = null; },
  status() {
    if (!running) return { state: 'stopped', message: null };
    const ctx = running;
    if (ctx.workMode()) return { state: 'error', message: 'Off in work mode. The Google Play connector is for your own computer.' };
    if (state.checking) return { state: 'starting', message: 'Checking the service account key.' };
    const apps = (ctx.config.apps || []).length;
    const details = { waiting, apps, ...(state.email ? { serviceAccount: state.email } : {}) };
    if (state.problem) return { state: 'error', message: state.problem, details };
    if (!apps) return { state: 'error', message: 'Add your first app (its package name) under Apps.', details };
    return { state: 'ready', message: waiting ? `${waiting} release set${waiting === 1 ? '' : 's'} waiting for you.` : null, details };
  }
};

export default connector;

/** The scopes an always-allow rule can name for a set: <package>:<track>, and <package>:reviews for replies. */
export function scopesOf(pkg, changes) {
  const out = new Set();
  for (const c of changes) {
    if (!c || typeof c !== 'object' || typeof c.op !== 'string') continue;
    if (c.op === 'review.reply') out.add(`${pkg}:reviews`);
    else if (typeof c.track === 'string') out.add(`${pkg}:${c.track}`);
    else if (c.op === 'rollout.update') out.add(`${pkg}:production`);
  }
  return [...out].sort();
}

export { OPS, normalize, trackLabel };
