// A fake Google sign-in and Google Play Developer API for the connector's tests: one fetch function over in-memory
// apps. The token address checks the signed JWT against the service account's public key; the API checks the access
// token on every call and records what was asked, so tests can say exactly what reached Play. Edits work like
// Play's: changes live in the edit until it is committed, and a deleted edit changes nothing.
import crypto from 'node:crypto';
import zlib from 'node:zlib';

export const PKG = 'org.example.wishlist';
export const OTHER = 'org.example.rally';
export const EMAIL = 'workshop@my-project.iam.gserviceaccount.com';
export const API = 'https://play.test';
export const TOKEN_URL = 'https://oauth2.test/token';
export const SITE = 'https://wishlist.example.test';
export const APP_SIGNING_HEX = 'a1'.repeat(32);

const clone = v => JSON.parse(JSON.stringify(v));

export function fakePlay({ publicKey, email = EMAIL } = {}) {
  const calls = [];
  const issued = new Set();
  let tokenRequests = 0;
  const db = {
    apps: {
      [PKG]: {
        tracks: {
          internal: [{ name: '3 (1.2)', versionCodes: ['3'], status: 'completed', releaseNotes: [{ language: 'en-US', text: 'Lists you can share.' }] }],
          production: [{ name: '2 (1.1)', versionCodes: ['2'], status: 'inProgress', userFraction: 0.2 }]
        },
        bundles: [{ versionCode: 1, sha256: '1'.repeat(64) }, { versionCode: 2, sha256: '2'.repeat(64) }, { versionCode: 3, sha256: '3'.repeat(64) }],
        reviews: [{ reviewId: 'gp:AOqpTOE-1', authorName: 'Sam', comments: [{ userComment: { text: 'Love it, but it crashes on share.', starRating: 4, lastModified: { seconds: '1763500000' }, appVersionCode: 3, appVersionName: '1.2', device: 'pixel8', reviewerLanguage: 'en' } }] }],
        generated: { 3: [{ certificateSha256Hash: Buffer.from(APP_SIGNING_HEX, 'hex').toString('base64') }] },
        draftApp: false, inReview: false, manualReview: false, failTrack: null
      }
    },
    site: { status: 200, type: 'application/json', body: null, location: null }
  };
  const edits = new Map();
  const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const gerr = (status, message, reason = '') => json(status, { error: { code: status, message, status: reason || 'FAILED_PRECONDITION', ...(reason ? { details: [{ reason }] } : {}) } });

  function verifyJwt(assertion) {
    const [h, b, s] = String(assertion).split('.');
    if (!h || !b || !s) return 'malformed';
    if (!crypto.verify('RSA-SHA256', Buffer.from(`${h}.${b}`), publicKey, Buffer.from(s, 'base64url'))) return 'Invalid JWT Signature.';
    const c = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'));
    if (c.iss !== email) return 'wrong iss';
    if (c.aud !== TOKEN_URL) return 'wrong aud';
    if (c.scope !== 'https://www.googleapis.com/auth/androidpublisher') return 'wrong scope';
    if (!(c.exp > c.iat) || c.exp - c.iat > 3600) return 'bad lifetime';
    return null;
  }

  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const method = init.method || 'GET';
    const headers = init.headers || {};
    if (u.origin === 'https://oauth2.test') {
      tokenRequests += 1;
      const form = new URLSearchParams(init.body);
      if (form.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer') return json(400, { error: 'unsupported_grant_type' });
      const bad = verifyJwt(form.get('assertion'));
      if (bad) return json(400, { error: 'invalid_grant', error_description: bad });
      const token = `ya29.test-${tokenRequests}`;
      issued.add(token);
      return json(200, { access_token: token, expires_in: 3599, token_type: 'Bearer' });
    }
    if (u.origin === SITE) {
      calls.push({ method, site: true, path: u.pathname, auth: headers.Authorization });
      if (db.site.location) return new Response('', { status: 301, headers: { location: db.site.location } });
      return new Response(db.site.body === null ? 'not found' : JSON.stringify(db.site.body), { status: db.site.body === null ? 404 : db.site.status, headers: { 'content-type': db.site.type } });
    }
    const upload = u.pathname.startsWith('/upload/');
    const p = u.pathname.replace(/^\/upload/, '').replace(/^\/androidpublisher\/v3/, '');
    const body = init.body && !upload ? JSON.parse(init.body) : undefined;
    const call = { method, path: p, query: Object.fromEntries(u.searchParams), body, upload, bytes: upload ? init.body.length : 0, auth: headers.Authorization };
    calls.push(call);
    if (u.origin !== API) return gerr(599, 'wrong host');
    const auth = String(headers.Authorization || '');
    if (!auth.startsWith('Bearer ') || !issued.has(auth.slice(7))) return gerr(401, 'Request had invalid authentication credentials.', 'UNAUTHENTICATED');

    let m = p.match(/^\/applications\/([^/]+)(\/.*)?$/);
    if (!m) return gerr(404, 'Not found');
    const pkg = decodeURIComponent(m[1]);
    const app = db.apps[pkg];
    if (!app) return gerr(404, `Package not found: ${pkg}.`, 'NOT_FOUND');
    const rest = m[2] || '';

    if (method === 'POST' && rest === '/edits') {
      const id = `edit-${edits.size + 1}`;
      edits.set(id, { pkg, tracks: clone(app.tracks), bundles: clone(app.bundles), open: true });
      return json(200, { id, expiryTimeSeconds: '1763600000' });
    }
    if ((m = rest.match(/^\/edits\/([^/:]+)(.*)$/))) {
      const e = edits.get(decodeURIComponent(m[1]));
      if (!e || !e.open || e.pkg !== pkg) return gerr(404, 'Edit not found.');
      const sub = m[2];
      if (method === 'DELETE' && sub === '') { e.open = false; return new Response(null, { status: 204 }); }
      if (method === 'POST' && sub === ':commit') {
        if (u.searchParams.get('changesInReviewBehavior') !== 'ERROR_IF_IN_REVIEW' && app.inReview) return gerr(500, 'test: the connector would have cancelled a review');
        if (app.inReview) return gerr(400, 'You already have changes in review. Cancel this review or wait for it to complete before you try again.', 'CHANGES_ALREADY_IN_REVIEW');
        if (app.manualReview && u.searchParams.get('changesNotSentForReview') !== 'true') return gerr(400, 'Changes cannot be sent for review automatically. Please set the query parameter changesNotSentForReview to true.');
        app.tracks = e.tracks; app.bundles = e.bundles; e.open = false;
        return json(200, { id: m[1] });
      }
      if (method === 'GET' && sub === '/tracks') return json(200, { kind: 'androidpublisher#tracksListResponse', tracks: Object.entries(e.tracks).map(([track, releases]) => ({ track, releases })) });
      let t;
      if ((t = sub.match(/^\/tracks\/(.+)$/))) {
        const track = decodeURIComponent(t[1]);
        if (method === 'GET') return json(200, { track, releases: e.tracks[track] || [] });
        if (method === 'PUT') {
          if (app.failTrack === track) return gerr(400, `Track ${track} cannot take this release.`);
          for (const r of body.releases) {
            if (app.draftApp && r.status !== 'draft') return gerr(400, 'Only releases with status draft may be created on draft app.');
            for (const vc of r.versionCodes) if (!e.bundles.some(b => String(b.versionCode) === vc)) return gerr(400, `Version code ${vc} has not been uploaded.`);
          }
          // Play's way: a new release on the track replaces the one with the same status family; tests read the result.
          const keep = (e.tracks[track] || []).filter(x => !body.releases.some(r => r.versionCodes.join() === x.versionCodes.join()) && !(x.status === 'completed' && body.releases.some(r => r.status === 'completed')));
          e.tracks[track] = [...keep, ...clone(body.releases)];
          return json(200, body);
        }
      }
      if (method === 'GET' && sub === '/bundles') return json(200, { bundles: e.bundles });
      if (method === 'POST' && sub === '/bundles' && upload) {
        if (u.searchParams.get('uploadType') !== 'media') return gerr(400, 'uploadType must be media in this fake');
        const sha256 = crypto.createHash('sha256').update(init.body).digest('hex');
        const versionCode = Math.max(0, ...e.bundles.map(b => b.versionCode)) + 1;
        e.bundles.push({ versionCode, sha256 });
        return json(200, { versionCode, sha256, sha1: crypto.createHash('sha1').update(init.body).digest('hex') });
      }
      return gerr(404, `No fake for ${method} ${sub}`);
    }
    if (method === 'GET' && rest === '/reviews') return json(200, { reviews: app.reviews.slice(0, Number(u.searchParams.get('maxResults') || 10)) });
    if ((m = rest.match(/^\/reviews\/([^/:]+)(:reply)?$/))) {
      const r = app.reviews.find(x => x.reviewId === decodeURIComponent(m[1]));
      if (!r) return gerr(404, 'Review not found.');
      if (method === 'GET' && !m[2]) return json(200, r);
      if (method === 'POST' && m[2]) { r.comments.push({ developerComment: { text: body.replyText, lastModified: { seconds: '1763600000' } } }); return json(200, { result: { replyText: body.replyText } }); }
    }
    if ((m = rest.match(/^\/generatedApks\/(\d+)$/)) && method === 'GET') return json(200, { generatedApks: app.generated[m[1]] || [] });
    return gerr(404, `No fake for ${method} ${rest}`);
  }

  return {
    db, calls, fetchImpl, edits,
    get tokenRequests() { return tokenRequests; },
    /** Calls that change something on Play: uploads, track updates, commits and replies. */
    writes: () => calls.filter(c => c.upload || (c.method === 'PUT') || /:commit$|:reply$/.test(c.path || '')),
    openEdits: () => [...edits.values()].filter(e => e.open).length
  };
}

