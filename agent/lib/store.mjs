// App data in the data folder (docs/data-format.md, Data folder and Disk rules): one JSON file per collection at
// <dataDir>/<app>/<collection>.json (nested names are subfolders), pretty-printed, written atomically. Writes to
// one path run one at a time (the lock is shared with the files API), so the rev check and the write never
// interleave. The disk is the truth: every request reads the file.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { writeJsonAtomic } from './fsutil.mjs';
import { HttpError, fail } from './http.mjs';
import { floorMs, isCollectionText } from './datapath.mjs';

const LIST_READ_MAX = 16 * 1024 * 1024;

export class Store {
  #root; #schemas; #log; #lock; #tracker;

  /**
   * @param {object} o
   * @param {import('./datapath.mjs').DataRoot} o.root  the data folder
   * @param {import('./fsutil.mjs').KeyedLock} o.lock   per-path lock shared with the files API
   * @param {import('./watch.mjs').Tracker} o.tracker   records the agent's own writes and what each path is
   */
  constructor({ root, schemas, log, lock, tracker }) {
    this.#root = root;
    this.#schemas = schemas;
    this.#log = log;
    this.#lock = lock;
    this.#tracker = tracker;
  }

  /** Parse text stored at rel as this collection, or throw 500 (logged). Never changes the file. */
  #parse(rel, text) {
    const [app, ...rest] = rel.slice(0, -5).split('/');
    let env;
    try { env = JSON.parse(text.replace(/^﻿/, '')); } catch { env = undefined; }
    const errs = env === undefined ? ['not valid JSON'] : this.#schemas.validate('data-envelope', env);
    if (errs.length || env.schema !== `${app}.${rest.join('/')}`) {
      this.#log.error(`${rel} cannot be read as a collection. Left untouched.`, { problem: errs[0] || 'schema name does not match its path' });
      fail('internal', `${rel} cannot be read as a collection. Workshop left it untouched; fix or move the file, see the log.`);
    }
    return env;
  }

  /** The stored envelope, or null if nothing is at that path. Anything unreadable as this collection: 500. */
  async #read(rel, file) {
    let text;
    try { text = await fsp.readFile(file, 'utf8'); } catch (e) {
      if (e.code === 'ENOENT') return null;
      this.#log.error(`Could not read ${rel}: ${e.code || e.message}`);
      fail('internal', `Workshop could not read ${rel}.`);
    }
    const env = this.#parse(rel, text);
    this.#tracker.kind(rel, 'collection');
    return env;
  }

  async get(app, collection) {
    const rel = `${app}/${collection}.json`;
    const env = await this.#read(rel, this.#root.inside(rel));
    if (!env) fail('not_found', `${app} has no ${collection} data yet.`);
    return env;
  }

  /** Summaries of every readable collection of one app, nested ones included, sorted by name. */
  async list(app) {
    const out = [];
    for (const { rel, abs, stat } of await this.#root.walk(app)) {
      if (!rel.endsWith('.json') || stat.size > LIST_READ_MAX) continue;
      const full = `${app}/${rel}`;
      let text;
      try { text = await fsp.readFile(abs, 'utf8'); } catch { continue; }
      if (!isCollectionText(full, text)) continue;
      let e;
      try { e = this.#parse(full, text); } catch (err) { if (err instanceof HttpError) continue; throw err; }
      if (typeof e.updatedAt !== 'string' || e.rev < 1) { this.#log.error(`${full} has no rev or updatedAt. Left out of the list.`); continue; }
      this.#tracker.kind(full, 'collection');
      out.push({ collection: rel.slice(0, -5), schema: e.schema, version: e.version, rev: e.rev, updatedAt: e.updatedAt, items: e.items.length });
    }
    return out;
  }

  /**
   * Check and write one envelope (docs/agent-api.md, PUT /api/data). Returns the stored envelope.
   * Throws HttpError bad_request, conflict, downgrade or internal.
   */
  put(app, collection, body) {
    const rel = `${app}/${collection}.json`;
    const file = this.#root.inside(rel);
    const errs = this.#schemas.validate('data-envelope', body);
    if (errs.length) fail('bad_request', `That data does not match the envelope format: ${errs[0]}`);
    if (body.schema !== `${app}.${collection}`) fail('bad_request', `schema must be "${app}.${collection}".`);
    const ids = new Set();
    for (const it of body.items) {
      if (ids.has(it.id)) fail('bad_request', `Item id "${it.id}" appears more than once.`);
      ids.add(it.id);
    }
    return this.#lock.run(rel, async () => {
      const stored = await this.#read(rel, file);
      const rev = stored ? stored.rev : 0;
      if (body.rev !== rev) {
        fail('conflict', 'That collection changed since you loaded it. Reload and try again.',
          { current: stored ?? { schema: body.schema, version: body.version, rev: 0, items: [] } });
      }
      if (stored && body.version < stored.version) {
        fail('downgrade', `This data is version ${stored.version}. A version ${body.version} writer cannot save it. Update Workshop.`);
      }
      if (stored && body.version > stored.version) await this.#backup(rel, file, `.v${stored.version}.json`);
      const next = { schema: body.schema, version: body.version, rev: rev + 1, updatedAt: new Date().toISOString(), items: body.items };
      if (body.deleted !== undefined) next.deleted = body.deleted;
      if (body.meta !== undefined) next.meta = body.meta;
      try {
        await writeJsonAtomic(file, next);
        this.#tracker.own(rel, floorMs(fs.statSync(file)));
      } catch (e) {
        this.#log.error(`Could not write ${rel}: ${e.code || e.message}`);
        fail('internal', `Workshop could not save the ${app} ${collection} data. The previous version is unchanged.`);
      }
      this.#tracker.kind(rel, 'collection');
      return next;
    });
  }

  /**
   * Keep a copy of the stored file at <dataDir>/.backups/<yyyy-mm-dd>/<app>/<collection><suffix> before a version
   * upgrade (docs/data-format.md, Migrations rule 5). An existing copy is never overwritten.
   */
  async #backup(rel, file, suffix) {
    const bak = `.backups/${new Date().toISOString().slice(0, 10)}/${rel.slice(0, -5)}${suffix}`;
    const dest = this.#root.abs(bak);
    try {
      if (!this.#root.contains(dest)) throw Object.assign(new Error('the backups folder leads outside the data folder'), { code: 'EOUTSIDE' });
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.copyFile(file, dest, fs.constants.COPYFILE_EXCL);
    } catch (e) {
      if (e.code === 'EEXIST') return;
      this.#log.error(`Could not keep a copy of ${rel} before a version upgrade: ${e.code || e.message}`);
      fail('internal', `Workshop could not keep a backup of ${rel} before upgrading it, so it did not save. See the log.`);
    }
  }
}
