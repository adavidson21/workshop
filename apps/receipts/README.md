# Receipts

Keep the receipts for performance reviews. Write down what you did as it happens, tag it with your review form's sections, and when review season comes, Receipts turns it into a draft grouped by section, with the gaps called out.

Live at **https://receipts.alexisdavidson.org**. Also an app inside [Workshop](https://github.com/adavidson21/workshop).

Successor to [TaskLedger](https://github.com/adavidson21/TaskLedger), the Android brag-book app. Receipts drops the AI and email steps so nothing ever leaves your device.

## What it does

- **Me** (the main area): your own receipts for a self review. Wins, feedback you received, things you learned, blockers, notes. Star the ones you want at the top of your review.
- **Reports**: one page per direct report. Wins, feedback you gave, growth areas, and concerns. The list flags anyone you haven't noted anything about in 30 days (configurable).
- **Upward** (optional, off until you turn it on): support you got from your manager, asks, and feedback to share, for upward reviews and skip-levels.
- **Review**: pick who and a period (your review cycle, this quarter, last quarter, this year, last 12 months). Shows coverage per section, flags sections with no receipts, and builds a plain-text draft you can copy or download. CSV export too.
- **From Docket** (inside Workshop): finished tasks you ticked in Docket's Wrap up wait at the top of Me. Edit the line or kind, then **Accept** (it becomes a receipt dated that day, evidence "From Docket") or **Dismiss**. Receipts reads Docket's offers but never changes Docket's data, and remembers what you handled in its own settings (Workshop's [handoffs contract](https://github.com/adavidson21/workshop/blob/main/docs/handoffs.md)).
- **Settings**: your review cycle dates, your company's review sections (one per line), backups.

Shortcuts: `N` jumps to the box for a new receipt, `Ctrl+Enter` saves it.

## Privacy: nothing leaves the device

- No accounts, no server, no analytics, no AI, no third-party requests. Fonts are self-hosted.
- The page's Content Security Policy only allows requests to this site itself, plus Workshop on `127.0.0.1` if you pair it. The Worker sends the same CSP as a header.
- Receipts are saved in this browser (IndexedDB) by default. In Chrome or Edge you can **Save to a folder** in Settings to keep them as JSON files on your computer instead, which you can back up however your company allows.
- **Back up** downloads a JSON file; **Restore** merges one back in and never deletes anything.
- Inside Workshop, Receipts uses Workshop's storage (browser, folder, or the Workshop agent on your computer).

Browser storage is per site: receipts saved on receipts.alexisdavidson.org are not visible on workshop.alexisdavidson.org unless both use the same folder (or you back up and restore).

## How it is built

Plain HTML, CSS and JavaScript modules. No build step, no dependencies.

```
apps/receipts/          the app (a Workshop app: app.json, index.html, app.css, js/)
  js/state.js           pure logic: periods, filters, review builder, CSV, offers from other apps
  js/main.js            the page: rendering, input, data through the SDK
shared/                 copied from the workshop repo: the SDK (storage), themes, fonts, top bar
worker/index.js         Cloudflare Worker: serves apps/receipts/ at "/" and adds security headers
sw.js                   service worker: install as an app, open offline
apps/receipts/test/      node tests for state.js (test/ has the Worker routing test)
```

Data uses Workshop's envelope format (three collections: `entries`, `people`, `config`; `config.meta.handled` lists offers already accepted or dismissed) with change stamps, so two open windows merge instead of overwriting each other.

`shared/` is a copy of the workshop repo's `shared/`. When Workshop's SDK or themes change, copy them over again.

### Run it locally

```bash
npm test          # node 22+
npm run dev       # serves on http://localhost:8080, then open /apps/receipts/
```

### Deploy

```bash
npx wrangler deploy
```

The Worker is named `receipts` and serves the custom domain `receipts.alexisdavidson.org` (see `wrangler.jsonc`).

### Updating the copy in Workshop

Workshop carries a copy of `apps/receipts/`. After changing the app here, copy the folder into the workshop repo's `apps/receipts/` and run `node shell/registry.mjs` there.
