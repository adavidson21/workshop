/* Notes: a note's properties (its frontmatter) as fields, and the edits the Properties panel makes to them.

   Pure: no DOM. Only the frontmatter block changes; the rest of the file stays byte for byte. Values are read
   and written as plain YAML: `key: value`, `key: [a, b]` or a `- item` list under `key:`. Lists (tags, aliases,
   and any key written as a list) are edited as comma-separated text. Keys follow `^[A-Za-z][\w-]*$`. */

const FRONT = /^(﻿?)---[ \t]*\r?\n([\s\S]*?\r?\n)?---[ \t]*(\r?\n|$)/;
const KEY = /^[A-Za-z][\w-]*$/;
/** Keys written as lists even when the value is one item. */
export const LIST_KEYS = ['tags', 'aliases'];
/** Keys Notes owns elsewhere: shown, not edited here (product review fields; templates have their own bar). */
export const READ_ONLY = ['reviewed', 'tandem-changed'];
export const HIDDEN = ['template', 'description'];

const unquote = (s) => String(s).trim().replace(/^(["'])(.*)\1$/, '$2');
const quote = (s) => (/^[\w .,/@+()&-]*$/.test(s) && !/^[\d.]+$/.test(s) && !/^(true|false|null|yes|no)$/i.test(s) && s.trim() === s && !/^[-[{]/.test(s) ? s : JSON.stringify(s));

/** [{key, value: string, list: boolean}] in file order, or [] when the note has no frontmatter. */
export function readProps(text) {
  const m = FRONT.exec(String(text || ''));
  if (!m || !m[2]) return [];
  const lines = m[2].replace(/\r?\n$/, '').split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const key = kv[1], val = kv[2].trim();
    if (val === '') {
      const items = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) items.push(unquote(lines[++i].replace(/^\s*-\s+/, '')));
      out.push({ key, value: items.join(', '), list: items.length > 0 || LIST_KEYS.includes(key.toLowerCase()) });
      continue;
    }
    const inner = /^\[(.*)\]$/.exec(val);
    if (inner) out.push({ key, value: inner[1].split(',').map(unquote).filter(Boolean).join(', '), list: true });
    else out.push({ key, value: unquote(val), list: LIST_KEYS.includes(key.toLowerCase()) });
  }
  return out;
}

/** The YAML line(s) for one property. */
function propLines(key, value, list) {
  if (list) {
    const items = String(value).split(',').map(s => s.trim()).filter(Boolean);
    return [`${key}: [${items.map(quote).join(', ')}]`];
  }
  return [`${key}: ${quote(String(value).replace(/\r?\n/g, ' ').trim())}`];
}

/** Set (or add) a property. Returns the new text, or null for a bad key. */
export function setProp(text, key, value, { list } = {}) {
  if (!KEY.test(key)) return null;
  const src = String(text || '');
  const isList = list ?? (LIST_KEYS.includes(key.toLowerCase()) || (readProps(src).find(p => p.key === key) || {}).list || false);
  const fresh = propLines(key, value, isList);
  const m = FRONT.exec(src);
  if (!m) return `---\n${fresh.join('\n')}\n---\n${src}`;
  const nl = m[0].includes('\r\n') ? '\r\n' : '\n';
  const lines = (m[2] || '').replace(/\r?\n$/, '').split(/\r?\n/).filter((l, k, a) => !(a.length === 1 && l === ''));
  const at = lines.findIndex(l => new RegExp(`^${key}\\s*:`).test(l));
  if (at < 0) lines.push(...fresh);
  else {
    let end = at + 1;
    if (/^[^:]+:\s*$/.test(lines[at])) while (end < lines.length && /^\s*-\s+/.test(lines[end])) end++;
    lines.splice(at, end - at, ...fresh);
  }
  return `${m[1]}---${nl}${lines.join(nl)}${nl}---${m[3] || nl}${src.slice(m[0].length)}`;
}

/** Remove a property; the frontmatter goes when it is left empty. */
export function removeProp(text, key) {
  const src = String(text || '');
  const m = FRONT.exec(src);
  if (!m || !m[2]) return src;
  const nl = m[0].includes('\r\n') ? '\r\n' : '\n';
  const lines = m[2].replace(/\r?\n$/, '').split(/\r?\n/);
  const at = lines.findIndex(l => new RegExp(`^${key}\\s*:`).test(l));
  if (at < 0) return src;
  let end = at + 1;
  if (/^[^:]+:\s*$/.test(lines[at])) while (end < lines.length && /^\s*-\s+/.test(lines[end])) end++;
  lines.splice(at, end - at);
  const rest = src.slice(m[0].length);
  if (!lines.some(l => l.trim())) return `${m[1]}${rest}`;
  return `${m[1]}---${nl}${lines.join(nl)}${nl}---${m[3] || nl}${rest}`;
}

export const validKey = (k) => KEY.test(String(k || ''));
