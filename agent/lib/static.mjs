// Static files (docs/agent-api.md, Static files). Serves shell/, shared/, icons/, apps/ and the repo
// root's index.html, manifest.webmanifest and sw.js. Never serves the home folder, connectors/, agent/,
// tests/ or dot files. Paths that try to leave the served folders get 404.
import fs from 'node:fs';
import path from 'node:path';
import { fail } from './http.mjs';

const TOP_DIRS = new Set(['shell', 'shared', 'icons']);
const TOP_FILES = new Set(['index.html', 'manifest.webmanifest', 'sw.js']);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.map': 'application/json; charset=utf-8'
};

const inside = (base, file) => {
  const b = path.resolve(base);
  const f = path.resolve(file);
  return f === b || f.startsWith(b + path.sep);
};

/** Map a URL path to a file on disk, or throw not_found. */
export function resolveStatic(pathname, { root, appsDir }) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { fail('not_found', 'Not found.'); }
  // Backslashes and colons have meaning in Windows paths (separators, drives, alternate data streams).
  if (rel.includes('\0') || rel.includes('\\') || rel.includes(':')) fail('not_found', 'Not found.');
  const parts = rel.split('/').filter(Boolean);
  if (parts.some(s => s === '..' || s.startsWith('.'))) fail('not_found', 'Not found.');
  if (parts.length === 0) parts.push('index.html');
  let base, file;
  if (parts[0] === 'apps' && parts.length >= 2) { base = appsDir; file = path.join(appsDir, ...parts.slice(1)); }
  else if (TOP_DIRS.has(parts[0]) && parts.length >= 2) { base = path.join(root, parts[0]); file = path.join(root, ...parts); }
  else if (TOP_FILES.has(parts[0]) && parts.length === 1) { base = root; file = path.join(root, parts[0]); }
  else fail('not_found', 'Not found.');
  if (!inside(base, file)) fail('not_found', 'Not found.');
  let st;
  try { st = fs.statSync(file); } catch { fail('not_found', 'Not found.'); }
  if (st.isDirectory()) {
    file = path.join(file, 'index.html');
    try { st = fs.statSync(file); } catch { fail('not_found', 'Not found.'); }
  }
  if (!st.isFile()) fail('not_found', 'Not found.');
  // A symbolic link inside a served folder must not lead outside it.
  let real;
  try { real = fs.realpathSync(file); } catch { fail('not_found', 'Not found.'); }
  if (!inside(fs.realpathSync(base), real)) fail('not_found', 'Not found.');
  return { file: real, size: st.size };
}

export function serveStatic(req, res, pathname, dirs) {
  const { file, size } = resolveStatic(pathname, dirs);
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': size,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  });
  if (req.method === 'HEAD') { res.end(); return; }
  const stream = fs.createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
