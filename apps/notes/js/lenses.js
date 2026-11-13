/* Spike briefs: one findings.md read three ways (eng-agents Core 2.21.0, templates/findings.md).

   A brief has a "Lenses: business, engineering, leadership" line before its first "## " heading, and
   optionally "Default lens: <lens>". Inside a section, "### For <lens>" starts a block that shows only in that
   lens; the block runs to the next heading of level 1 to 3. Everything else shows in every lens, and a
   section left with nothing but its heading is dropped. Same rules as eng-agents' Export-Brief.ps1.

   Pure: used by the preview (main.js) and Download HTML (export.js). */

export const LENSES = ['business', 'engineering', 'leadership'];
const LABEL = { business: 'Business', engineering: 'Engineering', leadership: 'Leadership' };
export const lensLabel = (l) => LABEL[l] || l;

const FOR = /^###\s+For\s+(business|engineering|leadership)\b/i;
const FENCE = /^\s*(```|~~~)/;

/** {lenses, open} for a brief, or null for any other page. open: the Default lens line, else engineering. */
export function briefLenses(text) {
  const head = String(text || '').split(/\r?\n/);
  let lenses = null, def = '';
  for (const line of head) {
    if (/^##\s/.test(line)) break;
    const m = /^Lenses:\s*(.+)$/i.exec(line);
    if (m) lenses = m[1].toLowerCase().split(/[\s,]+/).filter(l => LENSES.includes(l));
    const d = /^Default lens:\s*([a-z]+)/i.exec(line);
    if (d) def = d[1].toLowerCase();
  }
  if (!lenses || !lenses.length) return null;
  lenses = LENSES.filter(l => lenses.includes(l));
  const open = lenses.includes(def) ? def : lenses.includes('engineering') ? 'engineering' : lenses[0];
  return { lenses, open };
}

/** The Markdown as one lens sees it: other lenses' blocks and the "### For" headings left out. */
export function lensMarkdown(text, lens) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  let section = null;     // lines of the current ## section, flushed when it ends
  let block = null;       // the lens of the "### For" block we are in, or null
  let fence = false;
  const flush = () => {
    if (!section) return;
    if (section.slice(1).some(l => l.trim())) out.push(...section);
    section = null;
  };
  for (const line of lines) {
    if (FENCE.test(line)) fence = !fence;
    if (!fence && /^#{1,2}\s/.test(line)) {
      flush(); block = null;
      if (/^##\s/.test(line)) { section = [line]; continue; }
      out.push(line); continue;
    }
    if (!fence) {
      const m = FOR.exec(line);
      if (m) { block = m[1].toLowerCase(); continue; }
      if (block && /^###\s/.test(line)) block = null;
    }
    if (block && block !== lens) continue;
    (section || out).push(line);
  }
  flush();
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}
