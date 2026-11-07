/* Folio: the note editor. CodeMirror 6 (vendor/codemirror.js), wrapped so main.js talks to it the way it talks
   to a <textarea>: value, selectionStart / selectionEnd, setSelectionRange, setRangeText, focus, readOnly,
   scrollTop, addEventListener and dispatchEvent. If the bundle can't load, the textarea itself is the editor.

   What CodeMirror adds: Markdown and code fences colored as you type, Enter continuing lists, tasks and quotes,
   Tab / Shift+Tab to indent, Ctrl+F find and replace, Ctrl+D the next match, multiple cursors, bracket matching
   and a real undo history.

   Events, as a textarea has them:
   - 'input' fires for the user's edits (typing, paste, undo, commands), never for changes made through the
     API (value =, setRangeText), the same as a textarea; main.js dispatches 'input' itself after those.
   - 'keydown', 'paste', 'drop', 'dragover', 'focus' and 'blur' listeners run before CodeMirror's own keys;
     one that calls preventDefault() stops CodeMirror handling the event (the [[ picker uses this).
   - anything else ('keyup', 'click') is a listener on the editable element.

   reset(text) loads a note with a fresh undo history; revealPos(at) scrolls a position into view. The hidden
   <textarea id="editor"> keeps the text too (tests and devtools read it), and holds this object as `.editor`. */

const HANDLED = ['keydown', 'paste', 'drop', 'dragover', 'focus', 'blur'];

export async function createEditor(textarea) {
  try { return mount(textarea, await import('../vendor/codemirror.js')); }
  catch (e) { console.error('Folio: the editor could not start, so notes open in a plain text box.', e); return plain(textarea); }
}

