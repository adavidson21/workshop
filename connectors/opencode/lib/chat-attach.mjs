// opencode connector: PDF attachments in Chat (connector 1.29.0, Chat 4.1.0, docs/chat.md, Attachments).
//
// Workshop's agent takes 1 MB per request, so a PDF comes in pieces: chat.attach appends each piece (base64) to a
// file in the data folder, <dataDir>/chat/attachments/<id>.part (mode 0600), and the message that carries it
// (chat.start, chat.send) names the ids. The connector then sends the PDF to opencode as a file part (a data: URL,
// as pictures go) and deletes the file. Pieces nobody sent within an hour are deleted on the next attach.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ctx, httpError } from "./context.mjs";

export const MAX_PDF = 20 * 1024 * 1024; // bytes, one PDF
export const MAX_PIECE = 700000; // base64 characters per chat.attach call
export const MAX_ATTACHMENTS = 3;
export const STALE_MS = 60 * 60 * 1000;
export const TYPES = { "application/pdf": (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" };

let dirOverride = null;
/** Tests point attachments at a temp folder. */
export function resetAttachments(dir = null) { dirOverride = dir; }
function root() {
  if (dirOverride) return dirOverride;
  if (!ctx || !ctx.dataDir) throw httpError(503, "Attachments need Workshop's data folder. Restart Workshop and try again.");
  return path.join(ctx.dataDir, "chat", "attachments");
}
const fileOf = (id) => {
  if (!/^a[0-9a-f]{24}$/.test(String(id || ""))) throw httpError(400, "That attachment is not one Chat started.");
  return path.join(root(), `${id}.part`);
};
const cleanName = (name) => String(name || "").replace(/[^A-Za-z0-9 ._()-]/g, "").trim().slice(0, 80) || "attachment.pdf";

function sweep(now = Date.now()) {
  let names = [];
  try { names = fs.readdirSync(root()); } catch { return; }
  for (const n of names) {
    if (!/^a[0-9a-f]{24}\.(part|json)$/.test(n)) continue;
    const f = path.join(root(), n);
    try { if (now - fs.statSync(f).mtimeMs > STALE_MS) fs.rmSync(f, { force: true }); } catch { /* gone */ }
  }
}

/**
 * One piece of an attachment. The first call names the type and file name and gets an id back; later calls pass the
 * id. Returns {id, bytes}. The finished file is checked when the message that carries it is sent.
 */
export function attachPiece({ id, name, mime, data }, now = Date.now()) {
  const b64 = String(data || "");
  if (!b64 || b64.length > MAX_PIECE || b64.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw httpError(400, "That piece of the file could not be read.");
  const buf = Buffer.from(b64, "base64");
  let file;
  if (!id) {
    if (!TYPES[mime]) throw httpError(400, "Chat attaches PDFs (and pictures, which go with the message). Save other files in the workspace and type @ to add them.");
    if (!TYPES[mime](buf)) throw httpError(400, "That file is not a PDF.");
    sweep(now);
    fs.mkdirSync(root(), { recursive: true, mode: 0o700 });
    id = "a" + crypto.randomBytes(12).toString("hex");
    file = fileOf(id);
    fs.writeFileSync(path.join(root(), `${id}.json`), JSON.stringify({ name: cleanName(name), mime }), { mode: 0o600 });
    fs.writeFileSync(file, buf, { mode: 0o600 });
  } else {
    file = fileOf(id);
    if (!fs.existsSync(file)) throw httpError(404, "That attachment is gone. Attach the file again.");
    if (fs.statSync(file).size + buf.length > MAX_PDF) throw httpError(413, `A PDF can be up to ${MAX_PDF / 1024 / 1024} MB.`);
    fs.appendFileSync(file, buf);
  }
  return { id, bytes: fs.statSync(file).size };
}

/** The attachments a message names, read and checked: [{mime, name, data (base64)}]. They are deleted once sent (dropAttachments). */
export function readAttachments(list) {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > MAX_ATTACHMENTS) throw httpError(400, `Up to ${MAX_ATTACHMENTS} PDFs in one message.`);
  return list.map((a) => {
    const id = a && typeof a === "object" ? a.id : a;
    const file = fileOf(id);
    let meta, buf;
    try { meta = JSON.parse(fs.readFileSync(path.join(root(), `${id}.json`), "utf8")); buf = fs.readFileSync(file); } catch { throw httpError(404, "An attachment is gone. Attach the file again."); }
    if (!TYPES[meta.mime] || !TYPES[meta.mime](buf)) throw httpError(400, "That attachment is not a PDF.");
    if (buf.length > MAX_PDF) throw httpError(413, `A PDF can be up to ${MAX_PDF / 1024 / 1024} MB.`);
    return { id, mime: meta.mime, name: cleanName(meta.name), data: buf.toString("base64") };
  });
}
export function dropAttachments(list) {
  for (const a of list || []) {
    for (const ext of ["part", "json"]) { try { fs.rmSync(path.join(root(), `${a.id}.${ext}`), { force: true }); } catch { /* gone */ } }
  }
}
