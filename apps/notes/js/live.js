/* Folio: the Live view. The editor shows the note formatted as you write, like Obsidian's Live Preview: Markdown
   marks are hidden except on the lines the cursor is on, and diagrams, tables, callouts and embeds are drawn in
   place. The file is the same Markdown; nothing here changes the text except ticking a task's box.

   Built on CodeMirror 6 decorations (vendor/codemirror.js), so it exists only when the editor does:
   - blocks (a StateField, since a block widget spans lines): ```mermaid fences, tables, callouts and embed
     paragraphs at the top level, drawn by ctx.block(). Click one (not a link or button in it) to edit its source.
   - inline (a ViewPlugin, visible lines only): headings sized, emphasis and code marks hidden, links shown as
     links, images drawn, list bullets and task boxes, quotes, rules, code blocks shaded, [[wikilinks]] and #tags.

   "The lines the cursor is on" counts only while the editor has focus, so a note reads clean until you click in.
   Clicking a link, tag or task box acts at once (the document's click handler in main.js, as in the preview);
   Alt+click puts the cursor there instead.

   ctx, from main.js:
     block(text, line) -> HTMLElement   the rendered block; line is its first line in the note
     link(href) -> {attr: value} | null attributes for a link's text (data-note, data-missing-path, data-app, ...)
     wiki(inner) -> {attr: value} | null the same for [[inner]]
     image(src) -> Promise<url | null>   a local image's address; remote images are never loaded
     taskLocked(line) -> boolean         a task Docket owns (sent there), shown but not tickable */

import { normTag } from './markdown.js';
import { embedSpec } from './embeds.js';

