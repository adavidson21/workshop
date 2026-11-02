// An in-memory stand-in for Capacitor's Filesystem plugin as the native bridge sees it
// (window.Capacitor.nativePromise('Filesystem', method, options)), on top of a FakeFolder (fake-dir.mjs).
// The FakeFolder's root is the app's private data folder, so tests can drive it exactly as they drive a
// folder picked in Chrome: write files behind the store's back, change the clock, or remove the folder.
//
//   const fs = new FakeFolder('data');
//   const call = capacitorOver(fs);
//   const root = await openDeviceRoot({ call, base: '' });   // shared/device-fs.js
//
// Errors carry Capacitor's codes and messages (OS-PLUG-FILE-0008 "does not exist"). `rename` refuses an
// existing target when `renameOverwrites` is false, like some Android file systems.
const capError = (code, message) => Object.assign(new Error(message), { code });
const missing = (method, path) => capError('OS-PLUG-FILE-0008', `'${method}' failed because file at '${path}' does not exist.`);
const bytes = (s) => new TextEncoder().encode(s).length;

export function capacitorOver(fs, { renameOverwrites = true, log = null } = {}) {
  const at = (path) => (path ? fs.at(path) : fs.node);
  const live = (n) => { for (let x = n; x; x = x.parent) if (x.detached) return false; return true; };
  const node = (path) => { const n = at(path); return n && live(n) ? n : null; };
  const parentOf = (path) => { const parts = path.split('/'); return { dir: node(parts.slice(0, -1).join('/')), name: parts[parts.length - 1] }; };
  const ops = {
    stat({ path }) {
      const n = node(path);
      if (!n) throw missing('stat', path);
      return n.kind === 'directory'
        ? { type: 'directory', size: 0, mtime: 0, uri: path }
        : { type: 'file', size: bytes(n.content), mtime: n.lastModified, uri: path };
    },
    readFile({ path, encoding }) {
      if (encoding !== 'utf8') throw capError('OS-PLUG-FILE-0005', 'Only utf8 is used by Workshop.');
      const n = node(path);
      if (!n || n.kind !== 'file') throw missing('readFile', path);
      const data = n.content;
      if (fs.onGetFile) fs.onGetFile(path);
      return { data };
    },
    async writeFile({ path, data, encoding }) {
      if (encoding !== 'utf8') throw capError('OS-PLUG-FILE-0005', 'Only utf8 is used by Workshop.');
      const { dir, name } = parentOf(path);
      if (!dir || dir.kind !== 'directory') throw capError('OS-PLUG-FILE-0011', 'Missing parent directory.');
      const prev = dir.children.get(name);
      if (prev && prev.kind === 'directory') throw capError('OS-PLUG-FILE-0009', "'writeFile' not supported for directories.");
      const lastModified = fs.step === 0 && prev ? prev.lastModified : fs.tick();
      dir.children.set(name, { kind: 'file', name, content: data, lastModified, parent: dir });
      fs.writes++;
      return { uri: path };
    },
    deleteFile({ path }) {
      const n = node(path);
      if (!n) throw missing('deleteFile', path);
      if (n.kind === 'directory') throw capError('OS-PLUG-FILE-0009', "'deleteFile' not supported for directories.");
      n.parent.children.delete(n.name); n.detached = true;
    },
    mkdir({ path, recursive }) {
      if (node(path)) throw capError('OS-PLUG-FILE-0010', `Directory at '${path}' already exists, cannot be overwritten.`);
      const parts = path.split('/');
      let d = fs.node;
      if (!live(d)) throw missing('mkdir', path);
      for (let i = 0; i < parts.length; i++) {
        let c = d.children.get(parts[i]);
        if (!c) {
          if (i < parts.length - 1 && !recursive) throw capError('OS-PLUG-FILE-0011', 'Missing parent directory.');
          c = { kind: 'directory', name: parts[i], children: new Map(), parent: d };
          d.children.set(parts[i], c);
        }
        d = c;
      }
    },
    readdir({ path }) {
      const n = node(path);
      if (!n || n.kind !== 'directory') throw missing('readdir', path);
      return { files: [...n.children.values()].map(c => ({ name: c.name, type: c.kind, size: c.kind === 'file' ? bytes(c.content) : 0, mtime: c.lastModified || 0, uri: `${path}/${c.name}` })) };
    },
    async rename({ from, to }) {
      const src = node(from);
      if (!src) throw missing('rename', from);
      const { dir, name } = parentOf(to);
      if (!dir) throw capError('OS-PLUG-FILE-0011', 'Missing parent directory.');
      const prev = dir.children.get(name);
      if (prev && !renameOverwrites) throw capError('OS-PLUG-FILE-0013', "'rename' failed with: destination exists");
      if (fs.beforeWrite) await fs.beforeWrite(to);
      if (!live(dir)) throw missing('rename', to);
      // Like a rename on disk, the moved file keeps its own modified time; a clock that does not move keeps the old one.
      const lastModified = fs.step === 0 && prev && prev.kind === 'file' ? prev.lastModified : src.lastModified;
      src.parent.children.delete(src.name);
      dir.children.set(name, { kind: 'file', name, content: src.content, lastModified, parent: dir });
    }
  };
  return async (method, options) => {
    if (log) log.push([method, options.path || options.from]);
    if (options.directory !== 'DATA') throw capError('OS-PLUG-FILE-0006', 'Workshop only uses the app data folder.');
    const op = ops[method];
    if (!op) throw capError('UNIMPLEMENTED', `${method} is not implemented.`);
    return op(options);
  };
}
