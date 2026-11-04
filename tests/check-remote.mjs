#!/usr/bin/env node
// Checks Workshop against the apps it shows from other sites (apps/remote.json), using a checkout of each
// app's repo in .remote/<id>/ (CI makes one from the repo named in remote.json):
//
//   - Home reads Docket's tasks: the prioritizer.tasks version Docket writes must be the one Home reads
//     (apps/home/js/view.js, TASKS_VERSION). A mismatch fails: Home would show "can't read your tasks".
//   - Docket's copies of Workshop's shared files (its workshop-files.json) should match this branch, or Docket
//     inside Workshop runs an SDK or theme that differs from the shell's. Docket can only copy them after they
//     merge here, so this warns, with the command to run in Docket's repo afterwards.
//   - The manifest snapshot in remote.json should match the app's app.json. The Worker serves the live one,
//     so a stale snapshot only warns; refresh it with node shell/registry.mjs --refresh-remote.
//
// An app with no checkout is skipped. Exit 1 on a failure. Node 22, no dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const remoteFile = path.join(root, 'apps', 'remote.json');
const remote = fs.existsSync(remoteFile) ? JSON.parse(fs.readFileSync(remoteFile, 'utf8')).apps : [];
const errors = [], warnings = [], checked = [];
const sha = f => createHash('sha256').update(fs.readFileSync(f)).digest('hex');

for (const app of remote) {
  const dir = path.join(root, '.remote', app.id);
  if (!fs.existsSync(path.join(dir, 'app.json'))) { warnings.push(`${app.id}: no checkout in .remote/${app.id}/, skipped (git clone https://github.com/${app.repo} .remote/${app.id})`); continue; }
  checked.push(app.id);

  const live = JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8'));
  if (JSON.stringify(live) !== JSON.stringify(app.manifest)) warnings.push(`${app.id}: the manifest snapshot in apps/remote.json is older than ${app.repo}'s app.json. Run: node shell/registry.mjs --refresh-remote`);

  const copies = path.join(dir, 'workshop-files.json');
  if (fs.existsSync(copies)) {
    const list = JSON.parse(fs.readFileSync(copies, 'utf8'));
    const differ = Object.entries(list.files).filter(([theirs, ours]) => {
      const a = path.join(dir, theirs), b = path.join(root, ours);
      return fs.existsSync(b) && (!fs.existsSync(a) || sha(a) !== sha(b));
    }).map(([, ours]) => ours);
    if (differ.length) warnings.push(`${app.id}: its copies of these Workshop files differ from this branch: ${differ.join(', ')}. After merging here, run in ${app.repo}: node scripts/sync-workshop.mjs --update`);
  }

  if (app.id === 'prioritizer') {
    const fmt = fs.readFileSync(path.join(dir, 'js', 'store-format.js'), 'utf8');
    const writes = Number((fmt.match(/VERSIONS\s*=\s*\{[^}]*\btasks:\s*(\d+)/) || [])[1]);
    const view = fs.readFileSync(path.join(root, 'apps', 'home', 'js', 'view.js'), 'utf8');
    const reads = Number((view.match(/TASKS_VERSION\s*=\s*(\d+)/) || [])[1]);
    if (!writes || !reads) errors.push('prioritizer: could not find the tasks version in Docket\'s js/store-format.js or Home\'s js/view.js');
    else if (writes !== reads) errors.push(`prioritizer: Docket writes prioritizer.tasks version ${writes}, Home reads version ${reads}. Update Home (apps/home/js/view.js) for the new version.`);
  }
}

for (const w of warnings) console.warn('warning: ' + w);
if (errors.length) { console.error('Remote app checks failed:\n- ' + errors.join('\n- ')); process.exit(1); }
console.log(`remote ok: ${checked.length ? checked.join(', ') : 'nothing checked'}`);
