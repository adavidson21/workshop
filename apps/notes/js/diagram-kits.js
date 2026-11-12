/* Folio: diagram starters and where the diagrams are in a note. Pure, so Node tests run it.

   A diagram is a fenced ```mermaid block, the same Markdown any Mermaid-aware editor renders. KITS are small
   working starters for each kind, inserted by Insert diagram and the slash menu. mermaidFences() finds the
   diagrams in a note (Copy for wiki draws each one), fenceAt() the one holding the cursor (Split view
   highlights it in the preview), and blockInsert() puts a block on lines of its own. */

export const KITS = [
  { id: 'flowchart', name: 'Flowchart', about: 'Steps, decisions and where a request goes',
    code: 'flowchart LR\n  A[Request] --> B{Cached?}\n  B -- Yes --> C[Return cached]\n  B -- No --> D[Call service]\n  D --> E[(Database)]\n  D --> C' },
  { id: 'sequence', name: 'Sequence', about: 'Who calls whom, in order: APIs, auth handshakes',
    code: 'sequenceDiagram\n  autonumber\n  actor User\n  participant App\n  participant API\n  User->>App: Click save\n  App->>API: POST /notes\n  API-->>App: 201 Created\n  App-->>User: Saved' },
  { id: 'erd', name: 'Entity relationship', about: 'Tables, keys and how records relate',
    code: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE_ITEM : contains\n  CUSTOMER {\n    string id PK\n    string name\n  }\n  ORDER {\n    string id PK\n    string customerId FK\n    date placedAt\n  }' },
  { id: 'state', name: 'State', about: 'The states something moves through',
    code: 'stateDiagram-v2\n  [*] --> Draft\n  Draft --> Review : submit\n  Review --> Draft : changes requested\n  Review --> Approved : approve\n  Approved --> [*]' },
  { id: 'class', name: 'Class', about: 'Types, their members and how they connect',
    code: 'classDiagram\n  class NoteStore {\n    +load() Promise\n    +save(path, text) Promise\n  }\n  class Index {\n    +search(query) Result[]\n  }\n  NoteStore --> Index : builds' },
  { id: 'architecture', name: 'Architecture', about: 'Services, data stores and how they connect',
    code: 'architecture-beta\n  group app(cloud)[App]\n  service web(internet)[Web] in app\n  service api(server)[API] in app\n  service db(database)[Database] in app\n  web:R --> L:api\n  api:R --> L:db' },
  { id: 'c4', name: 'C4 context', about: 'A system, its users and the systems around it',
    code: 'C4Context\n  title System context\n  Person(user, "Engineer", "Writes docs")\n  System(folio, "Folio", "Markdown notebook")\n  System_Ext(wiki, "Wiki", "Company docs")\n  Rel(user, folio, "Writes in")\n  Rel(folio, wiki, "Copies to")' },
  { id: 'gantt', name: 'Gantt', about: 'A plan over time, with dependencies',
    code: 'gantt\n  title Release plan\n  dateFormat YYYY-MM-DD\n  section Build\n  Design :done, d1, 2026-11-02, 3d\n  Implement :active, d2, after d1, 5d\n  section Ship\n  Test :d3, after d2, 3d\n  Release :milestone, after d3, 0d' },
  { id: 'timeline', name: 'Timeline', about: 'Events in order: an incident, a project',
    code: 'timeline\n  title Incident\n  Alert fires : on call paged\n  Investigate : found the bad deploy\n  Roll back : errors drop\n  Resolved : postmortem scheduled' },
  { id: 'mindmap', name: 'Mind map', about: 'Ideas branching from one topic',
    code: 'mindmap\n  root((Launch))\n    Scope\n      Must have\n      Nice to have\n    Risks\n      Timeline\n    People' },
  { id: 'git', name: 'Git graph', about: 'Branches, commits and merges',
    code: 'gitGraph\n  commit\n  branch feature\n  checkout feature\n  commit\n  commit\n  checkout main\n  merge feature\n  commit' }
];

export const kit = (id) => KITS.find(k => k.id === id) || null;
/** A kit as a fenced block. */
export const kitBlock = (k) => '```mermaid\n' + k.code + '\n```';

const OPEN = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;

/** Every fenced block in a note: [{line, end, lang, src}], lines 0-based in the whole file (end is the closing line). */
export function fences(text) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  let i = 0;
  // Frontmatter is not Markdown.
  if (/^---[ \t]*$/.test(lines[0] || '')) { const close = lines.findIndex((l, k) => k > 0 && /^---[ \t]*$/.test(l)); if (close > 0) i = close + 1; }
  for (; i < lines.length; i++) {
    const m = OPEN.exec(lines[i]);
    if (!m) continue;
    const marker = m[1];
    const close = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`);
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j])) j++;
    out.push({ line: i, end: Math.min(j, lines.length - 1), lang: m[2].toLowerCase(), src: lines.slice(i + 1, j).join('\n') });
    i = j;
  }
  return out;
}

/** The diagrams in a note, in order. */
export const mermaidFences = (text) => fences(text).filter(f => f.lang === 'mermaid');

/** The diagram whose fence holds this line (0-based), or null. */
export const fenceAt = (text, line) => mermaidFences(text).find(f => line >= f.line && line <= f.end) || null;

/** The 0-based line a text offset is on. */
export const lineOf = (text, at) => (String(text).slice(0, at).match(/\n/g) || []).length;

/**
 * Put a block on lines of its own at the selection [s, e): a blank line before and after unless the text
 * already has one. {insert, cursor}: the text to put over [s, e), and the cursor's offset inside it (the
 * start of the block's second line, inside a fence).
 */
export function blockInsert(text, s, e, block) {
  const before = String(text).slice(0, s), after = String(text).slice(e);
  const pre = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const post = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const nl = block.indexOf('\n');
  return { insert: pre + block + post, cursor: pre.length + (nl >= 0 ? nl + 1 : block.length) };
}
