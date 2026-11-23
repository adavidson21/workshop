/* The example roadmap offered on an empty list. Generic on purpose, dated from this month so it looks current. */
import { addDays, addMonths, monthEnd, monthStart, today } from './dates.js';
import { formatWhen } from './outline.js';

export function exampleOutline(now = new Date()) {
  const m0 = monthStart(today(now));
  const m = (a, b = a) => formatWhen(addMonths(m0, a), monthEnd(addMonths(m0, b)), { scale: 'month' });
  return `# Example: Platform roadmap
scale: month
start: ${m0}
goal: ${m(0)} | New search index live behind a flag
goal: ${m(1)} | On-call can resolve the top alerts from a runbook

## Search
- Index rebuild | ${m(0, 1)}
  Rebuild the search index on the new schema so ranking can change without downtime.
- New ranking | ${m(2, 3)} | after: Index rebuild
  Rank by freshness and usage. Success: fewer zero-result searches.
- * Ranking live | ${addDays(addMonths(m0, 4), 14)}
  Announce in the team channel.

## Reliability
- Alert cleanup | ${m(0)} | status: done
- On-call runbooks | ${m(1, 2)} | status: active
- Load testing | 2 months | after: On-call runbooks | status: at risk

## Developer experience
- CI speedup | ${m(1, 2)} | color: teal
  Cut the main pipeline from 25 to under 10 minutes.
- Preview builds | ${m(3, 4)} | after: CI speedup | color: teal
- Docs refresh
`;
}

/* Starter templates for New roadmap (Roadmaps UX v1). Each is an outline, so it goes through the same parser as typing.
   Team quarter: this quarter, a goal line per month to fill in, and one lane per product (Settings' products, when
   given) or two placeholder lanes. Project plan: Discovery, Build and Launch phases with a milestone each. */
export const TEMPLATES = [
  { id: 'quarter', name: 'Team quarter', what: 'This quarter, a goal per month, a lane per product.' },
  { id: 'project', name: 'Project plan', what: 'Discovery, build and launch, with milestones.' },
  { id: 'blank', name: 'Blank', what: 'An empty roadmap. Type an outline.' }
];

export function templateOutline(id, { now = new Date(), products = [] } = {}) {
  const m0 = monthStart(today(now));
  const q0 = addMonths(m0, -((Number(m0.slice(5, 7)) - 1) % 3));
  const m = (a, b = a) => formatWhen(addMonths(q0, a), monthEnd(addMonths(q0, b)), { scale: 'month' });
  const p = (a, b = a) => formatWhen(addMonths(m0, a), monthEnd(addMonths(m0, b)), { scale: 'month' });
  if (id === 'quarter') {
    const lanes = (products.length ? products.slice(0, 8) : ['Product one', 'Product two'])
      .map(n => `## ${String(n).replace(/[\r\n#]/g, ' ').trim()}\n- First feature | ${m(0, 1)}\n- Second feature | ${m(1, 2)}\n`).join('\n');
    return `# Team quarter\nscale: month\nstart: ${q0}\ngoal: ${m(0)} | What this month delivers\ngoal: ${m(1)} | What this month delivers\ngoal: ${m(2)} | What this month delivers\n\n${lanes}`;
  }
  if (id === 'project') {
    return `# Project plan\nscale: month\nstart: ${m0}\n\n## Discovery\n- Research and requirements | ${p(0)}\n- * Scope agreed | ${addDays(monthEnd(m0), 0)}\n\n## Build\n- First slice | ${p(1)} | after: Research and requirements\n- Rest of the build | ${p(2)} | after: First slice\n\n## Launch\n- Beta | ${p(3)} | after: Rest of the build\n- * Launch | ${addDays(monthEnd(addMonths(m0, 3)), 0)}\n`;
  }
  return '';
}
