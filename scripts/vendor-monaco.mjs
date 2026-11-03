#!/usr/bin/env node
// Vendors a trimmed Monaco editor into apps/agents/vendor/monaco for Dispatch's code review screen.
//
//   npm pack monaco-editor@<version>          (in an empty folder)
//   tar xzf monaco-editor-<version>.tgz
//   node scripts/vendor-monaco.mjs <that folder>/package <path to monaco-editor-<version>.tgz>
//
// Keeps the editor, the diff editor, the editor worker and Monarch syntax colors (basic-languages).
// Drops the language services (TypeScript, CSS, HTML and JSON workers and modes) and translations:
// a read-only review of a diff has no project to check against, so they would only add wrong error
// squiggles and about 20 MB. Their modes are replaced with stubs that do nothing.
// Then rewrites "files" in apps/agents/app.json so the service worker precaches the copy, and writes
// vendor/monaco/README.md with the version and the tarball's SHA-256. Node 22, no dependencies.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [pkgDir, tarball] = process.argv.slice(2);
if (!pkgDir || !fs.existsSync(path.join(pkgDir, "min", "vs", "loader.js"))) {
  console.error("Usage: node scripts/vendor-monaco.mjs <extracted monaco-editor package folder> [tarball]");
  process.exit(1);
}
const version = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;
const src = path.join(pkgDir, "min", "vs");
const appDir = path.join(root, "apps", "agents");
const out = path.join(appDir, "vendor", "monaco");
const outVs = path.join(out, "vs");

const LANGUAGE_WORKER = /^(ts|css|html|json)\.worker-[\w-]+\.js$/;
const MODE = /^(ts|css|html|json)Mode-[\w-]+\.js$/;
const dropped = (rel) => {
  const parts = rel.split("/");
  if (parts[0] === "language") return true; // language service contributions and workers
  if (parts[0] === "nls" && parts[1] === "lang") return true; // translations; English is built in
  if (parts[0] === "assets" && LANGUAGE_WORKER.test(parts[1])) return true;
  if (parts.length === 1 && /^lspLanguageFeatures-/.test(parts[0])) return true; // used only by the modes
  return false;
};

// A mode stub: the contributions call setup*() when a model of that language appears.
function modeStub(file) {
  const id = "vs/" + file.replace(/\.js$/, "");
  return `define(${JSON.stringify(id)},["exports"],function(e){"use strict";` +
    `// Stub written by scripts/vendor-monaco.mjs: language services are not included.\n` +
    `var none=function(){return{dispose:function(){}}};var nope=function(){return Promise.reject(new Error("Language services are not included in this copy of Monaco."))};` +
    `e.setupTypeScript=none;e.setupJavaScript=none;e.setupMode=none;e.setupMode1=none;e.getWorker=nope;e.getTypeScriptWorker=nope;e.getJavaScriptWorker=nope;` +
    `Object.defineProperty(e,Symbol.toStringTag,{value:"Module"})});\n`;
}

fs.rmSync(out, { recursive: true, force: true });
const written = [];
function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    const rel = path.relative(src, abs).split(path.sep).join("/");
    if (dropped(rel)) continue;
    if (ent.isDirectory()) {
      walk(abs);
      continue;
    }
    const dest = path.join(outVs, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!rel.includes("/") && MODE.test(ent.name)) fs.writeFileSync(dest, modeStub(ent.name));
    else fs.copyFileSync(abs, dest);
    written.push("vendor/monaco/vs/" + rel);
  }
}
walk(src);

// The icon font is inlined as a data: URL, which the page's CSP (font-src 'self') refuses. Write it to a
// file next to the stylesheet and point the stylesheet at it.
{
  const cssPath = path.join(outVs, "editor", "editor.main.css");
  const css = fs.readFileSync(cssPath, "utf8");
  const m = /url\(data:font\/ttf;base64,([A-Za-z0-9+/=]+)\)/.exec(css);
  if (!m) throw new Error("No inlined codicon font in editor.main.css; check this Monaco build by hand.");
  fs.writeFileSync(path.join(outVs, "editor", "codicon.ttf"), Buffer.from(m[1], "base64"));
  fs.writeFileSync(cssPath, css.replace(m[0], "url(codicon.ttf)"));
  if (/url\(data:font/.test(fs.readFileSync(cssPath, "utf8"))) throw new Error("More than one inlined font in editor.main.css.");
  written.push("vendor/monaco/vs/editor/codicon.ttf");
}

// The editor worker, under a name that does not change between versions (js/review-monaco.js loads it).
const worker = fs.readdirSync(path.join(outVs, "assets")).find((f) => /^editor\.worker-[\w-]+\.js$/.test(f));
if (!worker) throw new Error("No assets/editor.worker-*.js in this Monaco build.");
fs.copyFileSync(path.join(outVs, "assets", worker), path.join(outVs, "editor-worker.js"));
written.push("vendor/monaco/vs/editor-worker.js");

for (const f of ["LICENSE", "ThirdPartyNotices.txt"]) {
  fs.copyFileSync(path.join(pkgDir, f), path.join(out, f));
  written.push("vendor/monaco/" + f);
}

const sha = tarball ? crypto.createHash("sha256").update(fs.readFileSync(tarball)).digest("hex") : null;
const bytes = written.reduce((n, f) => n + fs.statSync(path.join(appDir, f)).size, 0);
fs.writeFileSync(
  path.join(out, "README.md"),
  `# Monaco editor (trimmed)

Served from this site for Dispatch's code review screen, so the page makes no requests to other origins and works offline.

| | |
| --- | --- |
| Library | Monaco editor (\`monaco-editor\` on npm) |
| Version | ${version} |
| Build | \`min/vs\` (AMD) |
| License | MIT (\`LICENSE\`, \`ThirdPartyNotices.txt\`) |
| Tarball SHA-256 | ${sha ? `\`${sha}\`` : "not recorded"} |
| Size | ${(bytes / 1048576).toFixed(1)} MB in ${written.length + 1} files |

Written by \`scripts/vendor-monaco.mjs\`; do not edit by hand. Left out: the TypeScript, CSS, HTML and JSON language services (their modes are stubs that do nothing) and translations. Syntax colors come from Monarch (\`vs/basic-languages\`). The icon font is moved out of \`vs/editor/editor.main.css\` into \`vs/editor/codicon.ttf\` (the page's CSP refuses \`data:\` fonts). \`vs/editor-worker.js\` is a copy of \`vs/assets/editor.worker-*.js\` under a fixed name.

To update: \`npm pack monaco-editor@<version>\` in an empty folder, extract it, then run \`node scripts/vendor-monaco.mjs <folder>/package <tarball>\` and \`node shell/registry.mjs\`.
`,
);
written.push("vendor/monaco/README.md");

// app.json "files": the app's own files, then the vendored copy.
const manifestPath = path.join(appDir, "app.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.files = [...(manifest.files || []).filter((f) => !f.startsWith("vendor/monaco/")), ...written.sort()];
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

console.log(`Monaco ${version}: ${written.length} files, ${(bytes / 1048576).toFixed(1)} MB in apps/agents/vendor/monaco.`);
