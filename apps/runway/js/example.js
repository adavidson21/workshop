/* The example roadmap offered on an empty list. Generic on purpose, dated from this month so it looks current. */
import { addDays, addMonths, monthEnd, monthStart, today } from './dates.js';
import { formatWhen } from './outline.js';

export function exampleOutline(now = new Date()) {
  const m0 = monthStart(today(now));
  const m = (a, b = a) => formatWhen(addMonths(m0, a), monthEnd(addMonths(m0, b)), { scale: 'month' });
  return `# Example: Platform roadmap
scale: month
start: ${m0}

## Search
- Index rebuild | ${m(0, 1)}
- New ranking | ${m(2, 3)} | after: Index rebuild
- * Ranking live | ${addDays(addMonths(m0, 4), 14)}
  Announce in the team channel.

## Reliability
- Alert cleanup | ${m(0)} | status: done
- On-call runbooks | ${m(1, 2)} | status: active
- Load testing | 2 months | after: On-call runbooks | status: at risk

## Developer experience
- CI speedup | ${m(1, 2)} | color: teal
- Preview builds | ${m(3, 4)} | after: CI speedup | color: teal
- Docs refresh
`;
}
