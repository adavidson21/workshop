# Vendored libraries (Chat)

Third-party code served from this site for Chat's terminal (Chat 4.0.0), so the page makes no requests to other origins. `SHA256SUMS` pins every file; `node tests/check-vendor.mjs` checks it in CI ([shared/vendor/README.md](../../../shared/vendor/README.md), Hashes).

| File | Library | Version | Source | License |
| --- | --- | --- | --- | --- |
| `xterm/xterm.mjs`, `xterm/xterm.css` | xterm.js (`@xterm/xterm` on npm), the terminal | 6.0.0 | `lib/xterm.mjs` and `css/xterm.css` of the npm package | MIT (`xterm/LICENSE`) |
| `xterm/addon-fit.mjs` | `@xterm/addon-fit`, sizes the terminal to its box | 0.11.0 | `lib/addon-fit.mjs` of the npm package | MIT (`xterm/LICENSE-addon-fit`) |

npm tarball SHA-256: `@xterm/xterm-6.0.0.tgz` `908e66e04af6c8dc6b00dd3b54de088e2e81e5ed866284fd6c2fb3c2d1c7a3f6`, `@xterm/addon-fit-0.11.0.tgz` `26003b4517a132b64e4ff228fd88a5fda3fff5e606c76093f6dcff772e9ecec0`.

The files are copied unchanged (their `sourceMappingURL` comments point at maps that are not shipped; browsers only fetch those with developer tools open). Monaco, which Chat's Files use, is shared with Loom in `shared/vendor/monaco/`.

## Updating xterm.js

1. `npm pack @xterm/xterm@<version> @xterm/addon-fit@<version>` in an empty folder and extract both.
2. Copy `lib/xterm.mjs`, `css/xterm.css`, `lib/addon-fit.mjs` and both `LICENSE` files here, and update the table and tarball hashes above.
3. Run `node tests/check-vendor.mjs --write` and check that only these files moved, then bump `CACHE` in `sw.js`.
