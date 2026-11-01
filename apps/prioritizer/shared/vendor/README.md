# Vendored libraries

Third-party code served from this site, so pages make no requests to other origins.

| File | Library | Version | Source | License |
| --- | --- | --- | --- | --- |
| `xlsx.full.min.js` | SheetJS Community Edition | 0.20.3 | https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js | Apache 2.0 (`LICENSE-SheetJS.txt`) |

SHA-256 of `xlsx.full.min.js`: `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41`

## Updating SheetJS

1. Check the current version at https://docs.sheetjs.com/docs/getting-started/installation/standalone.
2. Download `xlsx.full.min.js` from the official SheetJS CDN (`cdn.sheetjs.com`). Do not use the `xlsx` package on npm: it stopped at 0.18.5, which is affected by CVE-2023-30533 and CVE-2024-22363.
3. Replace the file here, update the version and SHA-256 above, and bump `CACHE` in `sw.js`.
4. Run `python tests/e2e.py`; it covers Excel export and import.
