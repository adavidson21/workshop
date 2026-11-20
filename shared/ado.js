/* Azure DevOps on or off, for every app (docs/shared.md, With no Azure DevOps).

   With the ADO connector switched off, not installed, or in browser mode (no connectors at all), Workshop says
   nothing about Azure DevOps: no ADO buttons, chips, hints or sentences. The one place it stays is Settings'
   All connections page, where its switch is, so it can be turned back on.

   Exports:
     watchAdo(ws, onChange?)  Finds out once and again whenever the ADO connector changes. Sets
                              <html data-ado="on|off"> and calls onChange(on). Resolves the first answer (true when on).
     adoIsOn()                The last answer (false until watchAdo has answered).
     noAdo(text)              The text without the sentences (or list items) that mention ADO, while ADO is off.
                              The text as it is while ADO is on. For plain text that mixes ADO and other words.
     ADO_WORDS                The pattern for a mention: "ADO" or "Azure DevOps".
     setAdo(on)               Sets the answer by hand (unit tests, and pages with no SDK connection).

   In markup, mark what only makes sense with ADO with data-ado-only (hidden while off) and what only makes sense
   without it with data-no-ado (hidden while on). The rules are in shared/ui.css. */

export const ADO_WORDS = /\bADO\b|Azure DevOps/;

let on = false;
const root = () => (typeof document !== 'undefined' ? document.documentElement : null);
function paint(v) { const r = root(); if (r) r.dataset.ado = v ? 'on' : 'off'; }
paint(false);

export const adoIsOn = () => on;
export function setAdo(v) { on = !!v; paint(on); }

async function ask(ws) {
  try {
    const c = (await ws.connectors.list()).find(x => x.id === 'ado');
    return !!(c && c.enabled);
  } catch (e) { return false; }
}

export async function watchAdo(ws, onChange) {
  const set = v => { const changed = v !== on; on = v; paint(v); if (changed && onChange) onChange(v); };
  on = await ask(ws);
  paint(on);
  if (onChange) onChange(on);
  try { ws.connectors.onStatus('ado', () => ask(ws).then(set)); } catch (e) { /* browser mode: never changes */ }
  return on;
}

/** Split into sentences, keeping each one's end. A list item or line counts as its own sentence. */
function sentences(text) {
  return String(text).match(/[^.!?\n]+(?:[.!?]+(?=\s|$)|\n|$)\s*/g) || [];
}

export function noAdo(text, adoOn = on) {
  if (adoOn || text == null) return text;
  const s = String(text);
  if (!ADO_WORDS.test(s)) return s;
  return sentences(s).filter(x => !ADO_WORDS.test(x)).join('').trim();
}
