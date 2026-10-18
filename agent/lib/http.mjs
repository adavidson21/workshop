// HTTP helpers shared by the agent's routes: the error type, JSON and HTML responses, and body reading.
// Error codes and statuses come from docs/agent-api.md (Errors).

export const STATUS_FOR = {
  bad_request: 400, invalid_config: 400, confirm_required: 400, downgrade: 400, unauthorized: 401, forbidden: 403,
  local_only: 403, not_found: 404, method_not_allowed: 405, conflict: 409, too_large: 413, disabled: 503, unavailable: 503, internal: 500
};

export const MB = 1024 * 1024;

export class HttpError extends Error {
  /**
   * @param {keyof STATUS_FOR} code
   * @param {string} message plain words a person can read
   * @param {object} [extra] more fields for the error body (for example `current` on a conflict)
   */
  constructor(code, message, extra) {
    super(message);
    this.code = code;
    this.status = STATUS_FOR[code];
    this.extra = extra;
  }
}

export const fail = (code, message, extra) => { throw new HttpError(code, message, extra); };

const API_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

/** Send a JSON body with the headers every /api/* response carries. */
export function sendJson(res, status, body, extra = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text), ...API_HEADERS, ...extra });
  res.end(text);
}

/** Send an HTML page that may never be framed (the pair page). */
export function sendHtml(res, status, body, extra = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...API_HEADERS,
    'Content-Security-Policy': "frame-ancestors 'none'", 'X-Frame-Options': 'DENY', ...extra
  });
  res.end(body);
}

/** Send a short plain-text error for non-API paths. */
export function sendText(res, status, text, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(text), ...API_HEADERS, ...extra });
  res.end(text);
}

const DRAIN_CAP = 64 * MB;

/**
 * Read and discard the rest of a request body, so an early error response reaches the client. If the
 * response is sent while the client is still uploading, Windows resets the connection and the client sees
 * ECONNRESET instead of the error. Bodies more than 64 MB past that point are cut off.
 */
export function drain(req) {
  return new Promise(resolve => {
    if (req.complete || req.readableEnded || req.destroyed) { resolve(); return; }
    let size = 0;
    req.on('data', c => { size += c.length; if (size > DRAIN_CAP) { req.destroy(); resolve(); } });
    req.on('end', resolve);
    req.on('close', resolve);
    req.on('error', resolve);
    req.resume();
  });
}

/**
 * Read a JSON body up to `limit` bytes. Resolves undefined for an empty body.
 * Rejects with too_large or bad_request as HttpError.
 */
export function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => new HttpError('too_large', `The request is larger than ${limit / MB} MB.`);
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) { drain(req).then(() => reject(tooLarge())); return; }
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { over = true; chunks.length = 0; } else chunks.push(c);
      if (size > limit + DRAIN_CAP) req.destroy();
    });
    req.on('end', () => {
      if (over) { reject(tooLarge()); return; }
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) { resolve(undefined); return; }
      try { resolve(JSON.parse(text)); } catch { reject(new HttpError('bad_request', 'The request body is not valid JSON.')); }
    });
    req.on('close', () => { if (over) reject(tooLarge()); });
    req.on('error', reject);
  });
}

/** Parse the Cookie header into an object. */
export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore a malformed cookie */ }
  }
  return out;
}

export const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