const FRONT = /^---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/;
const CALLOUT = /^ {0,3}>[ \t]?\[!(note|tip|important|warning|caution)\]/i;
const WIKI = /(^|[^!])\[\[([^\[\]\n]+)\]\]/g;
const TAG = /(^|[\s(])#([A-Za-z0-9_][A-Za-z0-9_/-]*)/g;

export function liveExtension(cm, ctx) {
  const { EditorView, Decoration, WidgetType, ViewPlugin, StateField, StateEffect, syntaxTree, ensureSyntaxTree } = cm;

  const focusFx = StateEffect.define();   // the editor gained or lost focus
  const refreshFx = StateEffect.define(); // draw blocks again (theme changed)
  const wakeFx = StateEffect.define();    // the mouse button came up: reveal where the cursor is now
  // While the mouse button is down, what is revealed stays as it was: showing a line's Markdown on mousedown
  // reflows the text, and the release would turn the click into a drag selection.
  let held = null; // the revealed lines when the button went down, or null

  /* ---------- widgets ---------- */

  class Block extends WidgetType {
    constructor(text, line, gen) { super(); this.text = text; this.line = line; this.gen = gen; }
    eq(o) { return o.text === this.text && o.line === this.line && o.gen === this.gen; }
    toDOM(view) {
      const dom = document.createElement('div');
      dom.className = 'lp-block md';
      try { dom.append(ctx.block(this.text, this.line)); }
      catch (e) { console.error('Folio: a block could not be drawn in Live.', e); dom.textContent = this.text; dom.classList.add('lp-raw'); }
      dom.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || e.target.closest('a, button, input, summary, select, textarea, .lp-act')) return;
        e.preventDefault();
        const pos = view.posAtDOM(dom);
        view.dispatch({ selection: { anchor: Math.min(view.state.doc.lineAt(pos).to, pos + firstLineEnd(this.text)) } });
        view.focus();
      });
      // Diagrams and images draw after this returns: tell the editor the height changed.
      if (typeof ResizeObserver === 'function') { dom._ro = new ResizeObserver(() => view.requestMeasure()); dom._ro.observe(dom); }
      return dom;
    }
    destroy(dom) { if (dom._ro) dom._ro.disconnect(); }
    ignoreEvent() { return true; }
    get estimatedHeight() { return 24 * Math.min(12, this.text.split('\n').length); }
  }

  class Image extends WidgetType {
    constructor(src, alt) { super(); this.src = src; this.alt = alt; }
    eq(o) { return o.src === this.src && o.alt === this.alt; }
    toDOM(view) {
      const img = document.createElement('img');
      img.className = 'lp-img';
      img.alt = this.alt;
      img.addEventListener('load', () => view.requestMeasure());
      Promise.resolve(ctx.image(this.src)).then((url) => {
        if (url) { img.src = url; return; }
        const miss = Object.assign(document.createElement('span'), { className: 'img-note missing', textContent: `[image not found: ${this.alt || this.src}]` });
        img.replaceWith(miss);
      }, () => {});
      return img;
    }
    ignoreEvent() { return false; }
  }

  class Box extends WidgetType {
    constructor(checked, line, locked) { super(); this.checked = checked; this.line = line; this.locked = locked; }
    eq(o) { return o.checked === this.checked && o.line === this.line && o.locked === this.locked; }
    toDOM() {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'lp-box lp-act';
      box.checked = this.checked;
      box.dataset.task = String(this.line);
      box.setAttribute('aria-label', this.checked ? 'Done' : 'To do');
      if (this.locked) { box.disabled = true; box.title = 'Sent to Docket, which owns whether it is done'; }
      return box;
    }
    ignoreEvent() { return true; }
  }

  class Bullet extends WidgetType {
    eq() { return true; }
    toDOM() { return Object.assign(document.createElement('span'), { className: 'lp-bullet', textContent: '•' }); }
  }

  class Rule extends WidgetType {
    eq() { return true; }
    toDOM() { return Object.assign(document.createElement('span'), { className: 'lp-hr' }); }
  }

  const hide = Decoration.replace({});
  const bullet = Decoration.replace({ widget: new Bullet() });
  const rule = Decoration.replace({ widget: new Rule() });
  const lineCls = (cls) => Decoration.line({ class: cls });
  // Only a mark that leads somewhere (a data-* attribute) takes the click; a bad link is just styled.
  const markWith = ({ class: cls, ...attrs }) => Decoration.mark({ class: `lp-link${Object.keys(attrs).some(k => k.startsWith('data-')) ? ' lp-act' : ''} ${cls || ''}`.trim(), attributes: attrs });

  /* ---------- what is revealed ---------- */

  function frontEnd(doc) {
    const head = doc.sliceString(0, Math.min(doc.length, 4000));
    const m = FRONT.exec(head);
    return m ? m[0].length : 0;
  }
  /** Line numbers the cursor or a selection is on, while the editor has focus. */
  function revealed(state, focused) {
    if (held) return held;
    const out = new Set();
    if (!focused) return out;
    for (const r of state.selection.ranges) {
      const a = state.doc.lineAt(r.from).number, b = state.doc.lineAt(r.to).number;
      for (let n = a; n <= b; n++) out.add(n);
    }
    return out;
  }
  const treeOf = (state) => ensureSyntaxTree(state, state.doc.length, 150) || syntaxTree(state);

  /* ---------- blocks ---------- */

  function blocks(state, shown, gen) {
    const doc = state.doc, tree = treeOf(state), fm = frontEnd(doc);
    const out = [];
    for (let n = tree.topNode.firstChild; n; n = n.nextSibling) {
      if (n.from < fm) continue;
      const kind = blockKind(state, n);
      if (!kind) continue;
      const a = doc.lineAt(n.from), b = doc.lineAt(Math.max(n.from, n.to - (n.to > n.from && doc.sliceString(n.to - 1, n.to) === '\n' ? 1 : 0)));
      let open = false;
      for (let k = a.number; k <= b.number && !open; k++) open = shown.has(k);
      if (open) continue;
      const text = doc.sliceString(a.from, b.to);
      out.push(Decoration.replace({ widget: new Block(text, a.number - 1, gen), block: true }).range(a.from, b.to));
    }
    return Decoration.set(out, true);
  }
  function blockState(state, focused, gen) {
    const shown = revealed(state, focused);
    return { focused, gen, shown, deco: blocks(state, shown, gen) };
  }
  function blockKind(state, n) {
    const text = () => state.doc.sliceString(n.from, n.to);
    if (n.name === 'Table') return 'table';
    if (n.name === 'FencedCode') {
      const info = n.node.getChild('CodeInfo');
      return info && /^mermaid$/i.test(state.doc.sliceString(info.from, info.to).trim()) ? 'diagram' : null;
    }
    if (n.name === 'Blockquote') return CALLOUT.test(state.doc.lineAt(n.from).text) ? 'callout' : null;
    if (n.name === 'Paragraph') return embedSpec(text()) ? 'embed' : null;
    return null;
  }

  const blockField = StateField.define({
    create: (state) => blockState(state, false, 0),
    update(v, tr) {
      let { focused, gen } = v, wake = false;
      for (const e of tr.effects) { if (e.is(focusFx)) focused = e.value; if (e.is(refreshFx)) gen++; if (e.is(wakeFx)) wake = true; }
      const treeMoved = syntaxTree(tr.startState) !== syntaxTree(tr.state);
      if (!tr.docChanged && !tr.selection && focused === v.focused && gen === v.gen && !treeMoved && !wake) return v;
      return blockState(tr.state, focused, gen);
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco)
  });

  /* ---------- inline ---------- */

  function inlineDeco(view) {
    const { state } = view;
    const doc = state.doc, tree = treeOf(state), fm = frontEnd(doc);
    const { shown, deco: blockDeco } = state.field(blockField);
    const rev = (pos) => shown.has(doc.lineAt(pos).number);
    const inBlock = [];
    blockDeco.between(0, doc.length, (a, b) => { inBlock.push([a, b]); });
    const covered = (a, b) => inBlock.some(([x, y]) => a < y && b > x);
    const out = [];
    const skip = []; // code and URLs: no wikilinks or tags in them

    if (fm) {
      for (let p = 0; p < fm && p <= doc.length;) { const l = doc.lineAt(p); out.push(lineCls('lp-front').range(l.from)); p = l.to + 1; }
    }

    for (const { from, to } of view.visibleRanges) {
      tree.iterate({
        from, to,
        enter: (node) => {
          const n = node.node;
          if (n.to <= fm || covered(n.from, n.to)) return n.name === 'Document' ? undefined : false;
          const name = n.name;
          if (/^ATXHeading(\d)$/.test(name)) {
            out.push(lineCls(`lp-h lp-h${name.slice(-1)}`).range(doc.lineAt(n.from).from));
            if (!rev(n.from)) {
              const mark = n.getChild('HeaderMark');
              if (mark && mark.from === n.from) out.push(hide.range(mark.from, Math.min(n.to, mark.to + (doc.sliceString(mark.to, mark.to + 1) === ' ' ? 1 : 0))));
            }
            return;
          }
          if (name === 'EmphasisMark' || name === 'StrikethroughMark') { if (!rev(n.from)) out.push(hide.range(n.from, n.to)); return; }
          if (name === 'InlineCode') {
            skip.push([n.from, n.to]);
            if (n.to > n.from) out.push(Decoration.mark({ class: 'lp-code' }).range(n.from, n.to));
            if (!rev(n.from)) for (const m of n.getChildren('CodeMark')) out.push(hide.range(m.from, m.to));
            return false;
          }
          if (name === 'FencedCode' || name === 'CodeBlock') {
            skip.push([n.from, n.to]);
            const a = doc.lineAt(n.from).number, b = doc.lineAt(n.to).number;
            for (let k = a; k <= b; k++) {
              const l = doc.line(k);
              const fence = name === 'FencedCode' && (k === a || (k === b && /^\s*(`{3,}|~{3,})\s*$/.test(l.text)));
              out.push(lineCls(`lp-pre${k === a ? ' lp-pre-first' : ''}${k === b ? ' lp-pre-last' : ''}${fence ? ' lp-fence' : ''}`).range(l.from));
            }
            return false;
          }
          if (name === 'HTMLBlock' || name === 'HTMLTag' || name === 'Comment' || name === 'CommentBlock') { skip.push([n.from, n.to]); return false; }
          if (name === 'Link') { linkDeco(n); return false; }
          if (name === 'Image') { skip.push([n.from, n.to]); imageDeco(n); return false; }
          if (name === 'URL') { skip.push([n.from, n.to]); urlDeco(n); return false; }
          if (name === 'Autolink') { skip.push([n.from, n.to]); return false; }
          if (name === 'Blockquote') {
            const a = doc.lineAt(n.from).number, b = doc.lineAt(n.to).number;
            for (let k = a; k <= b; k++) out.push(lineCls('lp-quote').range(doc.line(k).from));
            return;
          }
          if (name === 'QuoteMark') { if (!rev(n.from)) out.push(hide.range(n.from, Math.min(doc.lineAt(n.from).to, n.to + (doc.sliceString(n.to, n.to + 1) === ' ' ? 1 : 0)))); return; }
          if (name === 'HorizontalRule') { if (!rev(n.from)) out.push(rule.range(n.from, n.to)); return; }
          if (name === 'ListItem') { listDeco(n); return; }
          return undefined;
        }
      });
    }

    function linkDeco(n) {
      const url = n.getChild('URL');
      const marks = n.getChildren('LinkMark');
      if (!url || marks.length < 2 || rev(n.from)) return;
      const textFrom = marks[0].to, textTo = marks[1].from;
      if (textTo <= textFrom) return;
      const attrs = safeAttrs(ctx.link(doc.sliceString(url.from, url.to)));
      if (!attrs) return;
      out.push(hide.range(n.from, textFrom));
      out.push(markWith(attrs).range(textFrom, textTo));
      out.push(hide.range(textTo, n.to));
    }
    function imageDeco(n) {
      if (rev(n.from)) return;
      const url = n.getChild('URL');
      const marks = n.getChildren('LinkMark');
      if (!url || marks.length < 2) return;
      const alt = doc.sliceString(marks[0].to, marks[1].from);
      out.push(Decoration.replace({ widget: new Image(doc.sliceString(url.from, url.to), alt) }).range(n.from, n.to));
    }
    function urlDeco(n) {
      const p = n.parent && n.parent.name;
      if (p === 'Link' || p === 'Image' || rev(n.from)) return;
      const href = doc.sliceString(n.from, n.to);
      if (/^https?:\/\//i.test(href)) out.push(markWith({ 'data-href': href, title: href }).range(n.from, n.to));
    }
    function listDeco(item) {
      const mark = item.getChild('ListMark');
      if (!mark || !item.parent) return;
      const task = item.getChild('Task');
      const marker = task && task.getChild('TaskMarker');
      const line = doc.lineAt(mark.from);
      if (marker) {
        const checked = /x/i.test(doc.sliceString(marker.from, marker.to));
        if (checked) out.push(lineCls('lp-done').range(line.from));
        if (rev(mark.from)) return;
        const idx = line.number - 1;
        out.push(Decoration.replace({ widget: new Box(checked, idx, Boolean(ctx.taskLocked && ctx.taskLocked(idx))) }).range(mark.from, marker.to));
        return;
      }
      if (item.parent.name === 'BulletList' && !rev(mark.from)) out.push(bullet.range(mark.from, mark.to));
    }

    // [[wikilinks]] and #tags: Markdown's grammar doesn't know them, so read the visible lines, outside code.
    const skipped = (a, b) => skip.some(([x, y]) => a < y && b > x) || covered(a, b);
    for (const { from, to } of view.visibleRanges) {
      for (let p = Math.max(from, fm); p <= to && p <= doc.length;) {
        const l = doc.lineAt(p);
        p = l.to + 1;
        if (rev(l.from) || !l.text) continue;
        let m;
        WIKI.lastIndex = 0;
        while ((m = WIKI.exec(l.text))) {
          const a = l.from + m.index + m[1].length, b = l.from + m.index + m[0].length;
          if (skipped(a, b)) continue;
          const inner = m[2];
          const bar = inner.indexOf('|');
          const attrs = safeAttrs(ctx.wiki(inner));
          if (!attrs) continue;
          const labelFrom = a + 2 + (bar >= 0 ? bar + 1 : 0), labelTo = b - 2;
          if (labelTo <= labelFrom) continue;
          out.push(hide.range(a, labelFrom));
          out.push(markWith(attrs).range(labelFrom, labelTo));
          out.push(hide.range(labelTo, b));
        }
        if (/^ {0,3}#{1,6}(\s|$)/.test(l.text)) continue; // headings never hold tags
        TAG.lastIndex = 0;
        while ((m = TAG.exec(l.text))) {
          const a = l.from + m.index + m[1].length, b = a + 1 + m[2].length;
          const t = normTag(m[2]);
          if (!t || skipped(a, b)) continue;
          out.push(Decoration.mark({ class: 'tag lp-tag lp-act', attributes: { 'data-tag': t } }).range(a, b));
        }
      }
    }
    return Decoration.set(out, true);
  }

  const inlinePlugin = ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = inlineDeco(view); }
    update(u) {
      const moved = u.startState.field(blockField) !== u.state.field(blockField);
      if (u.docChanged || u.viewportChanged || u.selectionSet || moved || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = inlineDeco(u.view);
    }
  }, { decorations: (v) => v.decorations });

  // A link, tag or task box acts on click (main.js), so CodeMirror must not move the cursor there first.
  const clicks = EditorView.domEventHandlers({
    mousedown(e, view) {
      if (e.button !== 0) return false;
      const el = !e.altKey && e.target.closest && e.target.closest('.lp-act');
      if (!el) {
        if (!held) {
          held = view.state.field(blockField).shown;
          // After CodeMirror has placed the cursor from the release (it reads the layout as it is then).
          window.addEventListener('mouseup', () => setTimeout(() => { held = null; if (view.dom.isConnected) view.dispatch({ effects: wakeFx.of(null) }); }, 0), { once: true });
        }
        return false;
      }
      e.preventDefault();
      if (el.dataset.href) window.open(el.dataset.href, '_blank', 'noopener,noreferrer');
      return true;
    }
  });

  return {
    extension: [
      blockField, inlinePlugin, clicks,
      EditorView.focusChangeEffect.of((state, focusing) => focusFx.of(focusing)),
      EditorView.editorAttributes.of({ class: 'live' })
    ],
    /** Effects that put the focus state right after the extension is turned on in a running editor. */
    focus: (focused) => focusFx.of(focused),
    refresh: () => refreshFx.of(null)
  };
}

/** The first line's length: clicking a block puts the cursor at the end of its first line. */
function firstLineEnd(text) { const k = text.indexOf('\n'); return k < 0 ? text.length : k; }

/** Attributes for a link mark: data-* and title pass; a web address goes in data-href (opened by the click). */
function safeAttrs(attrs) {
  if (!attrs) return null;
  const out = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'href') { if (/^https?:\/\//i.test(v)) out['data-href'] = v; continue; }
    if (k === 'class' || k === 'title' || k.startsWith('data-')) out[k] = String(v);
  }
  return Object.keys(out).length ? out : null;
}
