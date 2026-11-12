/* Folio: syntax colors for code blocks in the preview. Pure, so Node tests run it.

   A small scanner, not a parser: comments, strings, numbers, keywords, function calls, types and a few
   language-specific bits (JSON keys, YAML keys, shell variables, HTML tags, diff lines). Every character is
   escaped; the only markup is <span class="tok-..."> around escaped text. An unknown language is escaped only.

   Classes: tok-c comment, tok-s string, tok-n number, tok-k keyword, tok-f function, tok-t type or tag,
   tok-a attribute or key, tok-v variable, tok-add / tok-del / tok-meta diff lines. */
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const words = (s) => new Set(s.split(/\s+/).filter(Boolean));

const JS_KW = words(`async await break case catch class const continue debugger default delete do else export extends false finally for
  from function get if import in instanceof let new null of return set static super switch this throw true try typeof undefined var void
  while with yield as interface type enum implements private protected public readonly abstract declare keyof namespace satisfies`);
const PY_KW = words(`and as assert async await break class continue def del elif else except False finally for from global if import in is
  lambda None nonlocal not or pass raise return True try while with yield self match case`);
const CS_KW = words(`abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do
  double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long
  namespace new null object operator out override params private protected public readonly record ref return sbyte sealed short sizeof
  static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while get set
  init value yield where`);
const JAVA_KW = words(`abstract assert boolean break byte case catch char class const continue default do double else enum extends final
  finally float for if implements import instanceof int interface long native new null package private protected public return short
  static super switch synchronized this throw throws transient true false try var void volatile while record`);
const GO_KW = words(`break case chan const continue default defer else fallthrough for func go goto if import interface map package range
  return select struct switch type var true false nil string int int64 error bool byte rune float64`);
const SQL_KW = words(`select from where and or not insert into values update set delete create table alter drop index view join left right
  inner outer full on as group by order having limit offset union all distinct case when then else end null is in like between exists
  primary key foreign references default constraint unique begin commit rollback transaction with returning asc desc count sum avg min max
  varchar int integer bigint text boolean date timestamp declare exec procedure top`);
const SH_KW = words(`if then else elif fi for while until do done case esac in function return exit export local readonly set unset
  echo cd source alias sudo`);
const CSS_KW = words(`important media import supports keyframes font-face from to and not only`);