function mount(textarea, cm) {
  const {
    EditorState, EditorSelection, Compartment, Prec, Annotation, EditorView, keymap, drawSelection, dropCursor,
    rectangularSelection, crosshairCursor, highlightActiveLine, highlightSpecialChars, defaultKeymap, history,
    historyKeymap, indentWithTab, syntaxHighlighting, HighlightStyle, bracketMatching, indentUnit, markdown,
    markdownLanguage, markdownKeymap, search, searchKeymap, highlightSelectionMatches, tags: t, codeLanguages
  } = cm;

  const api = Annotation.define(); // a change made through this object, not by the user
  const listeners = new Map();      // type -> [fn]
  const on = (type) => listeners.get(type) || [];
  const editable = new Compartment();

  const style = HighlightStyle.define([
    { tag: t.heading, class: 'cm-md-h' },
    { tag: [t.emphasis], class: 'cm-md-em' },
    { tag: [t.strong], class: 'cm-md-strong' },
    { tag: [t.strikethrough], class: 'cm-md-del' },
    { tag: [t.link, t.url], class: 'cm-md-link' },
    { tag: [t.monospace], class: 'cm-md-code' },
    { tag: [t.quote], class: 'cm-md-quote' },
    { tag: [t.processingInstruction, t.contentSeparator, t.meta], class: 'tok-meta' },
    { tag: [t.keyword, t.bool, t.null, t.self, t.atom, t.modifier, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword], class: 'tok-k' },
    { tag: [t.string, t.special(t.string), t.regexp, t.character, t.docString], class: 'tok-s' },
    { tag: [t.number, t.integer, t.float], class: 'tok-n' },
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: 'tok-c' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], class: 'tok-f' },
    { tag: [t.typeName, t.className, t.namespace, t.tagName, t.annotation], class: 'tok-t' },
    { tag: [t.propertyName, t.attributeName, t.labelName], class: 'tok-a' },
    { tag: [t.special(t.variableName), t.local(t.variableName)], class: 'tok-v' },
    { tag: t.inserted, class: 'tok-add' },
    { tag: t.deleted, class: 'tok-del' }
  ]);

  // Listeners that run before CodeMirror's keys; preventDefault() stops CodeMirror.
  const handlers = {};
  for (const type of HANDLED) handlers[type] = (e) => { for (const fn of on(type)) fn(e); return e.defaultPrevented; };

  const extensions = [
    Prec.highest(EditorView.domEventHandlers(handlers)),
    highlightSpecialChars(), history(), drawSelection(), dropCursor(), EditorState.allowMultipleSelections.of(true),
    rectangularSelection(), crosshairCursor(), highlightActiveLine(), highlightSelectionMatches(), bracketMatching(),
    indentUnit.of('  '), EditorState.tabSize.of(2), EditorView.lineWrapping,
    markdown({ base: markdownLanguage, codeLanguages, addKeymap: false }),
    syntaxHighlighting(style),
    search({ top: true }),
    keymap.of([...markdownKeymap, ...searchKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap]),
    editable.of([]),
    EditorView.editorAttributes.of({ class: 'editor cm-folio' }),
    EditorView.contentAttributes.of({ spellcheck: 'true', autocapitalize: 'sentences', autocorrect: 'on', 'aria-label': 'Note text (Markdown)', 'aria-multiline': 'true' }),
    EditorView.updateListener.of((u) => {
      if (!u.docChanged) return;
      cache = null;
      textarea.value = ed.value;
      // After this update finishes: an input listener may change the text itself (main.js's title fix).
      if (u.transactions.some(tr => tr.docChanged && !tr.annotation(api))) queueMicrotask(() => { for (const fn of on('input')) fn(new Event('input')); });
    })
  ];

  const view = new EditorView({ state: EditorState.create({ doc: textarea.value, extensions }) });
  textarea.hidden = true;
  textarea.tabIndex = -1;
  textarea.after(view.dom);

  let cache = null, ro = false;
  const len = () => view.state.doc.length;
  const clamp = (n) => Math.max(0, Math.min(len(), Number(n) || 0));
  const set = (spec) => view.dispatch({ ...spec, annotations: api.of(true) });

  const ed = {
    isCodeMirror: true,
    view,
    get value() { if (cache === null) cache = view.state.doc.toString(); return cache; },
    set value(text) {
      text = String(text);
      const cur = ed.value;
      if (text === cur) return;
      // The smallest change, so the cursor and undo history stay where they make sense.
      let a = 0;
      while (a < cur.length && a < text.length && cur[a] === text[a]) a++;
      let b = 0;
      while (b < cur.length - a && b < text.length - a && cur[cur.length - 1 - b] === text[text.length - 1 - b]) b++;
      set({ changes: { from: a, to: cur.length - b, insert: text.slice(a, text.length - b) } });
    },
    /** Load a note: its text, the cursor at the start, a fresh undo history. */
    reset(text) {
      view.setState(EditorState.create({ doc: String(text), extensions }));
      if (ro) view.dispatch({ effects: editable.reconfigure(readOnlyExt(true)) });
      cache = null;
      textarea.value = ed.value;
      view.scrollDOM.scrollTop = 0;
    },
    get selectionStart() { return view.state.selection.main.from; },
    get selectionEnd() { return view.state.selection.main.to; },
    setSelectionRange(a, b = a) { set({ selection: EditorSelection.single(clamp(a), clamp(b)) }); },
    setRangeText(text, s = ed.selectionStart, e = ed.selectionEnd, mode = 'preserve') {
      s = clamp(s); e = clamp(Math.max(s, e));
      const n = String(text).length;
      const sel = mode === 'end' ? EditorSelection.single(s + n) : mode === 'start' ? EditorSelection.single(s) : mode === 'select' ? EditorSelection.single(s, s + n) : undefined;
      set({ changes: { from: s, to: e, insert: String(text) }, ...(sel ? { selection: sel } : {}), scrollIntoView: true });
    },
    revealPos(at) { view.dispatch({ effects: EditorView.scrollIntoView(clamp(at), { y: 'start', yMargin: Math.round(view.scrollDOM.clientHeight / 3) }) }); },
    focus() { view.focus(); },
    blur() { view.contentDOM.blur(); },
    get readOnly() { return ro; },
    set readOnly(v) {
      if (Boolean(v) === ro) return;
      ro = Boolean(v);
      view.dispatch({ effects: editable.reconfigure(readOnlyExt(ro)) });
    },
    get scrollTop() { return view.scrollDOM.scrollTop; },
    set scrollTop(v) { view.scrollDOM.scrollTop = v; },
    get clientHeight() { return view.scrollDOM.clientHeight; },
    addEventListener(type, fn) {
      if (type === 'input' || HANDLED.includes(type)) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); }
      else view.contentDOM.addEventListener(type, fn);
    },
    dispatchEvent(ev) {
      if (ev.type === 'input' || HANDLED.includes(ev.type)) { for (const fn of on(ev.type)) fn(ev); return !ev.defaultPrevented; }
      return view.contentDOM.dispatchEvent(ev);
    },
    contains(node) { return view.dom.contains(node); }
  };
  function readOnlyExt(v) { return v ? [EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.editorAttributes.of({ class: 'read-only' })] : []; }
  textarea.editor = ed;
  return ed;
}

/* No CodeMirror: the textarea, with the two calls main.js makes that a textarea lacks. */
function plain(textarea) {
  textarea.reset = (text) => { textarea.value = text; textarea.setSelectionRange(0, 0); textarea.scrollTop = 0; };
  textarea.revealPos = (at) => {
    const line = (textarea.value.slice(0, at).match(/\n/g) || []).length;
    const lh = parseFloat(getComputedStyle(textarea).lineHeight) || 20;
    textarea.scrollTop = Math.max(0, line * lh - textarea.clientHeight / 3);
  };
  textarea.contains = (node) => node === textarea;
  textarea.editor = textarea;
  return textarea;
}
