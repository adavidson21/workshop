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
