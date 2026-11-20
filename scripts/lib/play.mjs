// `workshop play`: builds an app's signed bundle on this computer and hands it to the Google Play connector
// (connectors/play/README.md). It runs in the workshop command, in front of the person, never in the agent:
//
//   workshop play build <app> [--bump] [--release <track> ...]   Bubblewrap or Gradle, signed with the password
//                                                                from this computer's secret store
//   workshop play release <app> --track <track> [...]            propose the bundle already built
//
// The signing passwords go to the build program in its environment (BUBBLEWRAP_KEYSTORE_PASSWORD and
// BUBBLEWRAP_KEY_PASSWORD, or ANDROID_KEYSTORE_PASSWORD and ANDROID_KEY_PASSWORD for Gradle), never on a command
// line, in a file or in a log, and never to Tandem. A release is only proposed: you approve it in Workshop.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { appOf, bundlePath, normalize, trackLabel } from '../../connectors/play/lib/releases.mjs';
import { inspectBundle } from '../../connectors/play/lib/aab.mjs';

/** The Bubblewrap CLI version run through npx when bubblewrap is not installed. */
export const BUBBLEWRAP = '@bubblewrap/cli@1.27.0';

export const PLAY_USAGE = `Usage: workshop play <command> <app> [options]

  build <app>                    Build the app's signed bundle in its project folder (Settings, Google Play): Bubblewrap
                                 (bubblewrap build) or Gradle (./gradlew bundleRelease). The signing password comes from
                                 this computer's secret store; save it once with: workshop secret set <name> --password
        [--bump]                 Bubblewrap: raise the version code first (bubblewrap update). Play takes each version
                                 code once.
        [--release <track>]      Then propose it for Google Play, like release below.
  release <app> --track <track>  Propose the bundle already built for a track: internal, alpha (closed testing), beta
                                 (open testing) or production. Nothing goes to Play until you approve it in Workshop
                                 (Settings, Manager, Approvals).
        [--status <s>]           completed (default; Production needs it said), inProgress (a staged rollout) or draft.
        [--fraction <0-1>]       With inProgress: the share of users, like 0.1 for 10%.
        [--notes <text>]         Release notes (English, US).

<app> is the package name or the name you gave it in Settings. With one app it can be left out.`;

const VALUE_FLAGS = ['--release', '--track', '--status', '--fraction', '--notes'];
const mb = n => `${(n / 1048576).toFixed(1)} MB`;

/** A program on PATH, or null. On Windows .cmd and .exe count. */
export function findOnPath(name, { env = process.env, platform = process.platform, exists = fs.existsSync } = {}) {
  const exts = platform === 'win32' ? ['.cmd', '.exe', ''] : [''];
  for (const dir of String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':').filter(Boolean)) {
    for (const ext of exts) { const f = path.join(dir, name + ext); if (exists(f)) return f; }
  }
  return null;
}

/** npx next to the Node running this, else whatever npx is on PATH. */
export function npxPath({ platform = process.platform, exists = fs.existsSync, execPath = process.execPath } = {}) {
  const f = path.join(path.dirname(execPath), platform === 'win32' ? 'npx.cmd' : 'npx');
  return exists(f) ? f : platform === 'win32' ? 'npx.cmd' : 'npx';
}

/**
 * The programs a build runs, in order: [{label, cmd, args, shell}]. The arguments are fixed words; nothing from
 * the settings goes on a command line.
 */
export function buildSteps(kind, folder, { bump = false, platform = process.platform, which = n => findOnPath(n, { platform }), npx = npxPath({ platform }), exists = fs.existsSync } = {}) {
  const shellFor = cmd => platform === 'win32' && /\.cmd$/i.test(cmd);
  if (kind === 'gradle') {
    if (bump) throw new Error('--bump is for Bubblewrap projects. In a Gradle project, raise versionCode in app/build.gradle (or build.gradle.kts).');
    const wrapper = path.join(folder, platform === 'win32' ? 'gradlew.bat' : 'gradlew');
    if (!exists(wrapper)) throw new Error(`There is no ${path.basename(wrapper)} in ${folder}. Open the project in Android Studio once, or point the project folder at the folder that has it.`);
    return [{ label: 'Gradle (bundleRelease)', cmd: wrapper, args: ['bundleRelease'], shell: platform === 'win32' }];
  }
  if (!exists(path.join(folder, 'twa-manifest.json'))) throw new Error(`There is no twa-manifest.json in ${folder}. Make the project first, in that folder: npx ${BUBBLEWRAP} init --manifest=https://<your site>/manifest.webmanifest`);
  const own = which('bubblewrap');
  const [cmd, pre] = own ? [own, []] : [npx, ['--yes', BUBBLEWRAP]];
  return [
    ...(bump ? [{ label: 'Bubblewrap (update: next version code)', cmd, args: [...pre, 'update'], shell: shellFor(cmd) }] : []),
    { label: 'Bubblewrap (build)', cmd, args: [...pre, 'build'], shell: shellFor(cmd) }
  ];
}

/** The upload change from the release options, checked. Null without --release/--track. */
function releaseChange(args, opt, flag) {
  const track = opt(flag);
  if (track === undefined && !args.includes(flag)) return null;
  if (track === undefined || track.startsWith('--')) throw new Error(`${flag} needs a track: internal, alpha, beta or production.`);
  const change = { op: 'release.upload', track };
  if (opt('--status') !== undefined) change.status = opt('--status');
  if (opt('--fraction') !== undefined) change.userFraction = Number(opt('--fraction'));
  if (opt('--notes') !== undefined) change.notes = opt('--notes');
  normalize(change);
  return change;
}