/* Each language: {kw, ci (keywords ignore case), rules: [[class, regex]]} tried in order at each position. */
const C_LIKE = [
  ['tok-c', /\/\/[^\n]*/y], ['tok-c', /\/\*[\s\S]*?(?:\*\/|$)/y],
  ['tok-s', /"(?:[^"\\\n]|\\.)*"?/y], ['tok-s', /'(?:[^'\\\n]|\\.)*'?/y],
  ['tok-n', /\b(?:0[xX][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)[a-zA-Z]*\b/y]
];
const LANGS = {
  js: { kw: JS_KW, rules: [['tok-c', /\/\/[^\n]*/y], ['tok-c', /\/\*[\s\S]*?(?:\*\/|$)/y], ['tok-s', /`(?:[^`\\]|\\[\s\S])*`?/y], ...C_LIKE.slice(2)] },
  python: { kw: PY_KW, rules: [['tok-c', /#[^\n]*/y], ['tok-s', /[rbfRBF]{0,2}("""|''')[\s\S]*?(?:\1|$)/y], ['tok-s', /[rbfRBF]{0,2}"(?:[^"\\\n]|\\.)*"?/y],
    ['tok-s', /[rbfRBF]{0,2}'(?:[^'\\\n]|\\.)*'?/y], ['tok-t', /@[\w.]+/y], C_LIKE[4]] },
  csharp: { kw: CS_KW, rules: [['tok-s', /\$?@?"(?:[^"\\]|\\.|"")*"?/y], ['tok-t', /\[[A-Z]\w*(?=[\](])/y], ...C_LIKE] },
  java: { kw: JAVA_KW, rules: [['tok-t', /@\w+/y], ...C_LIKE] },
  go: { kw: GO_KW, rules: [['tok-s', /`[^`]*`?/y], ...C_LIKE] },
  sql: { kw: SQL_KW, ci: true, rules: [['tok-c', /--[^\n]*/y], ['tok-c', /\/\*[\s\S]*?(?:\*\/|$)/y], ['tok-s', /'(?:[^']|'')*'?/y], ['tok-a', /"[^"\n]*"?/y], ['tok-v', /[@:]\w+/y], C_LIKE[4]] },
  bash: { kw: SH_KW, rules: [['tok-c', /(?<![\w$])#[^\n]*/y], ['tok-s', /"(?:[^"\\]|\\[\s\S])*"?/y], ['tok-s', /'[^']*'?/y],
    ['tok-v', /\$(?:\{[^}\n]*\}?|\w+|[@#?$!*-])/y], ['tok-a', /(?<=\s)--?[\w-]+/y], ['tok-n', /\b\d+\b/y]] },
  json: { kw: words('true false null'), rules: [['tok-a', /"(?:[^"\\\n]|\\.)*"(?=\s*:)/y], ['tok-s', /"(?:[^"\\\n]|\\.)*"?/y], ['tok-c', /\/\/[^\n]*/y], ['tok-n', /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y]] },
  yaml: { kw: words('true false null yes no on off ~'), rules: [['tok-c', /(?<![^\s])#[^\n]*/y], ['tok-a', /(?<=(?:^|\n)[ \t]*(?:-[ \t]+)?)[\w.$/-]+(?=[ \t]*:(?:\s|$))/y],
    ['tok-s', /"(?:[^"\\\n]|\\.)*"?/y], ['tok-s', /'(?:[^'\n]|'')*'?/y], ['tok-t', /[&*!][\w-]+/y], ['tok-n', /\b\d+(?:\.\d+)?\b/y]] },
  css: { kw: CSS_KW, rules: [['tok-c', /\/\*[\s\S]*?(?:\*\/|$)/y], ['tok-s', /"[^"\n]*"?|'[^'\n]*'?/y], ['tok-a', /[\w-]+(?=\s*:[^;{}]*[;}])/y],
    ['tok-t', /[.#][\w-]+/y], ['tok-v', /--[\w-]+/y], ['tok-n', /#[\da-fA-F]{3,8}\b|-?\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|s|ms|fr|deg)?\b/y], ['tok-k', /@[\w-]+/y]] },
  html: { kw: new Set(), rules: [['tok-c', /<!--[\s\S]*?(?:-->|$)/y], ['tok-t', /<\/?[\w:-]+|\/?>/y], ['tok-a', /(?<=\s)[\w:@-]+(?==)/y], ['tok-s', /"[^"]*"?|'[^']*'?/y]] }
};
LANGS.ts = LANGS.js;
const ALIAS = { javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js', node: 'js', typescript: 'ts', tsx: 'ts', py: 'python', python3: 'python',
  cs: 'csharp', 'c#': 'csharp', dotnet: 'csharp', sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', powershell: 'bash', ps1: 'bash',
  jsonc: 'json', json5: 'json', yml: 'yaml', scss: 'css', less: 'css', xml: 'html', svg: 'html', xaml: 'html', vue: 'html', golang: 'go',
  kotlin: 'java', kt: 'java', psql: 'sql', postgres: 'sql', postgresql: 'sql', mysql: 'sql', tsql: 'sql', mssql: 'sql', plsql: 'sql' };

/** The language a fence's info string names, as LANGS knows it, or null. diff is handled on its own. */
export function langOf(info) {
  const l = String(info || '').toLowerCase().trim();
  if (l === 'diff' || l === 'patch') return 'diff';
  const k = ALIAS[l] || l;
  return Object.prototype.hasOwnProperty.call(LANGS, k) ? k : null;
}

const span = (cls, text) => `<span class="${cls}">${esc(text)}</span>`;

/** Code to HTML with syntax colors. Unknown languages come back escaped and nothing else. */
export function highlight(code, info) {
  const text = String(code);
  const lang = langOf(info);
  if (!lang) return esc(text);
  if (lang === 'diff') {
    return text.split('\n').map(l => (/^(\+\+\+|---|@@|diff |index )/.test(l) ? span('tok-meta', l) : l[0] === '+' ? span('tok-add', l) : l[0] === '-' ? span('tok-del', l) : esc(l))).join('\n');
  }
  const { kw, ci, rules } = LANGS[lang];
  let out = '', i = 0, plain = '';
  const flush = () => { if (plain) { out += esc(plain); plain = ''; } };
  outer: while (i < text.length) {
    for (const [cls, re] of rules) {
      re.lastIndex = i;
      const m = re.exec(text);
      if (m && m[0].length) { flush(); out += span(cls, m[0]); i += m[0].length; continue outer; }
    }
    const w = /[A-Za-z_$][\w$]*/y;
    w.lastIndex = i;
    const m = w.exec(text);
    if (m) {
      const word = m[0], after = text.slice(i + word.length).match(/^\s*(.)/);
      const isKw = kw.has(ci ? word.toLowerCase() : word);
      // A word right after an identifier character is part of it (a number's suffix was taken above).
      if (isKw) { flush(); out += span('tok-k', word); }
      else if (after && after[1] === '(' && lang !== 'sql' && lang !== 'css' && lang !== 'html') { flush(); out += span('tok-f', word); }
      else if (/^[A-Z][a-z0-9]\w*$/.test(word) && ['ts', 'js', 'csharp', 'java', 'go', 'python'].includes(lang)) { flush(); out += span('tok-t', word); }
      else plain += word;
      i += word.length;
      continue;
    }
    plain += text[i++];
  }
  flush();
  return out;
}
