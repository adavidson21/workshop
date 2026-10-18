// Compares helper output with connector output and reports counts only. Never returns values from
// either side (titles, names, URLs, messages), so the report is safe to share from a work machine.

function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v ?? null);
}

/** Matches two lists by key. Returns {match, differ, onlyHelper, onlyConnector, fields: {name: count}}. */
export function compareLists(helperList, connectorList, keyOf, ignore = []) {
  const r = { match: 0, differ: 0, onlyHelper: 0, onlyConnector: 0, fields: {} };
  const right = new Map();
  for (const x of connectorList || []) {
    const k = keyOf(x);
    if (!right.has(k)) right.set(k, []);
    right.get(k).push(x);
  }
  for (const a of helperList || []) {
    const bucket = right.get(keyOf(a));
    const b = bucket && bucket.shift();
    if (!b) { r.onlyHelper++; continue; }
    const names = new Set([...Object.keys(a), ...Object.keys(b)].filter(n => !ignore.includes(n)));
    const diff = [...names].filter(n => canonical(a[n]) !== canonical(b[n]));
    if (!diff.length) r.match++;
    else {
      r.differ++;
      for (const n of diff) r.fields[n] = (r.fields[n] || 0) + 1;
    }
  }
  for (const bucket of right.values()) r.onlyConnector += bucket.length;
  return r;
}

const ok = r => r.differ === 0 && r.onlyHelper === 0 && r.onlyConnector === 0;

function line(label, r) {
  const parts = [`${r.match} match`, `${r.differ} differ`, `${r.onlyHelper} only in helper`, `${r.onlyConnector} only in connector`];
  const fields = Object.entries(r.fields).sort().map(([n, c]) => `${n} x${c}`).join(', ');
  return `${label}: ${parts.join(', ')}${fields ? ` (fields: ${fields})` : ''}`;
}

/** Both sides of one call: {ok} or {error}. Returns lines and whether everything matched. */
function sides(label, h, c, compare) {
  if (h.error || c.error) {
    if (h.error && c.error) return { lines: [`${label}: both failed (${h.error === c.error ? 'same' : 'different'} message)`], ok: true };
    return { lines: [`${label}: ${h.error ? 'helper' : 'connector'} failed, the other did not`], ok: false };
  }
  return compare(h.ok, c.ok);
}

export function compareSync(h, c) {
  return sides('Sync', h, c, (a, b) => {
    const lines = [];
    let all = true;
    const add = (label, r) => { lines.push(line(label, r)); all &&= ok(r); };
    add('Work items', compareLists(a.items, b.items, x => x.id));
    add('Gone work items', compareLists(a.gone, b.gone, x => x.id));
    if (a.prs && b.prs) {
      add('PRs', compareLists(a.prs.items, b.prs.items, x => x.key));
      add('Gone PRs', compareLists(a.prs.gone, b.prs.gone, x => x.key));
      const hn = (a.prs.notes || []).length;
      const cn = (b.prs.notes || []).length;
      lines.push(`PR notes: ${hn} from helper, ${cn} from connector`);
      all &&= hn === cn;
    } else if (a.prs || b.prs) {
      lines.push('PRs: synced on one side only');
      all = false;
    }
    if (Boolean(a.prError) !== Boolean(b.prError)) {
      lines.push('PR error: on one side only');
      all = false;
    } else if (a.prError) {
      lines.push(`PR error: both (${a.prError === b.prError ? 'same' : 'different'} message)`);
    }
    return { lines, ok: all };
  });
}

export function compareDataset(h, c) {
  return sides('Dataset', h, c, (a, b) => {
    const eventKey = e => `${e.id}|${e.date}|${e.kind}`;
    const items = compareLists(a.items, b.items, x => x.id);
    const events = compareLists(a.events, b.events, eventKey);
    const toList = o => Object.entries(o || {}).map(([k, v]) => ({ k, ...v }));
    const its = compareLists(toList(a.iterations), toList(b.iterations), x => x.k);
    const scalars = ['schema', 'days', 'since', 'base', 'truncated', 'scanned', 'areas', 'people', 'config'];
    const diff = scalars.filter(k => canonical(a[k]) !== canonical(b[k]));
    const lines = [line('Dataset items', items), line('Dataset events', events), line('Dataset iterations', its),
      `Dataset summary fields: ${scalars.length - diff.length} match, ${diff.length} differ${diff.length ? ` (fields: ${diff.join(', ')})` : ''}`];
    return { lines, ok: ok(items) && ok(events) && ok(its) && !diff.length };
  });
}
