/* Notes: what other apps add to a day's note. Pure: no DOM and no SDK.

   - docketPlan: the lines {{docket}} becomes in the daily template: the day's Today tasks from Docket's summary
     (prioritizer.summary, card `board`, days[day].focus.tasks), or Docket's Up next when Today is empty, each as a
     ws: link to the task. Links, not checkboxes: Docket owns whether a task is done.
   - writeSection: a `## <heading>` section in a note, written by an app (Docket's wrap-up). It replaces the section
     only if it still says exactly what Notes wrote last time (by hash); if you edited it, a new section
     `## <heading> (2)` goes below, so your words are never overwritten.
   - addUnder: a line added under a heading (plan 5: quick capture into today's note). */

const ID = /^[A-Za-z0-9_-]{1,80}$/;
/* Brackets would end the link text early; everything else is safe inside it. */
const linkText = (s) => String(s || '').replace(/\s+/g, ' ').trim().replace(/\[/g, '(').replace(/\]/g, ')').slice(0, 200);

/** {{docket}}'s Markdown for a day, from Docket's summary envelope; '' when there is nothing to show. */
export function docketPlan(env, day) {
  if (!env || env.schema !== 'prioritizer.summary' || !Array.isArray(env.items)) return '';
  const board = env.items.find(c => c && c.id === 'board' && c.kind === 'board');
  if (!board) return '';
  const today = board.days && board.days[day] && board.days[day].focus && Array.isArray(board.days[day].focus.tasks)
    ? board.days[day].focus.tasks.filter(t => t && !t.done) : [];
  const pick = today.length ? today : (Array.isArray(board.upNext) ? board.upNext : []);
  return pick.filter(t => t && typeof t.id === 'string' && ID.test(t.id) && linkText(t.title))
    .slice(0, 10).map(t => `- [${linkText(t.title)}](ws:prioritizer/task/${t.id})`).join('\n');
}

/** A short stable hash (FNV-1a, 32-bit) as base 36, of a section's text with outer blank lines and spaces ignored. */
export function hashText(s) {
  const t = String(s || '').replace(/\r\n?/g, '\n').split('\n').map(l => l.trimEnd()).join('\n').trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
/* [{start, end}] line ranges of each `## heading` section (end exclusive), outside fenced code. */
function sections(lines) {
  const out = [];
  let fence = null, cur = null;
  lines.forEach((l, i) => {
    const f = FENCE.exec(l);
    if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; }
    if (fence && !f) return;
    const m = /^(#{1,2})\s+(.+?)\s*#*\s*$/.exec(l);
    if (!m || fence) return;
    if (cur) { cur.end = i; out.push(cur); cur = null; }
    if (m[1] === '##') cur = { heading: m[2].trim(), start: i };
  });
  if (cur) { cur.end = lines.length; out.push(cur); }
  return out;
}
const bodyOf = (lines, s) => lines.slice(s.start + 1, s.end).join('\n');

/**
 * Write a section. last: {heading, hash} of what Notes wrote before for this note and section, or null.
 * Returns {content, heading, hash}: the heading written and the hash of its body.
 */
export function writeSection(content, heading, body, last = null) {
  const lines = String(content || '').replace(/\r\n?/g, '\n').split('\n');
  const all = sections(lines);
  const text = String(body).replace(/\r\n?/g, '\n').trim();
  const mine = last && all.find(s => s.heading === last.heading);
  if (mine && hashText(bodyOf(lines, mine)) === last.hash) {
    lines.splice(mine.start + 1, mine.end - mine.start - 1, '', ...text.split('\n'), ...(mine.end < lines.length ? [''] : []));
    return { content: lines.join('\n').replace(/\n*$/, '\n'), heading: mine.heading, hash: hashText(text) };
  }
  const taken = new Set(all.map(s => s.heading));
  let h = heading;
  for (let n = 2; taken.has(h); n++) h = `${heading} (${n})`;
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  lines.push('', `## ${h}`, '', ...text.split('\n'));
  return { content: lines.join('\n').replace(/^\n+/, '') + '\n', heading: h, hash: hashText(text) };
}

/**
 * Add a block of Markdown at the end of the `## heading` section, or in a new section at the end when there is
 * none. Used for captures into today's note.
 */
export function addUnder(content, heading, block) {
  const lines = String(content || '').replace(/\r\n?/g, '\n').split('\n');
  const s = sections(lines).find(x => x.heading.toLowerCase() === heading.toLowerCase());
  const add = String(block).replace(/\r\n?/g, '\n').trimEnd().split('\n');
  if (!s) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push('', `## ${heading}`, '', ...add);
    return lines.join('\n').replace(/^\n+/, '') + '\n';
  }
  let end = s.end;
  while (end > s.start + 1 && !lines[end - 1].trim()) end--;
  const blank = end === s.start + 1 ? [''] : [];
  lines.splice(end, 0, ...blank, ...add);
  return lines.join('\n').replace(/\n*$/, '\n');
}
