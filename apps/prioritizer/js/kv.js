/* Prioritizer: a small key-value cache in this browser's IndexedDB (database "prioritizer"). Only for
   things that can be fetched again, like the last Reports data. The board itself is saved through the
   SDK (storage.js), never here. */
function idb(){
  return new Promise((res, rej) => {
    const r = indexedDB.open('prioritizer', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function kvGet(k){
  const db = await idb();
  return new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); });
}
async function kvSet(k, v){
  const db = await idb();
  return new Promise(res => {
    const tx = db.transaction('kv', 'readwrite'), st = tx.objectStore('kv');
    v === undefined ? st.delete(k) : st.put(v, k);
    tx.oncomplete = () => res(); tx.onerror = () => res();
  });
}

export { kvGet, kvSet };
