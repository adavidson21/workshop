/* Folio: a map of the open note's links. The note, the notes it links to, the notes that link to it, and the
   links among those, as a Mermaid flowchart (diagrams.js draws it). Pure, so Node tests run it.
   Node n<k> is nodes[k]; diagrams draw node ids as "...-flowchart-n<k>-<k>", which nodeAt() reads back. */

export const MAP_LIMIT = 40;

/** Text that is safe inside a quoted Mermaid label. */
const label = (s) => String(s).replace(/#/g, '#35;').replace(/"/g, '#quot;').replace(/[\r\n]+/g, ' ').slice(0, 60);

/** {code, nodes: [path], more: notes left out over the limit}. index: model.js buildIndex. */
export function noteMap(index, path, limit = MAP_LIMIT) {
  const n = index.notes.get(path);
  if (!n) return null;
  const out = [...new Set((n.links || []).filter(l => !l.image && l.target !== path && index.notes.has(l.target)).map(l => l.target))];
  const back = [...new Set((index.backlinks.get(path) || []).map(b => b.from).filter(p => p !== path && index.notes.has(p)))];
  const all = [path, ...out, ...back.filter(p => !out.includes(p))];
  const nodes = all.slice(0, limit);
  const more = all.length - nodes.length;
  const id = new Map(nodes.map((p, k) => [p, `n${k}`]));
  const lines = ['flowchart LR'];
  nodes.forEach((p, k) => {
    const t = index.notes.get(p).title || p;
    lines.push(k === 0 ? `  n0(["${label(t)}"])` : `  n${k}["${label(t)}"]`);
  });
  const edges = new Set();
  for (const p of nodes) {
    for (const l of index.notes.get(p).links || []) {
      if (l.image || l.target === p || !id.has(l.target)) continue;
      const e = `  ${id.get(p)} --> ${id.get(l.target)}`;
      if (!edges.has(e)) { edges.add(e); lines.push(e); }
    }
  }
  lines.push('  classDef here stroke-width:3px', '  class n0 here');
  return { code: lines.join('\n'), nodes, more };
}

/** The node index from a drawn node's element id, or -1. */
export function nodeAt(elementId) {
  const m = /-flowchart-n(\d+)-\d+$/.exec(String(elementId || ''));
  return m ? Number(m[1]) : -1;
}
