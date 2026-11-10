import test from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEMS, outsideMark, outsideBanner, outsideConfirmHtml, confirmOutside, addOutsideStyles, CSS } from '../outside.js';

test('the mark names the system for sight and screen readers', () => {
  const ado = outsideMark('ado');
  assert.match(ado, /class="out-mark"/);
  assert.match(ado, /data-out="ado"/);
  assert.match(ado, />ADO</);
  assert.match(ado, /changes Azure DevOps/);
  const git = outsideMark('git');
  assert.match(git, /data-out="git"/);
  assert.match(git, />git</);
  assert.match(git, /changes the git remote/);
});

test('an unknown system falls back to ADO, never to no mark', () => {
  assert.match(outsideMark('nope'), /data-out="ado"/);
  assert.match(outsideBanner('nope'), /Changes Azure DevOps\./);
});

test('the banner says what changes and escapes its text', () => {
  const b = outsideBanner('ado', 'Assigns #1 to <b>Sam</b>.');
  assert.match(b, /<strong>Changes Azure DevOps\.<\/strong>/);
  assert.match(b, /&lt;b&gt;Sam&lt;\/b&gt;/);
  assert.doesNotMatch(b, /<b>Sam/);
});

test('the confirm has the banner, the items, Cancel, and a marked send button', () => {
  const html = outsideConfirmHtml({ system: 'ado', title: 'Close #5?', body: 'Line one\nLine two', items: ['#5 <script>x</script>', '', null], ok: 'Close it', cls: 'dlg' });
  assert.match(html, /class="out-confirm dlg"/);
  assert.match(html, /<h2>Close #5\?<\/h2>/);
  assert.match(html, /out-banner/);
  assert.match(html, /Line one\nLine two/);
  assert.equal((html.match(/<li>/g) || []).length, 1, 'blank items are left out');
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /type="button" class="btn" data-act="cancel"/);
  assert.match(html, /type="submit" class="btn primary" value="ok" data-out-ok>Close it <span class="out-mark" data-out="ado"/);
});

test('the confirm has a default title for each system', () => {
  assert.match(outsideConfirmHtml({ system: 'git' }), /<h2>Change the git remote\?<\/h2>/);
});

test('every system has a short and a long name', () => {
  for (const [k, s] of Object.entries(SYSTEMS)) {
    assert.ok(s.short && s.name, k);
  }
});

test('no document: confirmOutside says no, and styles are skipped', async () => {
  assert.equal(await confirmOutside({ title: 'x' }, null), false);
  assert.doesNotThrow(() => addOutsideStyles(null));
});

test('styles use theme variables only, no fixed colors except the backdrop', () => {
  const colors = CSS.replace(/color-mix\(in srgb,#000 30%,transparent\)/g, '').match(/#[0-9a-f]{3,6}\b/gi);
  assert.equal(colors, null);
});

test('confirmOutside resolves true only from the send button', async () => {
  const doc = fakeDoc();
  const p = confirmOutside({ title: 'Push?' }, doc);
  const dlg = doc.body.children[0];
  assert.equal(dlg.open, true);
  assert.equal(doc.focused, 'cancel', 'Cancel has focus so Enter alone never sends');
  dlg.form.fire('submit', {});
  assert.equal(await p, true);
  assert.equal(doc.body.children.length, 0, 'the dialog is removed');

  const q = confirmOutside({ title: 'Push?' }, doc);
  doc.body.children[0].form.fire('click', { target: { closest: (s) => s === '[data-act=cancel]' } });
  assert.equal(await q, false);

  const r = confirmOutside({ title: 'Push?' }, doc);
  doc.body.children[0].close(); // Escape
  assert.equal(await r, false);
});

// Just enough DOM for confirmOutside.
function fakeDoc() {
  const listeners = () => {
    const m = {};
    return { on: (t, f) => { (m[t] ||= []).push(f); }, fire: (t, e) => { for (const f of m[t] || []) f({ preventDefault() {}, ...e }); } };
  };
  const doc = { focused: null, head: {}, body: { children: [], appendChild(el) { this.children.push(el); } } };
  doc.createElement = () => {
    const l = listeners();
    const fl = listeners();
    const form = { addEventListener: fl.on, fire: fl.fire, querySelector: (s) => s === '[data-act=cancel]' ? { focus: () => { doc.focused = 'cancel'; } } : null };
    const dlg = {
      open: false, form, className: '', innerHTML: '',
      querySelector: (s) => s === 'form' ? form : null,
      addEventListener: l.on,
      showModal() { this.open = true; },
      close() { if (!this.open) return; this.open = false; l.fire('close', {}); },
      remove() { doc.body.children = doc.body.children.filter(x => x !== dlg); }
    };
    return dlg;
  };
  return doc;
}
