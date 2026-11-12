import { adoFromPaste } from './ado-link.js';
import { drawerId } from './drawer.js';
import { drawer } from './render.js';
import { cleanAdo, commit, findTask } from './state.js';
/* Prioritizer: Pasting an ADO work item link (ADO's "Copy to clipboard", or a work item URL) into an add box or a
   task's title keeps the link on the task, so it opens in ADO. Pasted into notes, the URL is kept in the text. */

const pending = new WeakMap();   // add box -> ADO link from its last paste

function insert(el, text){
  const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? s;
  el.setRangeText(text, s, e, 'end');
  el.dispatchEvent(new Event('input', {bubbles: true}));
}

// The link pasted into an add box, if its text still has the item's number. Clears it, so it is used once.
function takePasted(el){
  const a = el && pending.get(el);
  if (!a) return null;
  pending.delete(el);
  return el.value.includes(String(a.id)) ? a : null;
}

function onPaste(e){
  const el = e.target;
  if (!el || !/^(INPUT|TEXTAREA)$/.test(el.tagName) || (el.type && !/^(text|search)$/.test(el.type) && el.tagName === 'INPUT')) return;
  const cd = e.clipboardData; if (!cd) return;
  const got = adoFromPaste(cd.getData('text/plain'), cd.getData('text/html'));
  if (!got) return;
  const f = el.dataset.f;
  if (f === 'notes' && drawer.contains(el)){
    e.preventDefault();
    insert(el, got.text.startsWith('ADO ') ? got.ado.url : `${got.text} (${got.ado.url})`);
    return;
  }
  e.preventDefault();
  insert(el, got.text);
  if (f === 'title' && drawer.contains(el)){
    const t = findTask(drawerId);
    if (t && !t.ado){ t.ado = cleanAdo(got.ado); commit(); }
    return;
  }
  if (el.id === 'cmdInput' || el.closest('.pform,.qform')) pending.set(el, got.ado);
}

function pasteInit(){ document.addEventListener('paste', onPaste, true); }

export { pasteInit, takePasted };
