/* Dispatch: the .work file sheet's editor, pure parts. No DOM, so Node tests import them (test/doc.test.mjs).

   docHtml (now shared/doc-html.js, so Tasks shows the same previews) renders a Tandem document (plan.md, spec.md, review.md...) for the sheet's Preview. Every character is
   escaped first; the only markup is what this file writes. Supported: headings, paragraphs, fenced code, block
   quotes, bullet, numbered and task lists (one level of nesting by indent), pipe tables, rules, `code`, **bold**,
   *italic*, ~~strike~~ and [text](https://...) links, which open in a new tab. Any other link is plain text.
   HTML comments are dropped. The full renderer is Notes' (app id notes): Open in Notes.

   lockReason says why the open file can't be edited right now (Tandem is working on it). */
export { docHtml } from '../../../../shared/doc-html.js';

/** Why the file can't be edited right now, or ''. it: the item (or null for a folder the model no longer has);
    busy: its session is working; auto: autopilot is running it. */
export function lockReason({ busy, auto }) {
  if (auto) return 'Autopilot is running this item, so the file is read-only until it stops.';
  if (busy) return 'Tandem is working on this item, so the file is read-only until it stops.';
  return '';
}

/** The Notes route for a .work file (Notes' manifest route tandem/:folder/:file). */
export function notebookRoute(folder, file) {
  return 'tandem/' + encodeURIComponent(folder) + '/' + encodeURIComponent(file);
}
