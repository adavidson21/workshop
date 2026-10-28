/* Receipts: the template summarizer, V1's implementation of the Summarizer interface.

   summarize({person, cycle, entries, metrics, goals, previous, rubric, roles}) -> {markdown, generator}

     person    a config person {id, name, relation, role}
     cycle     {id, name, start, end, due}
     entries   the person's entries in the cycle
     metrics   metrics envelopes for the cycle's months (empty until V1.1 collectors write them)
     goals     goal items (empty until V1.1)
     previous  {cycle, entries, metrics} for the cycle before, or null
     rubric    the config's rubric [{id, name}] (the order of the sections)
     roles     the config's roles [{id, name}], to name the person's role

   The V2 AI summarizer takes the same input and returns the same shape, through a connector.

   Rules: the output depends only on the input (no clock, no randomness), so the same input gives the same
   Markdown byte for byte. Numbers come only from entries and metrics; nothing is estimated or invented. */
import { KINDS, RELATIONS, coverage } from '../model.js';

export const GENERATOR = 'template@1';

const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
const oneLine = s => String(s || '').replace(/\s+/g, ' ').trim();
const kindName = id => (KINDS.find(k => k.id === id) || { name: id }).name;

/** The text of an entry for a summary: its bullet, else the first line of its note. */
export function entryText(e) {
  const b = oneLine(e.bullet);
  if (b) return b;
  const first = String(e.note || '').split(/\r?\n/).find(l => l.trim()) || '';
  return oneLine(first) || '(no text)';
}

/** Sum of each metric over a set of monthly snapshots: {id: {value, unit, months}}. */
export function metricTotals(envelopes) {
  const out = {};
  for (const env of envelopes || []) {
    for (const m of (env && env.items) || []) {
      if (typeof m.value !== 'number' || !Number.isFinite(m.value)) continue;
      const t = out[m.id] || (out[m.id] = { value: 0, unit: m.unit || '', months: 0 });
      t.value += m.value; t.months++;
    }
  }
  return out;
}

const fmt = n => Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);

const KIND_WORDS = { win: ['win', 'wins'], growth: ['growth', 'growth'], concern: ['concern', 'concerns'], feedback: ['feedback', 'feedback'], note: ['note', 'notes'] };
function kindsLine(byKind) {
  return KINDS.filter(k => byKind[k.id]).map(k => { const w = KIND_WORDS[k.id] || [k.id, k.id]; return `${byKind[k.id]} ${byKind[k.id] === 1 ? w[0] : w[1]}`; }).join(', ');
}

export function summarize(input) {
  const { person, cycle, previous = null, rubric = [], roles = [] } = input;
  const entries = [...(input.entries || [])].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const cov = coverage(entries, rubric);
  const name = r => (rubric.find(x => x.id === r) || { name: r }).name;
  const lines = [];

  lines.push(`# ${oneLine(person.name)}: ${oneLine(cycle.name)}`, '');
  const role = (roles.find(r => r.id === person.role) || {}).name;
  const rel = (RELATIONS.find(r => r.id === person.relation) || {}).name;
  lines.push(`${cycle.start} to ${cycle.end}.${rel ? ' ' + rel + '.' : ''}${role ? ' ' + role + '.' : ''}`, '');

  lines.push('## At a glance', '');
  lines.push(`- ${plural(entries.length, 'entry', 'entries')}${entries.length ? ': ' + kindsLine(cov.byKind) : ''}.`);
  lines.push(`- Rubric coverage: ${rubric.length - cov.gaps.length} of ${plural(rubric.length, 'section')}.`);
  lines.push(`- Gaps: ${cov.gaps.length ? cov.gaps.map(name).join(', ') : 'none'}.`);
  if (previous && previous.cycle) {
    const prevCount = (previous.entries || []).length;
    lines.push(`- Compared with ${oneLine(previous.cycle.name)}: ${plural(entries.length, 'entry', 'entries')}, was ${prevCount}.`);
  }
  lines.push('');

  const totals = metricTotals(input.metrics);
  const ids = Object.keys(totals).sort();
  if (ids.length) {
    const before = previous ? metricTotals(previous.metrics) : {};
    lines.push('## Metrics', '');
    for (const id of ids) {
      const t = totals[id], p = before[id];
      const trend = p ? (p.value === t.value ? ', same as last cycle' : `, ${t.value > p.value ? 'up' : 'down'} from ${fmt(p.value)}`) : '';
      lines.push(`- ${id}: ${fmt(t.value)}${t.unit ? ' ' + t.unit : ''} over ${plural(t.months, 'month')}${trend}.`);
    }
    lines.push('');
  }

  const goals = input.goals || [];
  if (goals.length) {
    lines.push('## Goals', '');
    for (const g of [...goals].sort((a, b) => String(a.id).localeCompare(String(b.id)))) lines.push(`- ${oneLine(g.title || g.id)}${g.status ? ` (${oneLine(g.status)})` : ''}`);
    lines.push('');
  }

  const groups = new Map(rubric.map(r => [r.id, []]));
  const unsorted = [];
  for (const e of entries) {
    const primary = (e.rubric || [])[0];
    if (primary && groups.has(primary)) groups.get(primary).push(e); else unsorted.push(e);
  }
  const bullet = e => {
    const tag = e.kind && e.kind !== 'win' ? `${kindName(e.kind)}: ` : '';
    const also = (e.rubric || []).slice(1).filter(r => groups.has(r)).map(name);
    const metric = oneLine(e.metric) ? ` Metric: ${oneLine(e.metric)}.` : '';
    return `- ${tag}${entryText(e)}${metric} (${e.date}${also.length ? '; also ' + also.join(', ') : ''})`;
  };
  for (const r of rubric) {
    const list = groups.get(r.id);
    if (!list.length) continue;
    lines.push(`## ${oneLine(r.name)} (${list.length})`, '', ...list.map(bullet), '');
  }
  if (unsorted.length) lines.push(`## Not yet sorted (${unsorted.length})`, '', ...unsorted.map(bullet), '');

  return { markdown: lines.join('\n').replace(/\n+$/, '\n'), generator: GENERATOR };
}
