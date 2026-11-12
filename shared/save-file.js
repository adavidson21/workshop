/* Give the user a file to keep: a backup, an Excel copy, a report. A normal browser download, so the file goes
   only where the user saves it.

     import { saveFile } from '../../shared/save-file.js';
     await saveFile('workshop-2026-10-31.json', text, 'application/json');   // text, Uint8Array or ArrayBuffer

   Resolves to 'downloaded'. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const asBytes = (data) => (data instanceof Uint8Array ? data : new Uint8Array(data));

/**
 * @param {string} name   file name only, no folders
 * @param {string|Uint8Array|ArrayBuffer} data
 * @param {string} type   media type, for the download
 */
export async function saveFile(name, data, type) {
  if (!SAFE_NAME.test(name)) throw new Error('That is not a file name Workshop saves.');
  const url = URL.createObjectURL(new Blob([typeof data === 'string' ? data : asBytes(data)], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}
