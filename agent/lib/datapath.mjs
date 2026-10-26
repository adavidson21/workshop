// Names and paths in the data folder (docs/data-format.md, Names and Data folder; docs/agent-api.md, Endpoints).
// Request paths are checked as the client sent them, one segment at a time, before any normalization. A path
// that leads outside the data folder after following symbolic links and junctions is refused.
import fs from 'node:fs';
import path from 'node:path';
import { fail } from './http.mjs';

export const NAME = /^[a-z][a-z0-9-]{0,39}$/;            // app ids
export const SEG = /^[a-z0-9][a-z0-9-]{0,39}$/;          // collection name and file path segments
export const FILE_NAME = /^([a-z0-9][a-z0-9-]{0,39})\.(md|json)$/;
export const MAX_SEGMENTS = 4;
export const FILE_MAX = 10 * 1024 * 1024;

const BAD_PATH = 'That path is not valid. Use names like notes/2026-plan.md, without "..", empty parts or absolute paths.';
const OUTSIDE = 'That path leads outside the data folder.';

/**
 * The path as the client sent it, split into raw (still percent-encoded) segments after "/api/".
 * Handles the absolute request form ("http://host/api/...") too. Never normalizes.
 */
export function rawApiSegments(reqUrl) {
  let p = reqUrl;
  if (!p.startsWith('/')) {
    const m = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*(\/[^?#]*)?/i.exec(p);
    p = m ? (m[1] || '/') : '/';
  }
  p = p.split('?')[0].split('#')[0];
  return p.split('/').slice(2); // drop "" and "api"
}

/** Decode one raw segment. Empty, ".", "..", or anything that decodes to a separator or NUL is refused. */
export function decodeSegment(raw) {
  let d;
  try { d = decodeURIComponent(raw); } catch { fail('bad_request', BAD_PATH); }
  if (!d || d === '.' || d === '..' || /[\\/\0]/.test(d)) fail('bad_request', BAD_PATH);
  return d;
}

export function appId(seg) {
  if (!NAME.test(seg)) fail('bad_request', `"${seg}" is not a valid app name.`);
  return seg;
}

/** A collection name: 1 to 4 segments. */
export function collectionName(segs) {
  if (segs.length < 1 || segs.length > MAX_SEGMENTS) fail('bad_request', 'A collection name has 1 to 4 parts.');
  for (const g of segs) if (!SEG.test(g)) fail('bad_request', `"${g}" is not a valid collection name part.`);
  return segs.join('/');
}

/** A folder for listing files: 0 to 3 segments. */
export function folderName(segs) {
  if (segs.length > MAX_SEGMENTS - 1) fail('bad_request', 'A folder has 1 to 3 parts.');
  for (const g of segs) if (!SEG.test(g)) fail('bad_request', `"${g}" is not a valid folder name.`);
  return segs.join('/');
}

/** A file path: 1 to 4 segments, the last ending in .md or .json. */
export function filePath(segs) {
  if (segs.length < 1 || segs.length > MAX_SEGMENTS) fail('bad_request', 'A file path has 1 to 4 parts.');
  for (const g of segs.slice(0, -1)) if (!SEG.test(g)) fail('bad_request', `"${g}" is not a valid folder name.`);
  const last = segs[segs.length - 1];
  if (!FILE_NAME.test(last)) {
    if (/^[a-z0-9][a-z0-9-]{0,39}\.[^.]+$/.test(last)) fail('bad_request', 'Only .md and .json files are allowed.');
    fail('bad_request', `"${last}" is not a valid file name.`);
  }
  return segs.join('/');
}

/** True if `rel` ("<app>/<path>.<ext>") follows the name rules, so Workshop sees it. */
export function isVisible(rel) {
  const parts = rel.split('/');
  const [app, ...rest] = parts;
  if (!NAME.test(app || '') || rest.length < 1 || rest.length > MAX_SEGMENTS) return false;
  return rest.slice(0, -1).every(g => SEG.test(g)) && FILE_NAME.test(rest[rest.length - 1]);
}

/** True if child is parent or inside it. */
export function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export const lexists = p => { try { fs.lstatSync(p); return true; } catch { return false; } };
export const realpath = p => fs.realpathSync.native(p);
export const floorMs = st => Math.floor(st.mtimeMs);

/** Does this text, stored at rel ("<app>/<path>.json"), mean to be a collection? JSON whose schema is its own name. */
export function isCollectionText(rel, text) {
  if (!rel.endsWith('.json')) return false;
  let v;
  try { v = JSON.parse(text.replace(/^﻿/, '')); } catch { return false; }
  const [app, ...rest] = rel.slice(0, -5).split('/');
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v) && v.schema === `${app}.${rest.join('/')}`;
}

/**
 * The data folder: where it is, where it really is, and the rule that nothing leaves it.
 */
export class DataRoot {
  /** @param {string} dir the data folder, absolute. Must exist. */
  constructor(dir) {
    this.dir = dir;
    this.real = realpath(dir);
  }

  /** Absolute path for a path relative to the data folder ("/"-separated). Does not check links. */
  abs(rel) { return path.join(this.dir, ...rel.split('/')); }

  /** Is this absolute path, after following links, inside the data folder? Missing parts are fine. */
  contains(abs) {
    let p = abs;
    while (!lexists(p)) {
      const up = path.dirname(p);
      if (up === p) return false;
      p = up;
    }
    let real;
    try { real = realpath(p); } catch { return false; } // a dangling link, or no access
    return isInside(real, this.real);
  }

  /** The absolute path for rel, or 400 bad_request if it leads outside the data folder. */
  inside(rel) {
    const abs = this.abs(rel);
    if (!this.contains(abs)) fail('bad_request', OUTSIDE);
    return abs;
  }

  /**
   * Every visible .json and .md file under an app folder (or a folder in it), sorted by path.
   * Returns [{rel: "<path in app>", abs, stat}]. Skips dot names, names that break the rules, anything
   * deeper than 4 segments, and links that lead outside the data folder.
   */
  async walk(app, folder = '') {
    const fsp = fs.promises;
    const out = [];
    const startParts = folder ? folder.split('/') : [];
    const start = path.join(this.dir, app, ...startParts);
    if (!this.contains(start)) return out;
    const visit = async (abs, parts) => {
      let entries;
      try { entries = await fsp.readdir(abs, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const p = path.join(abs, e.name);
        let st, real;
        try { st = await fsp.stat(p); real = await fsp.realpath(p); } catch { continue; }
        if (!isInside(real, this.real)) continue;
        if (st.isDirectory()) {
          if (SEG.test(e.name) && parts.length < MAX_SEGMENTS - 1) await visit(p, [...parts, e.name]);
        } else if (st.isFile() && FILE_NAME.test(e.name)) {
          out.push({ rel: [...parts, e.name].join('/'), abs: p, stat: st });
        }
      }
    };
    await visit(start, startParts);
    return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  }

  /** App folders (names that are app ids), sorted. */
  apps() {
    try {
      return fs.readdirSync(this.dir, { withFileTypes: true })
        .filter(d => NAME.test(d.name) && (d.isDirectory() || d.isSymbolicLink()))
        .map(d => d.name).sort();
    } catch { return []; }
  }
}

/** UTC stamp for trash names: 20261025T140500123Z. */
export const trashStamp = (d = new Date()) => d.toISOString().replace(/[-:.]/g, '');
