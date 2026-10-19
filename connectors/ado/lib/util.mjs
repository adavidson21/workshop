// Small helpers ported from apps/prioritizer/ado-helper/ado_helper.py. They copy Python's behavior on purpose
// (truthiness, int(), quote()) so the connector produces the same JSON as the helper.

/** Python truthiness: None, False, 0, '', empty list and empty dict are false. */
export function truthy(v) {
  if (v === null || v === undefined || v === false || v === 0 || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

/** Python dict.get(key, fallback): returns the stored value even when it is null. */
export function get(obj, key, fallback = null) {
  return obj && typeof obj === 'object' && Object.hasOwn(obj, key) ? obj[key] : fallback;
}

/** Python `a or b or c`. */
export function or(...values) {
  for (const v of values) if (truthy(v)) return v;
  return values[values.length - 1];
}

/** urllib.parse.quote(s) with its default safe characters ("/" and the unreserved set). */
export function pyQuote(s) {
  const bytes = new TextEncoder().encode(String(s));
  let out = '';
  for (const b of bytes) {
    const c = String.fromCharCode(b);
    out += /[A-Za-z0-9_.~/-]/.test(c) ? c : '%' + b.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

/** WIQL string list: 'a', 'b''s'. */
export function wiqlList(values) {
  return values.map(v => "'" + String(v).replaceAll("'", "''") + "'").join(', ');
}

/** Display name of an identity, or the name part of "Name <email>". */
export function person(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v.displayName || v.uniqueName || '';
  return String(truthy(v) ? v : '').split('<')[0].trim();
}

/** Email of an identity, lower case, or ''. */
export function email(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return String(v.uniqueName || '').toLowerCase();
  const s = String(truthy(v) ? v : '');
  const i = s.indexOf('<');
  return i >= 0 ? s.slice(i + 1).replace(/>+$/, '').trim().toLowerCase() : '';
}

export function who(v) {
  return truthy(v) ? { name: person(v), email: email(v) } : null;
}

/** First 10 characters of a date string, or null. */
export function day(v) {
  return typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : null;
}

/** Python int(v), or null where int() would raise. */
export function asInt(v) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!/^[+-]?\d+(_\d+)*$/.test(s)) return null;
    return parseInt(s.replaceAll('_', ''), 10);
  }
  return null;
}

/** Trimmed, de-duplicated, length-limited list of strings. */
export function cleanList(values, limit, size = 300) {
  const out = [];
  for (const raw of Array.isArray(values) ? values : []) {
    const v = Array.from(String(raw).trim()).slice(0, size).join('');
    if (v && !out.includes(v)) out.push(v);
  }
  return out.slice(0, limit);
}

/** Runs fn over items with at most `limit` running at once. Results keep the input order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Python strftime('%Y-%m-%dT%H:%M:%S') of a UTC Date. */
export function isoSeconds(d) {
  return d.toISOString().slice(0, 19);
}