// ---- a tiny app bundle: a zip with aapt2's protobuf manifest (Resources.proto field numbers)

const varint = n => { const out = []; let v = BigInt(n); do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; out.push(b); } while (v); return Buffer.from(out); };
const field = (n, buf) => Buffer.concat([varint((n << 3) | 2), varint(buf.length), buf]);
const vfield = (n, v) => Buffer.concat([varint(n << 3), varint(v)]);
const s = t => Buffer.from(t, 'utf8');

/** An XmlAttribute: name, value text, and (optionally) only a compiled whole number instead of the text. */
function attr(name, value, { ns = 'http://schemas.android.com/apk/res/android', compiledOnly = false } = {}) {
  const parts = [ns ? field(1, s(ns)) : Buffer.alloc(0), field(2, s(name))];
  if (compiledOnly) parts.push(field(6, field(7, vfield(6, Number(value))))); // Item.prim.int_decimal_value
  else parts.push(field(3, s(String(value))));
  return field(4, Buffer.concat(parts));
}

/** aapt2's protobuf AndroidManifest.xml for a package. */
export function manifestProto({ packageName = PKG, versionCode = 4, versionName = '1.3', compiledOnly = false } = {}) {
  const element = Buffer.concat([
    field(3, s('manifest')),
    attr('versionCode', versionCode, { compiledOnly }),
    attr('versionName', versionName),
    attr('package', packageName, { ns: '' }),
    field(5, field(1, field(3, s('application')))) // a child element
  ]);
  return field(1, element);
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k += 1) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A zip of {name: Buffer} entries; names ending in .xml are deflated, the rest stored. */
export function zip(entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, data] of Object.entries(entries)) {
    const deflate = name.endsWith('.xml');
    const comp = deflate ? zlib.deflateRawSync(data) : data;
    const n = s(name), crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(deflate ? 8 : 0, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    locals.push(lh, n, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(deflate ? 8 : 0, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, n);
    offset += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
/** A whole little .aab. */
export const bundle = opts => zip({ 'BundleConfig.pb': Buffer.from([8, 1]), 'base/manifest/AndroidManifest.xml': manifestProto(opts), 'base/dex/classes.dex': Buffer.from('dex\n035\0') });
