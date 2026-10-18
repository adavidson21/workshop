// App data on disk (docs/data-format.md, Disk rules): one JSON file per collection at
// <home>/data/<app>/<collection>.json, pretty-printed, written atomically. Writes to one collection run one
// at a time, so the rev check and the write never interleave.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { writeJsonAtomic, KeyedLock } from './fsutil.mjs';
import { HttpError, fail } from './http.mjs';

const FILE = /^([a-z][a-z0-9-]{0,39})\.json$/;

export class Store {
  #dir; #schemas; #log; #lock = new KeyedLock();

  constructor({ dir, schemas, log }) {
    this.#dir = dir;
    this.#schemas = schemas;
    this.#log = log;
  }

  #file(app, collection) { return path.join(this.#dir, app, `${collection}.json`); }

  /** The stored envelope, or null if the collection was never written. Unreadable files: 500, never touched. */
  async #read(app, collection) {
    const file = this.#file(app, collection);
    let text;
    try { text = await fsp.readFile(file, 'utf8'); } catch (e) {
      if (e.code === 'ENOENT') return null;
      this.#log.error(`Could not read data/${app}/${collection}.json: ${e.code || e.message}`);
      fail('internal', `Workshop could not read the ${app} ${collection} data file.`);
    }
    let env;
    try { env = JSON.parse(text.replace(/^﻿/, '')); } catch {
      this.#log.error(`data/${app}/${collection}.json is not valid JSON. Left untouched.`);
      fail('internal', `The ${app} ${collection} data file is damaged. Workshop left it untouched; see the log.`);
    }
    const errs = this.#schemas.validate('data-envelope', env);
    if (errs.length || env.schema !== `${app}.${collection}`) {
      this.#log.error(`data/${app}/${collection}.json does not match the envelope format. Left untouched.`, { problem: errs[0] || 'schema name does not match its path' });
      fail('internal', `The ${app} ${collection} data file is not in the expected format. Workshop left it untouched; see the log.`);
    }
    return env;
  }

  async get(app, collection) {
    const env = await this.#read(app, collection);
    if (!env) fail('not_found', `${app} has no ${collection} data yet.`);
    return env;
  }

  /** Summaries of every readable collection of one app, sorted by name. */
  async list(app) {
    let names = [];
    try { names = (await fsp.readdir(path.join(this.#dir, app))).map(n => FILE.exec(n)?.[1]).filter(Boolean); } catch { /* no data yet */ }
    const out = [];
    for (const collection of names.sort()) {
      try {
        const e = await this.#read(app, collection);
        if (e) out.push({ collection, schema: e.schema, version: e.version, rev: e.rev, updatedAt: e.updatedAt, items: e.items.length });
      } catch (e) { if (!(e instanceof HttpError)) throw e; /* logged by #read; left out of the list */ }
    }
    return out;
  }

  /**
   * Check and write one envelope (docs/agent-api.md, PUT /api/data). Returns the stored envelope.
   * Throws HttpError bad_request, conflict, downgrade or internal.
   */
  put(app, collection, body) {
    const errs = this.#schemas.validate('data-envelope', body);
    if (errs.length) fail('bad_request', `That data does not match the envelope format: ${errs[0]}`);
    if (body.schema !== `${app}.${collection}`) fail('bad_request', `schema must be "${app}.${collection}".`);
    const ids = new Set();
    for (const it of body.items) {
      if (ids.has(it.id)) fail('bad_request', `Item id "${it.id}" appears more than once.`);
      ids.add(it.id);
    }
    return this.#lock.run(`${app}/${collection}`, async () => {
      const stored = await this.#read(app, collection);
      const rev = stored ? stored.rev : 0;
      if (body.rev !== rev) {
        fail('conflict', 'That collection changed since you loaded it. Reload and try again.',
          { current: stored ?? { schema: body.schema, version: body.version, rev: 0, items: [] } });
      }
      if (stored && body.version < stored.version) {
        fail('downgrade', `This data is version ${stored.version}. A version ${body.version} writer cannot save it. Update Workshop.`);
      }
      const file = this.#file(app, collection);
      if (stored && body.version > stored.version) {
        const backup = path.join(this.#dir, app, `${collection}.v${stored.version}.json`);
        if (!fs.existsSync(backup)) await fsp.copyFile(file, backup);
      }
      const next = { schema: body.schema, version: body.version, rev: rev + 1, updatedAt: new Date().toISOString(), items: body.items };
      if (body.deleted !== undefined) next.deleted = body.deleted;
      if (body.meta !== undefined) next.meta = body.meta;
      try { await writeJsonAtomic(file, next); } catch (e) {
        this.#log.error(`Could not write data/${app}/${collection}.json: ${e.code || e.message}`);
        fail('internal', `Workshop could not save the ${app} ${collection} data. The previous version is unchanged.`);
      }
      return next;
    });
  }
}
