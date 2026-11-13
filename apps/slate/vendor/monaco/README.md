# Monaco editor (trimmed)

Served from this site for Dispatch's code review screen, so the page makes no requests to other origins and works offline.

| | |
| --- | --- |
| Library | Monaco editor (`monaco-editor` on npm) |
| Version | 0.57.0 |
| Build | `min/vs` (AMD) |
| License | MIT (`LICENSE`, `ThirdPartyNotices.txt`) |
| Tarball SHA-256 | `3ea1712fbacd3290cf4751007e3a5b57cc279767607812d4c3e57925fb0b05c2` |
| Size | 5.7 MB in 117 files |

Written by `scripts/vendor-monaco.mjs`; do not edit by hand. Left out: the TypeScript, CSS, HTML and JSON language services (their modes are stubs that do nothing) and translations. Syntax colors come from Monarch (`vs/basic-languages`). The icon font is moved out of `vs/editor/editor.main.css` into `vs/editor/codicon.ttf` (the page's CSP refuses `data:` fonts). `vs/editor-worker.js` is a copy of `vs/assets/editor.worker-*.js` under a fixed name.

To update: `npm pack monaco-editor@<version>` in an empty folder, extract it, then run `node scripts/vendor-monaco.mjs <folder>/package <tarball>` and `node shell/registry.mjs`.
