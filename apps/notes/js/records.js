/* Notes: other apps' records in the [[ picker (plan 1, claude/notes-plan-1-app-links.md). Pure: no DOM and no SDK.

   The picker lists your notes first and, once you've typed two letters, records from other apps below a thin
   "In other apps" divider: Docket's open tasks (prioritizer.summary, list card `tasks`) and Runway's roadmaps
   (runway.summary, targets card `roadmaps`). Choosing one writes a standard link, [Title](ws:<app>/<route>), which
   renders as a chip (applinks.js). Only titles and routes from the apps' summaries; no app's own data is read. */
import { appLink } from './applinks.js';

export const SOURCES = [
  { app: 'prioritizer', name: 'Docket', card: (c) => c.id === 'tasks' && c.kind === 'list', route: (r) => r.route || `task/${r.id}` },
  { app: 'runway', name: 'Runway', card: (c) => c.id === 'roadmaps' && c.kind === 'targets', route: (r) => r.id }
];
export const MIN_QUERY = 2;
export const MAX_RECORDS = 5;

/** Every record from the summaries: [{app, name, title, href}]. envs: {app id: summary envelope or null}. */
export function recordsFrom(envs) {
  const out = [];
  for (const s of SOURCES) {
    const env = envs && envs[s.app];
    if (!env || env.schema !== `${s.app}.summary` || !Array.isArray(env.items)) continue;
    const card = env.items.find(c => c && s.card(c) && Array.isArray(c.rows));
    if (!card) continue;
    for (const r of card.rows) {
      if (!r || typeof r.id !== 'string' || typeof r.title !== 'string' || !r.title.trim()) continue;
      const href = `ws:${s.app}/${s.route(r)}`;
      if (appLink(href)) out.push({ app: s.app, name: s.name, title: r.title.replace(/\s+/g, ' ').trim().slice(0, 200), href });
    }
  }
  return out;
}

/** The records for a picker query: none under MIN_QUERY letters; titles that start with it first. */
export function matchRecords(records, query) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < MIN_QUERY) return [];
  return records.filter(r => r.title.toLowerCase().includes(q))
    .sort((a, b) => (a.title.toLowerCase().startsWith(q) ? 0 : 1) - (b.title.toLowerCase().startsWith(q) ? 0 : 1) || a.title.localeCompare(b.title))
    .slice(0, MAX_RECORDS);
}

/** The Markdown a chosen record becomes. */
export const recordLink = (r) => `[${r.title.replace(/\[/g, '(').replace(/\]/g, ')')}](${r.href})`;
