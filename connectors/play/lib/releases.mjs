// Release sets: the only way anything changes on Google Play (README.md, Release sets). An agent (or a person)
// writes a list of changes for one app; Workshop checks each one against the settings, pins the exact bundle file
// (its SHA-256) for an upload, and describes it in plain words; nothing happens until a person approves it in
// Workshop. There is no way to delete an app, a track or a bundle, change store listings, prices or users, or
// pick a file outside the app's project folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { SettingsError, PlayError } from './client.mjs';
import { inspectBundle, sha256File } from './aab.mjs';

export const MAX_CHANGES = 6;
export const MAX_BUNDLE = 500 * 1024 * 1024;
export const PACKAGE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
const TRACK = /^[A-Za-z0-9][A-Za-z0-9 _.:-]{0,99}$/;
const REVIEW_ID = /^[A-Za-z0-9_:.-]{1,200}$/;
const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const SHA = /^[0-9a-f]{64}$/;

export const TRACK_LABELS = { internal: 'Internal testing', alpha: 'Closed testing', beta: 'Open testing', production: 'Production' };
export const trackLabel = t => TRACK_LABELS[t] || `the "${t}" track`;

/** Every kind of change, with the words a person sees. */
export const OPS = {
  'release.upload': 'Upload the app\'s bundle and release it on a track',
  'release.promote': 'Release a version already on Play to a track',
  'rollout.update': 'Raise, halt, resume or finish a staged rollout',
  'review.reply': 'Reply to a review'
};

/** Where each kind of project puts its signed bundle, relative to the project folder. */
export const DEFAULT_BUNDLE = { bubblewrap: 'app-release-bundle.aab', gradle: 'app/build/outputs/bundle/release/app-release.aab' };

