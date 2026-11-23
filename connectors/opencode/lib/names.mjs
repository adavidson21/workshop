// opencode connector: the folder name a new board run gets (1.36.0). Before, the agent made the name itself ("the
// first 5 meaningful words") and Workshop linked the run to the first new folder with that prefix, which a small
// model could get wrong and two runs at once could mix up. Now Workshop picks the name with the same rule and sends
// it as `--name <short name>` (eng-agents Core 4.18.0). An older Tandem ignores it, so linking falls back to the
// first new folder.

import fs from "node:fs";
import path from "node:path";

const FILLER = new Set(["a", "an", "the", "to", "of", "for", "and", "add", "new"]);

/** Tandem's short-name rule: the first `words` meaningful words, lowercase, joined with "-", at most 40 characters. */
export function shortName(text, words = 5) {
  const w = String(text || "").toLowerCase().replace(/[^a-z0-9\s-]+/g, " ").split(/[\s-]+/).filter((x) => x && !FILLER.has(x)).slice(0, words);
  let s = "";
  for (const x of w) {
    const next = s ? `${s}-${x}` : x;
    if (next.length > 40) break;
    s = next;
  }
  return s || (w[0] ? w[0].slice(0, 40) : "untitled");
}

/** A short name whose `<prefix>-<name>` folder is not in `root` yet ("-2", "-3" and so on when it is). */
export function freeName(text, prefix, root, words = 5) {
  const base = shortName(text, words);
  let name = base;
  for (let i = 2; fs.existsSync(path.join(root, `${prefix}-${name}`)); i++) name = `${base}-${i}`;
  return name;
}
