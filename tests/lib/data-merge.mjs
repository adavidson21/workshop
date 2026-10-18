// Reference implementation of the change-stamp rules in docs/data-format.md. The SDK's data.merge and
// data.stamp (WS4) must give the same results; tests/contract/merge.test.mjs checks this file against
// the examples in docs/examples/.
import { canonical } from './schema.mjs';

const TOMBSTONE_TTL = 60 * 864e5; // 60 days, as in Prioritizer's sanitize()

const withoutStamp = o => { const { updatedAt, ...rest } = o; return canonical(rest); };

/** Merge two envelopes of the same schema and version. Pure: returns a new envelope with remote's rev. */
export function merge(local, remote) {
  if (local.schema !== remote.schema || local.version !== remote.version) {
    throw new Error(`Cannot merge ${local.schema} v${local.version} with ${remote.schema} v${remote.version}. Migrate first.`);
  }
  const deleted = { ...(local.deleted || {}) };
  for (const [id, t] of Object.entries(remote.deleted || {})) deleted[id] = Math.max(deleted[id] ?? 0, t);

  const L = new Map(local.items.map(i => [i.id, i]));
  const R = new Map(remote.items.map(i => [i.id, i]));
  const order = [...remote.items.map(i => i.id), ...local.items.map(i => i.id).filter(id => !R.has(id))];
  const items = [];
  for (const id of order) {
    const a = L.get(id), b = R.get(id);
    const pick = !a ? b : !b ? a : (a.updatedAt > b.updatedAt ? a : b);
    if (id in deleted && deleted[id] >= pick.updatedAt) continue;
    delete deleted[id];
    items.push(structuredClone(pick));
  }

  const out = { schema: remote.schema, version: remote.version, rev: remote.rev };
  if (remote.updatedAt !== undefined) out.updatedAt = remote.updatedAt;
  out.items = items;
  out.deleted = deleted;
  const lm = local.meta, rm = remote.meta;
  const meta = !lm ? rm : !rm ? lm : (lm.updatedAt > rm.updatedAt ? lm : rm);
  if (meta) out.meta = structuredClone(meta);
  return out;
}

/** Stamp what changed between before and after, at time now (ms). Mutates and returns after. */
export function stamp(before, after, now = Date.now()) {
  after.deleted = after.deleted || {};
  const prev = new Map((before?.items || []).map(i => [i.id, withoutStamp(i)]));
  const cur = new Set();
  for (const item of after.items) {
    cur.add(item.id);
    if (prev.get(item.id) !== withoutStamp(item)) {
      item.updatedAt = now;
      delete after.deleted[item.id];
    }
  }
  for (const id of prev.keys()) if (!cur.has(id)) after.deleted[id] = now;
  if (after.meta && (!before?.meta || withoutStamp(before.meta) !== withoutStamp(after.meta))) after.meta.updatedAt = now;
  for (const [id, t] of Object.entries(after.deleted)) if (now - t > TOMBSTONE_TTL) delete after.deleted[id];
  return after;
}