async function propose(app, change, versionName, io, d) {
  const title = `${app.name || app.packageName}${versionName ? ` ${versionName}` : ''} to ${trackLabel(change.track)}`;
  let r;
  try { r = await d.callAgent('POST', '/api/connectors/play/releases.propose', { args: { title, app: app.packageName, changes: [change] } }); }
  catch (e) { io.out(`Not proposed: ${e.message}`); return 1; }
  const res = (r && r.result) || {};
  for (const s of res.steps || []) io.out(`  ${s.summary}`);
  io.out(res.status === 'applied'
    ? 'An always-allow rule covers this, so it went to Google Play. See Settings, Google Play.'
    : 'Proposed. Approve it in Workshop: Settings, Manager, Approvals (Needs you shows it). Nothing goes to Play before that.');
  return 0;
}

/**
 * workshop play build|release. `d`: {config (the Google Play connector's config, or null), userHome, readSecret(name),
 * callAgent(method, path, body), run (spawnSync), platform}.
 */
export async function runPlay(rest, io, d) {
  const [sub, ...args] = rest;
  if (!['build', 'release'].includes(sub)) { io.out(PLAY_USAGE); return sub && !['help', '--help', '-h'].includes(sub) ? 1 : 0; }
  const opt = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const which = args.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(args[i - 1]));
  if (!d.config) { io.out('Google Play is not set up yet. In Workshop, Settings, Google Play: turn it on and add your app.'); return 1; }
  let app, folder, file, change;
  try {
    app = appOf(d.config, which);
    ({ folder, file } = bundlePath(app, { home: d.userHome }));
    change = releaseChange(args, opt, sub === 'build' ? '--release' : '--track');
  } catch (e) { io.out(e.message); return 1; }

  if (sub === 'release') {
    if (!change) { io.out('Say which track: --track internal, alpha, beta or production.'); return 1; }
    if (!fs.existsSync(file)) { io.out(`There is no bundle at ${file}. Build it first: workshop play build ${app.name || app.packageName}`); return 1; }
    const b = await inspectBundle(file);
    return propose(app, change, b.versionName, io, d);
  }

  if (!fs.existsSync(folder)) { io.out(`The project folder ${folder} does not exist. Fix "Project folder" for ${app.packageName} in Settings, Google Play.`); return 1; }
  const suggest = `play-${String(app.name || app.packageName.split('.').pop()).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'app'}`;
  if (!app.signingSecret) { io.out(`Set "Signing password (secret name)" for ${app.packageName} in Settings, Google Play (for example ${suggest}), then save your keystore password with: workshop secret set ${suggest} --password`); return 1; }
  const storePass = await d.readSecret(app.signingSecret);
  if (!storePass) { io.out(`The signing password "${app.signingSecret}" is not saved on this computer. Save it with: workshop secret set ${app.signingSecret} --password`); return 1; }
  let keyPass = storePass;
  if (app.keyPasswordSecret) {
    keyPass = await d.readSecret(app.keyPasswordSecret);
    if (!keyPass) { io.out(`The key password "${app.keyPasswordSecret}" is not saved on this computer. Save it with: workshop secret set ${app.keyPasswordSecret} --password`); return 1; }
  }
  const kind = app.kind || 'bubblewrap';
  let steps;
  try { steps = buildSteps(kind, folder, { bump: args.includes('--bump'), platform: d.platform || process.platform, ...(d.which ? { which: d.which } : {}), ...(d.npx ? { npx: d.npx } : {}), ...(d.exists ? { exists: d.exists } : {}) }); }
  catch (e) { io.out(e.message); return 1; }
  const env = kind === 'gradle' ? { ANDROID_KEYSTORE_PASSWORD: storePass, ANDROID_KEY_PASSWORD: keyPass } : { BUBBLEWRAP_KEYSTORE_PASSWORD: storePass, BUBBLEWRAP_KEY_PASSWORD: keyPass };
  for (const s of steps) {
    io.out(`Running ${s.label} in ${folder}`);
    const r = (d.run || spawnSync)(s.cmd, s.args, { cwd: folder, stdio: 'inherit', env: { ...process.env, ...env }, shell: s.shell });
    if (r && r.error) { io.out(`Could not run ${s.cmd} (${r.error.code || r.error.message}).${kind === 'bubblewrap' ? ' Bubblewrap runs through npx, which comes with Node.' : ''}`); return 1; }
    if (!r || r.status !== 0) { io.out(`${s.label} stopped (exit code ${r ? r.status : 'unknown'}). Nothing was uploaded.`); return 1; }
  }
  if (!fs.existsSync(file)) { io.out(`The build finished, but there is no bundle at ${file}. Check "Bundle file" for ${app.packageName} in Settings, Google Play.`); return 1; }
  const b = await inspectBundle(file);
  io.out(`Built ${file}`);
  io.out(`  ${b.packageName || 'package unknown'}, version code ${b.versionCode ?? 'unknown'}${b.versionName ? ` (${b.versionName})` : ''}, ${mb(b.size)}, SHA-256 ${b.sha256.slice(0, 12)}`);
  if (b.packageName && b.packageName !== app.packageName) { io.out(`This bundle is for ${b.packageName}, not ${app.packageName}. Check the package name and project folder in Settings, Google Play.`); return 1; }
  if (!change) { io.out(`Next: workshop play release ${app.name || app.packageName} --track internal, or ask Tandem to release it. You approve it in Workshop first.`); return 0; }
  return propose(app, change, b.versionName, io, d);
}