const bad = msg => { throw new SettingsError(msg); };
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const pct = f => `${+(f * 100).toFixed(2)}%`;
const mb = n => `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
const lowerFirst = s => s.charAt(0).toLowerCase() + s.slice(1);

/** ~ at the start of a folder is your home folder. */
export const expandHome = (p, home = os.homedir()) => (p === '~' ? home : /^~[\\/]/.test(p) ? path.join(home, p.slice(2)) : p);

/** The app in the settings for a package name (or the name you gave it). With one app, it may be left out. */
export function appOf(config, which) {
  const apps = config.apps || [];
  const w = String(which ?? '').trim();
  const names = apps.map(a => a.packageName).join(', ');
  if (!w) {
    if (apps.length === 1) return apps[0];
    bad(apps.length ? `Say which app: ${names}.` : 'No apps are set up yet. Add one (its package name) in Settings, Google Play.');
  }
  const hit = apps.find(a => a.packageName === w) || apps.find(a => a.name && a.name.toLowerCase() === w.toLowerCase());
  if (!hit) bad(`${clip(w, 120)} is not one of your apps in Settings, Google Play${names ? ` (${names})` : ''}.`);
  return hit;
}

/** Where the app's project and bundle are on this computer: {folder, file}, the file inside the folder, an .aab. */
export function bundlePath(app, { home } = {}) {
  if (!app.folder) bad(`Set the project folder for ${app.packageName} in Settings, Google Play, first.`);
  const expanded = expandHome(String(app.folder).trim(), home);
  if (!path.isAbsolute(expanded)) bad(`The project folder for ${app.packageName} must be a full path, like ~/source/repos/wishlist-android.`);
  const folder = path.resolve(expanded);
  const rel = String(app.bundle || DEFAULT_BUNDLE[app.kind] || DEFAULT_BUNDLE.bubblewrap).trim();
  if (path.isAbsolute(rel) || rel.startsWith('~')) bad(`The bundle path for ${app.packageName} must be inside its project folder, like app-release-bundle.aab.`);
  const file = path.resolve(folder, rel);
  const inside = path.relative(folder, file);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) bad(`The bundle path for ${app.packageName} must be inside its project folder.`);
  if (!file.toLowerCase().endsWith('.aab')) bad(`The bundle for ${app.packageName} must be an .aab file.`);
  return { folder, file };
}

function trackOf(t) {
  if (typeof t !== 'string' || !TRACK.test(t.trim())) bad('track is missing or not a track name. Use internal, alpha (closed testing), beta (open testing), production, or a closed testing track\'s name.');
  return t.trim();
}

function fractionOf(f) {
  if (typeof f !== 'number' || !Number.isFinite(f)) bad('userFraction must be a number between 0 and 1, like 0.1 for 10% of users.');
  const r = Math.round(f * 10000) / 10000;
  if (!(r > 0 && r < 1)) bad('userFraction must be more than 0 and less than 1, like 0.1 for 10% of users. For everyone, use status "completed".');
  return r;
}

function notesOf(v) {
  if (v === undefined || v === null || v === '') return undefined;
  let entries;
  if (typeof v === 'string') entries = [['en-US', v]];
  else if (Array.isArray(v)) entries = v.map(n => [n && n.language, n && n.text]); // the stored form
  else if (typeof v === 'object') entries = Object.entries(v);
  else bad('notes must be text (English, US), or {"en-US": "text", "es-ES": "texto"}.');
  if (entries.length > 10) bad('At most 10 languages of release notes.');
  const out = entries.map(([language, text]) => {
    if (!LANG.test(language)) bad(`"${clip(String(language), 20)}" is not a language code like en-US.`);
    if (typeof text !== 'string' || !text.trim()) bad(`The ${language} release notes are empty.`);
    const t = text.trim();
    if (t.length > 500) bad(`The ${language} release notes are ${t.length} characters; Play allows 500.`);
    return { language, text: t };
  });
  return out.length ? out : undefined;
}

function versionCodeOf(v) {
  const n = typeof v === 'string' && /^\d{1,10}$/.test(v) ? Number(v) : v;
  if (!Number.isSafeInteger(n) || n < 1 || n > 2100000000) bad('versionCode must be a whole number, like 12.');
  return n;
}

function releaseOf(change, op) {
  const track = trackOf(change.track);
  if (change.status === undefined && track === 'production') bad('Say how to release to Production: status "completed" (all users), "inProgress" with a userFraction (a staged rollout, like 0.1 for 10%), or "draft".');
  const status = change.status === undefined ? 'completed' : change.status;
  if (!['completed', 'inProgress', 'draft'].includes(status)) bad(`status must be completed, inProgress or draft, not "${clip(String(status), 20)}".`);
  const out = { op, track, status };
  if (status === 'inProgress') {
    if (track === 'internal') bad('Internal testing has no staged rollouts. Use status "completed".');
    out.userFraction = fractionOf(change.userFraction);
  } else if (change.userFraction !== undefined) bad('userFraction goes only with status "inProgress" (a staged rollout).');
  const notes = notesOf(change.notes);
  if (notes) out.notes = notes;
  if (change.name !== undefined && change.name !== null) {
    const n = String(change.name).trim();
    if (n.length > 50) bad('A release name is at most 50 characters.');
    if (n) out.name = n;
  }
  return out;
}

/** A stored bundle pin, checked for shape (what the connector itself wrote at propose time). */
function pinOf(b) {
  if (!b || typeof b !== 'object' || typeof b.file !== 'string' || !SHA.test(String(b.sha256)) || !Number.isSafeInteger(b.size)) bad('The bundle recorded for this upload is damaged. Reject it and ask for a new one.');
  return { file: b.file, sha256: b.sha256, size: b.size, versionCode: Number.isSafeInteger(b.versionCode) ? b.versionCode : null, versionName: typeof b.versionName === 'string' ? b.versionName.slice(0, 100) : null };
}

/**
 * Checks one change and returns it in full form, or throws SettingsError in plain words. With `keepPin` an
 * upload keeps the bundle it recorded (apply and review); without it, any bundle the caller sent is dropped,
 * because only Workshop picks the file.
 */
export function normalize(change, { keepPin = false } = {}) {
  if (!change || typeof change !== 'object' || Array.isArray(change)) bad('Each change must be an object with an op.');
  const op = change.op;
  if (!Object.hasOwn(OPS, op)) bad(`"${clip(String(op), 40)}" is not a change Workshop can make on Google Play. It can: ${Object.keys(OPS).join(', ')}.`);
  switch (op) {
    case 'release.upload': {
      const out = releaseOf(change, op);
      if (keepPin) out.bundle = pinOf(change.bundle);
      return out;
    }
    case 'release.promote': {
      const versionCode = versionCodeOf(change.versionCode);
      return { op, versionCode, ...releaseOf(change, op) };
    }
    case 'rollout.update': {
      const track = change.track === undefined ? 'production' : trackOf(change.track);
      const action = change.action;
      if (!['increase', 'halt', 'resume', 'complete'].includes(action)) bad('action must be increase, halt, resume or complete.');
      const out = { op, track, action };
      if (action === 'increase') out.userFraction = fractionOf(change.userFraction);
      else if (action === 'resume') { if (change.userFraction !== undefined) out.userFraction = fractionOf(change.userFraction); }
      else if (change.userFraction !== undefined) bad(`userFraction does not go with ${action}.`);
      return out;
    }
    case 'review.reply': {
      const reviewId = typeof change.reviewId === 'string' ? change.reviewId.trim() : '';
      if (!REVIEW_ID.test(reviewId)) bad('reviewId must be a review id from reviews.list.');
      const text = typeof change.text === 'string' ? change.text.trim() : '';
      if (!text) bad('The reply is empty.');
      if (text.length > 350) bad(`The reply is ${text.length} characters; Play allows 350.`);
      return { op, reviewId, text };
    }
  }
  return bad('Unknown change.');
}

function releaseSentence(c, subject) {
  const where = trackLabel(c.track);
  if (c.status === 'draft') return `Save ${subject} as a draft release on ${where} (nothing goes out until you send it in Play Console)`;
  if (c.status === 'inProgress') return `Start a staged rollout of ${subject} on ${where} to ${pct(c.userFraction)} of users`;
  return `Release ${subject} to ${c.track === 'production' ? 'Production for all users' : `${where} for everyone on that track`}`;
}
const extras = c => `${c.notes ? ` Release notes: ${c.notes.map(n => `${n.language} "${clip(n.text, 140)}"`).join(', ')}.` : ''}${c.name ? ` Release name "${c.name}".` : ''}`;

/** The change in plain words. `now` is what Play has now (from the preview), when it was read. */
export function describe(c, now = null) {
  switch (c.op) {
    case 'release.upload': {
      const b = c.bundle;
      const what = b ? `${path.basename(b.file)} (${b.versionCode ? `version code ${b.versionCode}` : 'version code unknown'}${b.versionName ? `, version ${b.versionName}` : ''}, ${mb(b.size)}, SHA-256 ${b.sha256.slice(0, 12)})` : 'the app\'s bundle';
      return `Upload ${what}, then ${lowerFirst(releaseSentence(c, 'it'))}.${extras(c)}`;
    }
    case 'release.promote':
      return `${releaseSentence(c, `version code ${c.versionCode}${now && now.where ? ` (now on ${now.where})` : ''}`)}.${extras(c)}`;
    case 'rollout.update': {
      const where = trackLabel(c.track);
      const vc = now && now.versionCodes ? ` of version code ${now.versionCodes.join(', ')}` : '';
      const at = now && typeof now.userFraction === 'number' ? pct(now.userFraction) : null;
      if (c.action === 'increase') return `Raise the ${where} staged rollout${vc}${at ? ` from ${at}` : ''} to ${pct(c.userFraction)} of users.`;
      if (c.action === 'halt') return `Halt the ${where} rollout${vc}${at ? ` at ${at}` : ''}: no one new gets it, and people who have it keep it.`;
      if (c.action === 'resume') return `Resume the halted ${where} rollout${vc} at ${c.userFraction ? pct(c.userFraction) : at || 'the same share'} of users.`;
      return `Finish the ${where} rollout${vc}: all users get it.`;
    }
    case 'review.reply':
      return now && now.author !== undefined
        ? `Reply publicly to the ${now.stars ? `${now.stars}-star ` : ''}review by ${now.author || 'a user'}${now.text ? ` ("${clip(now.text, 100)}")` : ''}: "${c.text}"`
        : `Reply publicly to review ${c.reviewId}: "${c.text}"`;
  }
  return OPS[c.op] || 'A change';
}

/**
 * Checks a set's changes for one app. Returns {app, ok, steps: [{change, summary, problem?}]} with every problem
 * at once (nothing is read from Play or the disk here: see preview).
 */
export function checkSet(changes, config, which, { keepPin = false } = {}) {
  if (!Array.isArray(changes) || !changes.length) bad('A release set needs at least one change.');
  if (changes.length > MAX_CHANGES) bad(`At most ${MAX_CHANGES} changes in one release set.`);
  const app = appOf(config, which);
  const steps = changes.map(c => {
    try { const change = normalize(c, { keepPin }); return { change, summary: describe(change) }; }
    catch (e) { return { change: null, summary: (c && typeof c.op === 'string' && OPS[c.op]) || 'Change', problem: e.message }; }
  });
  const uploads = steps.filter(s => s.change && s.change.op === 'release.upload');
  for (const s of uploads.slice(1)) s.problem = 'Only one upload per release set: an app has one bundle.';
  const tracks = new Set();
  for (const s of steps) {
    if (!s.change || s.problem || s.change.op === 'review.reply') continue;
    if (tracks.has(s.change.track)) s.problem = `Two changes to ${trackLabel(s.change.track)} in one set. Make it one change.`;
    tracks.add(s.change.track);
  }
  return { app, ok: steps.every(s => !s.problem), steps };
}

/** What Play has on each track now: [{track, releases: [{name, versionCodes, status, userFraction, notes}]}]. */
export const tracksOf = r => ((r && r.tracks) || []).map(t => ({
  track: t.track,
  releases: (t.releases || []).map(x => ({ name: x.name || null, versionCodes: (x.versionCodes || []).map(Number), status: x.status || null, ...(typeof x.userFraction === 'number' ? { userFraction: x.userFraction } : {}), notes: (x.releaseNotes || []).map(n => ({ language: n.language, text: n.text })) }))
}));

/**
 * Reads what the checks need (Play's tracks and bundles, the review being answered, the bundle file) and adds
 * problems and the `now` each summary uses. `pin`: record the bundle file as it is now (propose). Otherwise a
 * recorded bundle must still be the same file with the same SHA-256 (review and apply).
 */
export async function preview(play, app, checked, { pin = false, home } = {}) {
  const live = checked.steps.filter(s => s.change && !s.problem);
  const pkg = app.packageName;
  const enc = encodeURIComponent;
  // The bundle on disk.
  for (const s of live.filter(x => x.change.op === 'release.upload')) {
    try {
      const { file } = bundlePath(app, { home });
      if (pin) {
        if (!fs.existsSync(file)) { s.problem = `There is no bundle at ${file} yet. Build it first: workshop play build ${pkg}`; continue; }
        const b = await inspectBundle(file);
        if (b.size > MAX_BUNDLE) { s.problem = `The bundle is ${mb(b.size)}; Workshop uploads bundles up to ${mb(MAX_BUNDLE)}.`; continue; }
        if (b.packageName && b.packageName !== pkg) { s.problem = `The bundle at ${file} is for ${b.packageName}, not ${pkg}.`; continue; }
        s.change.bundle = { file, sha256: b.sha256, size: b.size, versionCode: b.versionCode, versionName: b.versionName };
      } else {
        if (s.change.bundle.file !== file) { s.problem = 'The app\'s bundle setting changed since this was proposed. Reject it and ask for a new one.'; continue; }
        if (!fs.existsSync(file)) { s.problem = `The bundle at ${file} is gone. Reject this, build again, and ask for a new one.`; continue; }
        if (await sha256File(file) !== s.change.bundle.sha256) { s.problem = 'The bundle file changed since this was proposed (it was built again?). Reject this and ask for a new one, so you approve the file that goes out.'; continue; }
      }
      s.summary = describe(s.change);
    } catch (e) { s.problem = e.message; }
  }
  // Play's tracks and bundles, read in an edit that is then thrown away.
  const needPlay = live.filter(x => !x.problem && ['release.upload', 'release.promote', 'rollout.update'].includes(x.change.op));
  if (needPlay.length) {
    const { out } = await play.withEdit(pkg, async (id, base) => ({
      tracks: tracksOf(await play.get(`${base}/tracks`)),
      codes: ((await play.get(`${base}/bundles`)).bundles || []).map(b => Number(b.versionCode))
    }));
    for (const s of needPlay) {
      const c = s.change;
      if (c.op === 'release.upload') {
        if (c.bundle && c.bundle.versionCode && out.codes.includes(c.bundle.versionCode)) s.problem = `Version code ${c.bundle.versionCode} is already on Play. Raise it (Bubblewrap: bubblewrap update), build again, and ask again.`;
      } else if (c.op === 'release.promote') {
        if (!out.codes.includes(c.versionCode)) { s.problem = `Version code ${c.versionCode} is not on Play. Upload it first.`; continue; }
        const where = out.tracks.filter(t => t.releases.some(r => r.versionCodes.includes(c.versionCode))).map(t => trackLabel(t.track));
        s.summary = describe(c, { where: where.join(', ') || null });
      } else if (c.op === 'rollout.update') {
        const t = out.tracks.find(x => x.track === c.track);
        const want = c.action === 'resume' ? 'halted' : 'inProgress';
        const r = t && t.releases.find(x => x.status === want);
        if (!r) { s.problem = c.action === 'resume' ? `There is no halted rollout on ${trackLabel(c.track)} to resume.` : `There is no staged rollout going on ${trackLabel(c.track)}.`; continue; }
        if (c.action === 'increase' && typeof r.userFraction === 'number' && c.userFraction <= r.userFraction) { s.problem = `A staged rollout only goes up: ${trackLabel(c.track)} is at ${pct(r.userFraction)} now.`; continue; }
        s.summary = describe(c, r);
      }
    }
  }
  // The review being answered.
  for (const s of live.filter(x => !x.problem && x.change.op === 'review.reply')) {
    try { s.summary = describe(s.change, reviewOf(await play.get(`/applications/${enc(pkg)}/reviews/${enc(s.change.reviewId)}`))); }
    catch (e) { s.problem = e instanceof PlayError && e.upstream === 404 ? `There is no review ${s.change.reviewId} on Play for ${pkg} (Play keeps reviews with text for about a week).` : e.message; }
  }
  return { app, ok: checked.steps.every(s => !s.problem), steps: checked.steps };
}

/** A review in a small shape. */
export function reviewOf(r) {
  const comments = (r && r.comments) || [];
  const user = (comments.find(c => c.userComment) || {}).userComment || {};
  const dev = (comments.find(c => c.developerComment) || {}).developerComment || null;
  const when = t => (t && t.seconds ? new Date(Number(t.seconds) * 1000).toISOString() : null);
  return {
    reviewId: r && r.reviewId, author: (r && r.authorName) || '', stars: user.starRating || null, text: String(user.text || '').trim(),
    lastModified: when(user.lastModified), versionCode: user.appVersionCode || null, versionName: user.appVersionName || null,
    device: user.device || null, language: user.reviewerLanguage || null,
    reply: dev ? { text: dev.text || '', lastModified: when(dev.lastModified) } : null
  };
}

const releaseBody = (c, versionCodes, extra = {}) => ({
  ...(c.name ? { name: c.name } : {}), versionCodes: versionCodes.map(String), status: c.status,
  ...(c.status === 'inProgress' ? { userFraction: c.userFraction } : {}),
  ...(c.notes ? { releaseNotes: c.notes } : {}), ...extra
});

async function putTrack(play, base, track, release) {
  return play.request('PUT', `${base}/tracks/${encodeURIComponent(track)}`, { body: { track, releases: [release] } });
}

/** One change inside the open edit. Returns a short detail for the results. */
async function editStep(play, base, c, readBundle) {
  if (c.op === 'release.upload') {
    const buf = readBundle(c.bundle.file);
    if (crypto.createHash('sha256').update(buf).digest('hex') !== c.bundle.sha256) throw new PlayError('The bundle file changed since you approved this. Nothing was uploaded.');
    const up = await play.request('POST', `${base}/bundles`, { upload: true, raw: buf, contentType: 'application/octet-stream', query: { uploadType: 'media' } });
    const vc = Number(up && up.versionCode);
    if (!vc) throw new PlayError('Google Play did not say which version code the bundle has.');
    if (up.sha256 && String(up.sha256).toLowerCase() !== c.bundle.sha256) throw new PlayError('Google Play received a different file than the one you approved.');
    await putTrack(play, base, c.track, releaseBody(c, [vc]));
    return { versionCode: vc };
  }
  if (c.op === 'release.promote') {
    let notes = c.notes;
    if (!notes) {
      // Keep the release notes it already has on another track.
      const tracks = tracksOf(await play.get(`${base}/tracks`));
      const from = tracks.flatMap(t => t.releases).find(r => r.versionCodes.includes(c.versionCode) && r.notes.length);
      if (from) notes = from.notes;
    }
    await putTrack(play, base, c.track, releaseBody({ ...c, notes }, [c.versionCode]));
    return { versionCode: c.versionCode };
  }
  if (c.op === 'rollout.update') {
    const t = tracksOf({ tracks: [await play.get(`${base}/tracks/${encodeURIComponent(c.track)}`)] })[0];
    const want = c.action === 'resume' ? 'halted' : 'inProgress';
    const r = t && t.releases.find(x => x.status === want);
    if (!r) throw new PlayError(c.action === 'resume' ? `There is no halted rollout on ${trackLabel(c.track)} anymore.` : `There is no staged rollout going on ${trackLabel(c.track)} anymore.`);
    const status = c.action === 'complete' ? 'completed' : c.action === 'halt' ? 'halted' : 'inProgress';
    const userFraction = c.action === 'complete' ? undefined : c.userFraction ?? r.userFraction;
    await putTrack(play, base, c.track, {
      ...(r.name ? { name: r.name } : {}), versionCodes: r.versionCodes.map(String), status,
      ...(userFraction !== undefined ? { userFraction } : {}), ...(r.notes.length ? { releaseNotes: r.notes } : {})
    });
    return { versionCodes: r.versionCodes };
  }
  throw new PlayError('Unknown change.');
}

/** Commits the edit, never cancelling a review in progress; if Play wants it sent for review by hand, says so. */
async function commitEdit(play, base) {
  const query = { changesInReviewBehavior: 'ERROR_IF_IN_REVIEW' };
  try { await play.request('POST', `${base}:commit`, { query }); return { manual: false }; }
  catch (e) {
    if (!e.needsManualReview) throw e;
    await play.request('POST', `${base}:commit`, { query: { ...query, changesNotSentForReview: 'true' } });
    return { manual: true };
  }
}

/**
 * Makes a set's changes on Play. Track changes go in one edit, which Play takes all at once or not at all; review
 * replies follow, stopping at the first failure. Returns {status: applied|failed, results: [{summary, ok, ...}]}.
 */
export async function applySet(play, app, changes, { readBundle = f => fs.readFileSync(f) } = {}) {
  const results = changes.map(c => ({ summary: describe(c), ok: false }));
  const editOps = changes.map((c, i) => [c, i]).filter(([c]) => c.op !== 'review.reply');
  const replies = changes.map((c, i) => [c, i]).filter(([c]) => c.op === 'review.reply');
  if (editOps.length) {
    let failedAt = null;
    try {
      const r = await play.withEdit(app.packageName, async (id, base) => {
        for (const [c, i] of editOps) {
          try { const d = await editStep(play, base, c, readBundle); Object.assign(results[i], { ok: true }, d); }
          catch (e) { failedAt = i; results[i].error = e.message; throw e; }
        }
      }, { commit: (id, base) => commitEdit(play, base) });
      if (r.commit && r.commit.manual) for (const [, i] of editOps) results[i].note = 'Play wants this sent for review by hand: Play Console, Publishing overview, Send for review.';
    } catch (e) {
      for (const [, i] of editOps) {
        if (failedAt === null) { results[i].ok = false; results[i].error = `Play did not take the changes: ${e.message}`; }
        else if (i !== failedAt) { results[i].ok = false; results[i].skipped = true; results[i].error = 'Not done: Play takes these changes together, and one of them failed.'; }
      }
      for (const [, i] of replies) results[i].skipped = true;
      return { status: 'failed', results };
    }
  }
  for (let k = 0; k < replies.length; k += 1) {
    const [c, i] = replies[k];
    try {
      await play.request('POST', `/applications/${encodeURIComponent(app.packageName)}/reviews/${encodeURIComponent(c.reviewId)}:reply`, { body: { replyText: c.text } });
      results[i].ok = true;
    } catch (e) {
      results[i].error = e.message;
      for (const [, j] of replies.slice(k + 1)) results[j].skipped = true;
      return { status: 'failed', results };
    }
  }
  return { status: 'applied', results };
}

/**
 * A certificate fingerprint as Digital Asset Links writes it (AB:CD:...), from hex (with or without colons) or
 * base64. Null when it is not a SHA-256.
 */
export function fingerprint(v) {
  const s = String(v || '').trim();
  let hex = null;
  if (/^[0-9a-fA-F:]+$/.test(s) && s.replace(/:/g, '').length === 64) hex = s.replace(/:/g, '');
  else { try { const b = Buffer.from(s, 'base64'); if (b.length === 32) hex = b.toString('hex'); } catch { /* not base64 */ } }
  return hex ? hex.toUpperCase().match(/../g).join(':') : null;
}

/** The fingerprints Bubblewrap keeps in the project's twa-manifest.json (your upload key, and any you added). */
export function localFingerprints(folder) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(folder, 'twa-manifest.json'), 'utf8'));
    return [...new Set((j.fingerprints || []).map(f => fingerprint(f && f.value)).filter(Boolean))];
  } catch { return []; }
}

/** The assetlinks.json a site serves so Android opens it as this app (full screen, no address bar). */
export const assetlinks = (pkg, fps) => [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: fps } }];
