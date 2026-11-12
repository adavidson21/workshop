/* Notes: product notes, the shared memory Tandem (eng-agents) reads and writes.

   One note per product under products/ (products/<slug>.md). Tandem edits them directly on disk, keeps the text
   it replaces in history/ first (history.js format), and sets `tandem-changed:` in the frontmatter to the time it
   wrote. You mark a note reviewed, which sets `reviewed:`. A note "needs review" while tandem-changed is later
   than reviewed. The lines that changed since your last review are found by comparing the note with the first
   version kept after `reviewed`.

   Times are ISO 8601 (2026-11-05T22:14:00Z); a plain date (2026-11-05) counts as that day's start in UTC.
   Pure: no DOM and no SDK. */
import { frontmatter } from './markdown.js';

export const PRODUCTS = 'products';
export const REVIEWED = 'reviewed';
export const CHANGED = 'tandem-changed';

/** A product note: products/<name>.md, directly in products/. */
export const isProductPath = (p) => typeof p === 'string' && /^products\/[a-z0-9][a-z0-9-]{0,39}\.md$/.test(p);

/** Milliseconds for a review field's text, or null. */
export function timeOf(s) {
  const v = String(s || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) return null;
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
  return Number.isNaN(ms) ? null : ms;
}

/** {changed, reviewed} in ms (or null) from an index entry's `review` (markdown.js facts). */
export function reviewTimes(review) {
  return { changed: timeOf(review && review.tandemChanged), reviewed: timeOf(review && review.reviewed) };
}

/** True when Tandem changed the note after it was last reviewed (or it was never reviewed). */
export function needsReview(review) {
  const { changed, reviewed } = reviewTimes(review);
  return changed !== null && (reviewed === null || changed > reviewed);
}

/** Index entries (model.js buildIndex) that need review, by path. */
export function toReview(index) {
  return [...index.notes.values()].filter(n => needsReview(n.review)).sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** Product notes in the index, by title. */
export function productNotes(index) {
  return [...index.notes.values()].filter(n => isProductPath(n.path)).sort((a, b) => a.title.localeCompare(b.title));
}

/** Seconds-precision UTC ISO time, as Notes and Tandem write it. */
export const isoNow = (ms = Date.now()) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');

/** The note's text with frontmatter `key: value` set (added when missing, frontmatter made when there is none). */
export function setField(text, key, value) {
  const src = String(text || '');
  const m = /^(﻿?)---[ \t]*(\r?\n)([\s\S]*?)(\r?\n)---[ \t]*(?:\r?\n|$)/.exec(src);
  const line = `${key}: ${value}`;
  if (!m) return `---\n${line}\n---\n${src}`;
  const nl = m[2];
  const lines = m[3].split(/\r?\n/);
  const re = new RegExp(`^${key.replace(/[-]/g, '\\-')}\\s*:`, 'i');
  const at = lines.findIndex(l => re.test(l));
  if (at >= 0) lines[at] = line; else lines.push(line);
  const head = `${m[1]}---${nl}${lines.join(nl)}${nl}---${nl}`;
  return head + src.slice(m[0].length);
}

/** Mark reviewed: the text with `reviewed:` set to now. */
export const markReviewed = (text, ms = Date.now()) => setField(text, REVIEWED, isoNow(ms));

/**
 * The version to compare against for highlights: from snapshots newest first ([{path, at}], history.js), the
 * oldest one kept at or after `reviewed`. Never reviewed: the oldest one kept. Returns a snapshot, '' when the
 * whole note is new (no snapshots and never reviewed), or null when there is nothing to compare with.
 */
export function baselineFor(review, snaps) {
  const { reviewed } = reviewTimes(review);
  const after = snaps.filter(s => reviewed === null || s.at >= reviewed);
  if (after.length) return after[after.length - 1];
  return reviewed === null ? '' : null;
}

/**
 * Lines of `now` (0-based, whole file) that are new or changed compared with `before`, leaving out the
 * frontmatter. A line diff by longest common subsequence; long notes fall back to "lines not in before".
 */
export function changedLines(before, now) {
  const a = String(before || '').split(/\r?\n/), b = String(now || '').split(/\r?\n/);
  const skip = frontmatter(now).offset;
  const out = new Set();
  if (a.length * b.length > 4e6) {
    const had = new Set(a);
    b.forEach((l, k) => { if (k >= skip && l.trim() && !had.has(l)) out.add(k); });
    return out;
  }
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0, j = 0;
  while (j < m) {
    if (i < n && a[i] === b[j]) { i++; j++; }
    else if (i < n && dp[i + 1][j] >= dp[i][j + 1]) i++;
    else { if (j >= skip && b[j].trim()) out.add(j); j++; }
  }
  return out;
}

/**
 * Which rendered blocks to highlight: starts are the blocks' first lines (data-line, ascending order not
 * required); a block is marked when any changed line falls from its start up to the next block's start.
 */
export function blocksToMark(starts, changed) {
  const sorted = [...new Set(starts)].sort((x, y) => x - y);
  const marked = new Set();
  sorted.forEach((s, k) => {
    const end = k + 1 < sorted.length ? sorted[k + 1] : Infinity;
    for (const c of changed) if (c >= s && c < end) { marked.add(s); break; }
  });
  return marked;
}

/* The starter product template (templates/product.md). Generic: real product names only ever live in your folder. */
export const PRODUCT_TEMPLATE = '---\ntitle: {{title}}\nalso-called: []\nrepos: []\ntags: [product, product/{{slug}}]\n---\n# {{title}}\n\n## Summary\n\n## Business rules\n\n## Gotchas\n\n## People\n\n## Decisions\n\n## Links\n\n## Remembered\n';
