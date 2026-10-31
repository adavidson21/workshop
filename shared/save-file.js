/* Give the user a file to keep: a backup, an Excel copy, a report.

   In a browser this is a normal download. In the Android app (android/) a WebView cannot download, so the
   file is written to the app's cache and handed to Android's share sheet, where the user picks where it goes
   (Files, Drive, email). Either way the file goes only where the user sends it.

     import { saveFile } from '../../shared/save-file.js';
     await saveFile('workshop-2026-10-31.json', text, 'application/json');   // text, Uint8Array or ArrayBuffer

   Resolves to 'downloaded', 'shared' or 'canceled' (the user closed the share sheet). */
import { deviceAvailable } from './device-fs.js';

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const asBytes = (data) => (data instanceof Uint8Array ? data : new Uint8Array(data));

/**
 * @param {string} name   file name only, no folders
 * @param {string|Uint8Array|ArrayBuffer} data
 * @param {string} type   media type, for the download
 * @param {{native?: (plugin: string, method: string, options: object) => Promise<any>}} [o] tests pass `native`
 */
export async function saveFile(name, data, type, o = {}) {
  if (!SAFE_NAME.test(name)) throw new Error('That is not a file name Workshop saves.');
  const native = o.native || (deviceAvailable() ? (p, m, opts) => window.Capacitor.nativePromise(p, m, opts) : null);
  if (native) {
    // Text as UTF-8, anything else as base64 (Capacitor writes base64 when no encoding is given).
    const written = await native('Filesystem', 'writeFile', typeof data === 'string'
      ? { path: name, directory: 'CACHE', data, encoding: 'utf8' }
      : { path: name, directory: 'CACHE', data: toBase64(asBytes(data)) });
    try {
      await native('Share', 'share', { title: name, files: [written.uri], dialogTitle: `Save ${name}` });
      return 'shared';
    } catch (e) {
      if (/cancel/i.test((e && e.message) || '')) return 'canceled';
      throw e;
    }
  }
  const url = URL.createObjectURL(new Blob([typeof data === 'string' ? data : asBytes(data)], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}
