# Receipts

Keep the receipts for performance reviews. Full guide and source of truth: [adavidson21/receipts](https://github.com/adavidson21/receipts). This folder is a copy of that repo's `apps/receipts/`.

- **Me**: your own receipts for a self review. Star the ones that should lead your review.
- **Reports**: one page per direct report (wins, feedback given, growth areas, concerns). Anyone with nothing noted in 30 days is flagged.
- **Upward**: optional, turned on in Receipts' Settings. Support received, asks, and feedback for your manager.
- **From Docket**: finished tasks ticked in Docket's Wrap up wait at the top of Me to accept or dismiss.
- **From 1:1s**: wins logged after a 1:1 wait on that report's page (and in Me, with their name). Accepted, they become receipts about that report.
- **People**: inside Workshop, reports and your manager come from People in Workshop's Settings (`settings.people`, workshop `docs/people.md`). Receipts' own `people` is used only where that directory does not exist.
- **Review**: coverage per review section, gaps called out, and a plain-text draft to copy, plus CSV.

`N` focuses the new-receipt box, `Ctrl+Enter` saves. Palette commands: Add a receipt, Build a review.

Data: collections `entries`, `people` and `config` under the `receipts` app, through the SDK like every other app. Reads (never writes) Workshop's `settings.people` directory and the `handoffs` offers of Docket (`prioritizer.handoffs`) and 1:1s (`oneonones.handoffs`) (workshop `docs/handoffs.md`). An offer's `payload.about` may name one of your reports (`p_...`); otherwise it is about you. No connectors, no network.
