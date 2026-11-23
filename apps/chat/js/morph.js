/* Chat (Chat 4.5.0): update the page in place instead of replacing it. Chat draws its whole view as one HTML string;
   setting innerHTML on every change rebuilt every node, so while an answer streamed (several times a second) a
   selection in the thread was lost, hover states flickered and pictures were set again. morph() walks the new HTML
   beside the page and changes only what differs: text, attributes, and nodes added or removed. Nodes with the same
   tag (and the same data-keep or id, when they have one) are kept.

   Fields: a textarea or input keeps its node; its value is set only when the new HTML's differs (Chat's drafts follow
   every keystroke, so a difference is Chat changing it, such as clearing the box after a send). Pictures set after
   drawing (data-img-local, data-img-ref) keep their src. */

const keyOf = n => (n.nodeType === 1 ? n.getAttribute('data-keep') || n.id || '' : '');
const same = (a, b) => a.nodeType === b.nodeType && a.nodeName === b.nodeName && keyOf(a) === keyOf(b);

function syncAttrs(f, t) {
  const img = f.nodeName === 'IMG' && (t.hasAttribute('data-img-local') || t.hasAttribute('data-img-ref'));
  for (const a of Array.from(f.attributes)) if (!t.hasAttribute(a.name) && !(img && a.name === 'src')) f.removeAttribute(a.name);
  for (const a of Array.from(t.attributes)) if (f.getAttribute(a.name) !== a.value) f.setAttribute(a.name, a.value);
}

function setValue(f, v) {
  if (f.value === v) return;
  const focused = f.ownerDocument && f.ownerDocument.activeElement === f;
  f.value = v;
  if (focused) try { f.setSelectionRange(v.length, v.length); } catch (e) { /* not a text field */ }
}

function morphNode(f, t) {
  if (f.nodeType !== 1) { if (f.nodeValue !== t.nodeValue) f.nodeValue = t.nodeValue; return; }
  syncAttrs(f, t);
  if (f.nodeName === 'TEXTAREA') { setValue(f, t.value); return; }
  if (f.nodeName === 'INPUT') {
    if (f.type === 'checkbox' || f.type === 'radio') f.checked = t.hasAttribute('checked');
    else setValue(f, t.getAttribute('value') || '');
    return;
  }
  morphChildren(f, t);
}

function morphChildren(from, to) {
  let f = from.firstChild;
  let t = to.firstChild;
  while (t) {
    const next = t.nextSibling;
    if (f && same(f, t)) { morphNode(f, t); f = f.nextSibling; }
    else {
      // A node with the same key further on (a row moved up): bring it here rather than rebuild it.
      const k = keyOf(t);
      let hit = null;
      if (k) for (let n = f; n; n = n.nextSibling) if (same(n, t)) { hit = n; break; }
      if (hit) { from.insertBefore(hit, f); morphNode(hit, t); }
      else from.insertBefore(t, f);
    }
    t = next;
  }
  while (f) { const n = f.nextSibling; from.removeChild(f); f = n; }
}

/** Make `root`'s children match `html`, keeping every node that did not change. */
export function morph(root, html) {
  const tpl = root.ownerDocument.createElement('template');
  tpl.innerHTML = html;
  if (!root.firstChild) { root.appendChild(tpl.content); return; }
  morphChildren(root, tpl.content);
}
