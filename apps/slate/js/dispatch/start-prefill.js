/* Start work, filled in (Loom flow cards v1): from a spike's findings (Build it, Fix it, Write it up), and from a
   route (start/<flow>/<text>, Chat's flow suggestions). Also the line a closed spike keeps. No DOM: tested in Node. */

/** The drafts for a flow's form, from a title and optional findings text. Keys are the form's draft names. */
export function prefillFor(flow, it, findings) {
  const title = String((it && it.title) || '').trim();
  const from = it && it.folder ? `From .work/${it.folder}/findings.md:\n\n` : '';
  const body = findings ? from + findings : (it && it.summary) || '';
  switch (flow) {
    case 'feature':
    case 'bug':
      return { title: title.slice(0, 200), desc: [it && it.summary && findings ? it.summary : '', body].filter(Boolean).join('\n\n').slice(0, 8000) };
    case 'request':
    case 'handoff':
      return { title: title.slice(0, 255), ...(body ? { desc: body.slice(0, 8000) } : {}) };
    case 'spike': return { topic: title.slice(0, 500) };
    case 'epic': return { idea: [title, body].filter(Boolean).join('\n\n').slice(0, 4000) };
    case 'docs': return { target: title.slice(0, 500) };
    default: return title ? { title: title.slice(0, 200) } : {};
  }
}

const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** closed.md's line for a spike that work was started from: "Closed: started L12 as a feature on 2026-11-16." */
export function closedLine(r, res, now = new Date()) {
  const a = (r && r.args) || {};
  const what = r && r.action === 'docs.start' ? 'docs' : r && r.action === 'tsd.start' ? 'a technical spec' : a.lane === 'bug' ? 'a bug fix' : a.lane === 'quick' ? 'a small change' : 'a feature';
  const id = (res && res.id) || a.id || '';
  return `Closed: started ${id ? id + ' as ' : ''}${what} on ${today(now)}.`;
}
/** closed.md's line for the other ways out of the findings. */
export const closedWith = (how, now = new Date()) => `Closed: ${how} on ${today(now)}.`;

/** decodeURIComponent that never throws (a route typed by hand). */
export function safeDecode(s) { try { return decodeURIComponent(s); } catch { return String(s); } }

/** True when text looks like an error log or stack trace rather than a sentence: several lines with an exception,
 *  stack frames, or timestamped error lines. */
export function looksLikeLog(text) {
  const t = String(text || '');
  const lines = t.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return /\b[A-Z][A-Za-z.]*(Exception|Error)\s*:/.test(t) && t.length > 60;
  const frames = lines.filter(l => /^\s*(at |File "|#\d+ |\s+at\s)/.test(l)).length;
  const errs = lines.filter(l => /\b(ERROR|FATAL|CRITICAL|Exception|Traceback|panic:)\b/.test(l)).length;
  return frames >= 1 || errs >= 2 || (errs >= 1 && /\d{2}:\d{2}:\d{2}/.test(t));
}
