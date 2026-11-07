// The CodeMirror 6 pieces Folio's editor (js/editor.js) uses, bundled into vendor/codemirror.js by
// scripts/build-editor.mjs. Code fences in a note get these languages' colors while you type.
import { LanguageDescription, StreamLanguage } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { sql } from '@codemirror/lang-sql';
import { python } from '@codemirror/lang-python';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { yaml } from '@codemirror/lang-yaml';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { csharp, java } from '@codemirror/legacy-modes/mode/clike';
import { go } from '@codemirror/legacy-modes/mode/go';
import { diff } from '@codemirror/legacy-modes/mode/diff';

export { EditorState, EditorSelection, Compartment, Prec, Annotation, Transaction } from '@codemirror/state';
export { EditorView, keymap, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine, highlightSpecialChars } from '@codemirror/view';
export { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
export { syntaxHighlighting, HighlightStyle, bracketMatching, indentUnit, indentOnInput } from '@codemirror/language';
export { markdown, markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown';
export { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
export { tags } from '@lezer/highlight';

const legacy = (mode) => () => StreamLanguage.define(mode);
const lang = (name, alias, load) => LanguageDescription.of({ name, alias, load: async () => load() });
export const codeLanguages = [
  lang('javascript', ['js', 'jsx', 'mjs', 'cjs', 'node'], () => javascript({ jsx: true })),
  lang('typescript', ['ts', 'tsx'], () => javascript({ typescript: true, jsx: true })),
  lang('json', ['jsonc', 'json5'], json),
  lang('sql', ['psql', 'postgres', 'postgresql', 'mysql', 'tsql', 'mssql', 'plsql'], sql),
  lang('python', ['py', 'python3'], python),
  lang('css', ['scss', 'less'], css),
  lang('html', ['xml', 'svg', 'xaml', 'vue'], html),
  lang('yaml', ['yml'], yaml),
  lang('bash', ['sh', 'shell', 'zsh', 'console'], legacy(shell)),
  lang('csharp', ['cs', 'c#', 'dotnet'], legacy(csharp)),
  lang('java', ['kotlin', 'kt'], legacy(java)),
  lang('go', ['golang'], legacy(go)),
  lang('diff', ['patch'], legacy(diff))
];
