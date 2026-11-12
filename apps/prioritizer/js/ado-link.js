/* Prioritizer: ADO work item links in pasted text. Pure, so the tests can run it in Node.
   ADO's "Copy to clipboard" on a work item puts "Issue 12345: Title" on the clipboard as plain text, with the
   link only in the HTML version. A plain input keeps just the text, so the paste handler (js/paste.js) reads the
   HTML, finds the link, and keeps it on the task as t.ado with pasted: true. */

// Work item id from an ADO URL: .../_workitems/edit/123, ..._workitems?id=123, or a board/backlog ?workitem=123.
function adoFromUrl(url){
  let u;
  try { u = new URL(String(url || '').trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const parts = u.pathname.split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return s; } });
  let id = null;
  const wi = parts.findIndex(p => p.toLowerCase() === '_workitems');
  if (wi >= 0){
    if ((parts[wi + 1] || '').toLowerCase() === 'edit') id = parts[wi + 2];
    else id = u.searchParams.get('id');
  }
  if (!id) id = u.searchParams.get('workitem');
  id = parseInt(id, 10);
  if (!(id > 0) || String(id).length > 10) return null;
  const ui = parts.findIndex(p => p.startsWith('_'));
  const project = ui > 0 ? parts[ui - 1] : '';
  return {id, url: u.href, project};
}

// "Issue 12345: Title", "User Story 12345: Title", "Bug #12345 - Title". Returns {type, id, title} or null.
function parseItemText(text){
  const m = String(text || '').trim().match(/^([A-Za-z][A-Za-z ]{0,40}?)\s+#?(\d{1,10})\s*[:\-]\s*(.+)$/s);
  if (!m) return null;
  return {type: m[1].trim(), id: +m[2], title: m[3].replace(/\s+/g, ' ').trim()};
}

// First ADO work item link in an HTML fragment. Regex, not DOMParser, so it runs in Node too.
function adoFromHtml(html){
  const re = /<a\b[^>]*?href\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let m;
  while ((m = re.exec(String(html || '')))){
    const href = (m[2] ?? m[3] ?? '').replace(/&amp;/g, '&');
    const a = adoFromUrl(href);
    if (a) return a;
  }
  return null;
}

/* What a paste brings: {text, ado} where text is what goes in the box and ado is the link to keep ({id, type,
   url, project, pasted: true}), or null when the paste has no ADO work item link. */
function adoFromPaste(plain, html){
  plain = String(plain || '').replace(/\s+/g, ' ').trim();
  const fromUrl = adoFromUrl(plain);
  if (fromUrl) return {text: `ADO ${fromUrl.id}: `, ado: {...fromUrl, type: '', pasted: true}};
  const link = adoFromHtml(html);
  if (!link) return null;
  const parsed = parseItemText(plain);
  const type = parsed && parsed.id === link.id ? parsed.type : '';
  return {text: plain, ado: {...link, type, pasted: true}};
}

export { adoFromHtml, adoFromPaste, adoFromUrl, parseItemText };
