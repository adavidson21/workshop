// An in-memory stand-in for a folder picked in Chrome (FileSystemDirectoryHandle and FileSystemFileHandle),
// with just the methods the SDK's folder store uses. Tests drive it like another program would: write files
// behind the store's back, change the clock, take the permission away, or remove the folder.
//
//   const fs = new FakeFolder('Workshop');
//   const root = fs.root;                    // pass to the folder store
//   fs.write('notes/pages.json', text);      // a change made outside Workshop
//   fs.read('notes/pages.json');             // text, or null
//   fs.permission = 'prompt';                // Chrome must ask again
//   fs.remove();                             // the folder is gone
const err = (name, msg) => new DOMException(msg || name, name);
const bytes = (s) => new TextEncoder().encode(s).length;

export class FakeFolder {
  constructor(name = 'Workshop', { start = 1_000_000, step = 1 } = {}) {
    this.time = start;
    this.step = step;        // how far the clock moves on each write; 0 keeps the same modified time
    this.permission = 'granted';
    this.requestAnswer = 'granted';
    this.writes = 0;
    this.node = { kind: 'directory', name, children: new Map(), parent: null };
    this.root = new FakeDirHandle(this, this.node);
    this.beforeWrite = null; // optional hook(path): runs just before a write lands, to simulate a race
    this.onGetFile = null;   // optional hook(path): runs on every read of a file's state, after it is taken
  }
  tick() { this.time += this.step; return this.time; }
  /** The node at a "/"-separated path, or null. */
  at(path) {
    let n = this.node;
    for (const s of path.split('/').filter(Boolean)) {
      if (!n || n.kind !== 'directory') return null;
      n = n.children.get(s) || null;
    }
    return n;
  }
  read(path) { const n = this.at(path); return n && n.kind === 'file' ? n.content : null; }
  mtime(path) { const n = this.at(path); return n && n.kind === 'file' ? n.lastModified : null; }
  exists(path) { return this.at(path) !== null; }
  /** Write a file as another program would (makes folders). */
  write(path, content, { mtime } = {}) {
    const parts = path.split('/');
    let n = this.node;
    for (const s of parts.slice(0, -1)) {
      if (!n.children.has(s)) n.children.set(s, { kind: 'directory', name: s, children: new Map(), parent: n });
      n = n.children.get(s);
    }
    const name = parts[parts.length - 1];
    n.children.set(name, { kind: 'file', name, content, lastModified: mtime ?? this.tick(), parent: n });
  }
  delete(path) { const n = this.at(path); if (n) { n.parent.children.delete(n.name); n.detached = true; } }
  /** Every file path under the folder, sorted. */
  paths() {
    const out = [];
    const visit = (n, pre) => { for (const [k, c] of n.children) { const p = pre ? `${pre}/${k}` : k; if (c.kind === 'file') out.push(p); else visit(c, p); } };
    visit(this.node, '');
    return out.sort();
  }
  /** The folder is moved or deleted. */
  remove() { this.node.detached = true; }
  check(node) {
    if (this.permission !== 'granted') throw err('NotAllowedError', 'Permission was not granted.');
    for (let n = node; n; n = n.parent) if (n.detached) throw err('NotFoundError', 'A requested file or directory could not be found.');
  }
}

class FakeDirHandle {
  constructor(fs, node) { this.fs = fs; this.node = node; this.kind = 'directory'; this.name = node.name; }
  async queryPermission() { return this.fs.permission; }
  async requestPermission() { this.fs.permission = this.fs.requestAnswer; return this.fs.permission; }
  async getDirectoryHandle(name, { create = false } = {}) {
    this.fs.check(this.node);
    let c = this.node.children.get(name);
    if (c && c.kind !== 'directory') throw err('TypeMismatchError', 'That is a file.');
    if (!c) {
      if (!create) throw err('NotFoundError');
      c = { kind: 'directory', name, children: new Map(), parent: this.node };
      this.node.children.set(name, c);
    }
    return new FakeDirHandle(this.fs, c);
  }
  async getFileHandle(name, { create = false } = {}) {
    this.fs.check(this.node);
    let c = this.node.children.get(name);
    if (c && c.kind !== 'file') throw err('TypeMismatchError', 'That is a folder.');
    if (!c) {
      if (!create) throw err('NotFoundError');
      c = { kind: 'file', name, content: '', lastModified: this.fs.tick(), parent: this.node };
      this.node.children.set(name, c);
    }
    return new FakeFileHandle(this.fs, c, this.node);
  }
  async removeEntry(name) {
    this.fs.check(this.node);
    const c = this.node.children.get(name);
    if (!c) throw err('NotFoundError');
    this.node.children.delete(name);
    c.detached = true;
  }
  async *entries() {
    this.fs.check(this.node);
    for (const [k, c] of [...this.node.children]) yield [k, c.kind === 'directory' ? new FakeDirHandle(this.fs, c) : new FakeFileHandle(this.fs, c, this.node)];
  }
  async *values() { for await (const [, h] of this.entries()) yield h; }
  async *keys() { for await (const [k] of this.entries()) yield k; }
}

class FakeFileHandle {
  constructor(fs, node, dir) { this.fs = fs; this.node = node; this.dir = dir; this.kind = 'file'; this.name = node.name; }
  #live() {
    this.fs.check(this.dir);
    // A handle to a file that was removed (or replaced by another program) finds the current one by name.
    const cur = this.dir.children.get(this.name);
    if (!cur || cur.kind !== 'file') throw err('NotFoundError');
    return cur;
  }
  async getFile() {
    const n = this.#live();
    if (this.fs.onGetFile) this.fs.onGetFile(this.#path());
    const content = n.content;
    return { name: n.name, size: bytes(content), lastModified: n.lastModified, text: async () => content, type: '' };
  }
  async createWritable() {
    this.fs.check(this.dir);
    const fs = this, chunks = [];
    let closed = false;
    return {
      async write(data) {
        if (closed) throw err('InvalidStateError');
        chunks.push(typeof data === 'string' ? data : await data.text());
      },
      async close() {
        closed = true;
        const path = fs.#path();
        if (fs.fs.beforeWrite) await fs.fs.beforeWrite(path);
        fs.fs.check(fs.dir);
        fs.fs.writes++;
        // Moved into place on close, like Chrome's swap file: replaces whatever is at that name now.
        const prev = fs.dir.children.get(fs.name);
        const lastModified = fs.fs.step === 0 && prev && prev.kind === 'file' ? prev.lastModified : fs.fs.tick();
        fs.dir.children.set(fs.name, { kind: 'file', name: fs.name, content: chunks.join(''), lastModified, parent: fs.dir });
      },
      async abort() { closed = true; }
    };
  }
  #path() { const parts = [this.name]; for (let n = this.dir; n && n.parent; n = n.parent) parts.unshift(n.name); return parts.join('/'); }
}
