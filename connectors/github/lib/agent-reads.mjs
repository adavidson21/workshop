// Reads for Tandem's GitHub scripts (README.md, Tools for agents): GitHub REST GETs on issues and pull requests,
// and GraphQL queries, through the connector, so the scripts never need the token. Nothing here can change
// GitHub: REST is GET only on the paths below, and a GraphQL text with a mutation or subscription is refused.

import { SettingsError } from './client.mjs';

// /user, and an issue or pull request with its comments, reviews, files or commits (query: page and per_page only).
const PATHS = [
  /^\/user$/,
  /^\/repos\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}\/(issues|pulls)\/\d{1,9}$/,
  /^\/repos\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}\/issues\/\d{1,9}\/comments$/,
  /^\/repos\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}\/pulls\/\d{1,9}\/(comments|reviews|files|commits)$/
];

/** {path, query} for an allowed GET, or a plain-words error. */
export function checkPath(raw) {
  const s = String(raw || '');
  const [p, q = ''] = s.split('?');
  if (s.length > 300 || p.includes('..') || !PATHS.some(re => re.test(p))) {
    throw new SettingsError(`${p || 'That path'} is not one Workshop reads for agents: /user, or an issue or pull request with its comments, reviews, files or commits.`);
  }
  const query = {};
  for (const [k, v] of new URLSearchParams(q)) {
    if (!['page', 'per_page'].includes(k) || !/^\d{1,4}$/.test(v)) throw new SettingsError('Only page and per_page can be added to the path.');
    query[k] = v;
  }
  return { path: p, query };
}

/** The GraphQL text with strings and comments removed, to look for the operation keywords. */
const bare = q => String(q).replace(/"""[\s\S]*?"""/g, '""').replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/#[^\n]*/g, '');

/** Throws unless the text is only queries (no mutation, no subscription). */
export function checkQuery(q) {
  const s = String(q || '');
  if (!s.trim() || s.length > 20000) throw new SettingsError('Send a GraphQL query of at most 20000 characters.');
  if (/\b(mutation|subscription)\b/i.test(bare(s))) throw new SettingsError('Only queries: Workshop never runs a GraphQL mutation or subscription for agents.');
  return s;
}
