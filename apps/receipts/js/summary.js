/* Receipts: review summaries as Markdown files (ws.files) with a sidecar collection each (ws.data).

   Layout, inside the receipts folder of the Workshop folder:
     summaries/<person>/<cycle>.md       version 1, the file you read and edit
     summaries/<person>/<cycle>.json     its sidecar collection, schema receipts.summaries/<person>/<cycle>
     summaries/<person>/<cycle>-v2.md    version 2, written beside version 1 when version 1 was edited
     summaries/<person>/<cycle>-v2.json  and so on

   The sidecar has one item, id "summary": {cycleId, generator, generatedAt, inputHash, outputHash, edited, file}.
   outputHash is the SHA-256 of the Markdown as generated; a file whose content no longer matches it was
   edited, by you in Receipts or by another program.

   Regenerate never overwrites an edited file. It replaces the latest version only when that version is
   exactly as generated (and does nothing when the new Markdown is the same); otherwise it writes the next
   version beside it. */
import { emptyEnvelope, summaryBase, summaryFile } from './model.js';

export const SIDECAR_ID = 'summary';

/** Stable JSON with sorted keys, so the same input always hashes the same. */
export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}

/** SHA-256 of a string, as `sha256:<hex>`. Web Crypto, in the browser and in Node 22. */
export async function sha256(text) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return 'sha256:' + [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** The summary versions for a person and cycle, from a files listing, oldest first: [{version, path}]. */
export function versionsFrom(listing, personId, cycleId) {
  const re = new RegExp(`^summaries/${personId}/${cycleId.replace(/[-]/g, '\\-')}(?:-v(\\d+))?\\.md$`);
  return listing.map(f => { const m = re.exec(f.path); return m ? { version: m[1] ? Number(m[1]) : 1, path: f.path, mtime: f.mtime } : null; })
    .filter(v => v && v.version >= 1).sort((a, b) => a.version - b.version);
}

/** Reads one version: {path, version, content, mtime, sidecar, edited} or null if the file is gone. */
export async function readVersion({ files, store }, personId, cycleId, version) {
  const path = summaryFile(personId, cycleId, version);
  const file = await files.read(path);
  if (!file) return null;
  const env = await store.ensure(summaryBase(personId, cycleId, version));
  const sidecar = env && env.items.find(i => i.id === SIDECAR_ID) || null;
  const edited = !sidecar || (await sha256(file.content)) !== sidecar.outputHash;
  return { path, version, content: file.content, mtime: file.mtime, sidecar, edited };
}

/** Writes the sidecar for a version (creating or replacing its one item). */
function putSidecar(store, personId, cycleId, version, fields) {
  const col = summaryBase(personId, cycleId, version);
  return store.update(col, env => {
    const old = env.items.find(i => i.id === SIDECAR_ID) || {};
    env.items = [{ ...old, id: SIDECAR_ID, ...fields }];
    return env;
  }, () => emptyEnvelope(col));
}

/**
 * Generates a summary and saves it, following the rules above.
 * @param {object} o
 * @param {object} o.files     ws.files
 * @param {object} o.store     the collection store (store.js)
 * @param {object} o.input     the summarizer input
 * @param {Function} o.summarize   the summarizer (template.js now, AI in V2)
 * @param {string} [o.now]     ISO time for generatedAt
 * @returns {Promise<{action: 'created'|'replaced'|'unchanged'|'new-version', version: number, path: string}>}
 */
export async function generate({ files, store, input, summarize, now = new Date().toISOString() }) {
  const personId = input.person.id, cycleId = input.cycle.id;
  const { markdown, generator } = summarize(input);
  const [inputHash, outputHash] = await Promise.all([sha256(canonical(input)), sha256(markdown)]);
  const versions = versionsFrom(await files.list(`summaries/${personId}`), personId, cycleId);
  const latest = versions.length ? await readVersion({ files, store }, personId, cycleId, versions[versions.length - 1].version) : null;
  const meta = { cycleId, generator, generatedAt: now, inputHash, outputHash, edited: false };

  if (!latest) {
    const path = summaryFile(personId, cycleId, 1);
    await files.write(path, markdown, { create: true });
    await putSidecar(store, personId, cycleId, 1, { ...meta, file: path });
    return { action: 'created', version: 1, path };
  }
  if (!latest.edited) {
    if (latest.content === markdown) return { action: 'unchanged', version: latest.version, path: latest.path };
    await files.write(latest.path, markdown, { mtime: latest.mtime });
    await putSidecar(store, personId, cycleId, latest.version, { ...meta, file: latest.path });
    return { action: 'replaced', version: latest.version, path: latest.path };
  }
  // The latest version was edited: keep it, mark it, and write the next version beside it.
  if (latest.sidecar && !latest.sidecar.edited) await putSidecar(store, personId, cycleId, latest.version, { edited: true });
  const version = versions[versions.length - 1].version + 1;
  const path = summaryFile(personId, cycleId, version);
  await files.write(path, markdown, { create: true });
  await putSidecar(store, personId, cycleId, version, { ...meta, file: path });
  return { action: 'new-version', version, path };
}

/** Saves your edit of a version. Rejects with code `conflict` (err.current) if the file changed meanwhile. */
export async function saveEdit({ files, store }, personId, cycleId, version, content, mtime) {
  const path = summaryFile(personId, cycleId, version);
  const r = await files.write(path, content, { mtime });
  const env = store.get(summaryBase(personId, cycleId, version));
  const sidecar = env && env.items.find(i => i.id === SIDECAR_ID);
  const edited = !sidecar || (await sha256(content)) !== sidecar.outputHash;
  if (sidecar && sidecar.edited !== edited) await putSidecar(store, personId, cycleId, version, { edited });
  return { ...r, edited };
}
