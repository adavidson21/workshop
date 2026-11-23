/* Chat (Chat 4.5.0): answers as they stream. The opencode connector sends the text of the answer part being written
   (chat.text events, connectors/opencode/lib/chat-live.mjs); these put it into the turns Chat last read, so the
   answer grows on screen between reads. Pure, no DOM (test/live.test.mjs). */

/** The turns with the streamed text in place: a part opencode already listed gets the longer text; a part it has not
    listed yet goes at the end of the last answer, or as a new answer after your message. Only while busy. */
export function withLive(turns, live, busy) {
  const list = Array.isArray(turns) ? turns : [];
  if (!live || !live.size) return list;
  const used = new Set();
  const out = list.map(t => {
    if (t.role === 'you' || !Array.isArray(t.parts) || !t.parts.some(p => p.type === 'text' && p.id && live.has(p.id))) return t;
    const parts = t.parts.map(p => {
      if (p.type !== 'text' || !p.id || !live.has(p.id)) return p;
      used.add(p.id);
      const text = live.get(p.id);
      return text.length > String(p.text || '').length ? { ...p, text } : p;
    });
    return { ...t, parts };
  });
  if (!busy) return out;
  const extra = [...live].filter(([id, text]) => !used.has(id) && text).map(([id, text]) => ({ type: 'text', id, text }));
  if (!extra.length) return out;
  const last = out[out.length - 1];
  if (last && last.role !== 'you' && Array.isArray(last.parts)) return out.slice(0, -1).concat({ ...last, parts: last.parts.concat(extra) });
  return out.concat({ id: '', role: 'tandem', text: extra.map(p => p.text).join('\n'), parts: extra });
}

/** After a read: drop what the read already has in full; everything once opencode is idle. */
export function pruneLive(live, turns, busy) {
  if (!live || !busy) return null;
  const have = new Map();
  for (const t of Array.isArray(turns) ? turns : []) for (const p of t.parts || []) if (p.type === 'text' && p.id) have.set(p.id, String(p.text || '').length);
  const next = new Map();
  for (const [id, text] of live) if (!(have.get(id) >= text.length)) next.set(id, text);
  return next.size ? next : null;
}
