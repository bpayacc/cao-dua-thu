/**
 * tests/server/fakeFirestore.mjs — Firestore Admin giả lập trong bộ nhớ, đủ để chạy mã nghiệp vụ thật.
 * Mô phỏng điều quan trọng nhất: transaction lạc quan (optimistic) — nếu tài liệu đã đọc bị đổi
 * trước khi commit thì transaction được chạy lại, giống Firestore thật. Nhờ đó test được các
 * tình huống bấm lặp / gửi đồng thời. (KHÔNG thay thế việc kiểm thử với Firebase thật.)
 */
export class FakeFirestore {
  constructor() { this.docs = new Map(); this.versions = new Map(); this.commits = 0; this.autoId = 0; this.hooks = []; }

  collection(name) { return new CollectionRef(this, name); }
  doc(path) { return new DocRef(this, path); }
  seed(path, data) { this.docs.set(path, structuredClone(data)); this.versions.set(path, 1); }
  get(path) { return this.docs.has(path) ? structuredClone(this.docs.get(path)) : undefined; }
  list(prefix) { return [...this.docs.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ path: k, data: this.get(k) })); }

  async runTransaction(fn, attempts = 8) {
    for (let i = 0; i < attempts; i += 1) {
      const reads = new Map(); const writes = [];
      const tx = {
        get: async (ref) => {
          await Promise.resolve(); // nhường lượt để các transaction đồng thời xen kẽ
          reads.set(ref.path, this.versions.get(ref.path) || 0);
          return new Snap(ref, this.docs.get(ref.path));
        },
        set: (ref, data) => { if (writes.length === 0 && false) return; writes.push(['set', ref, data]); },
        update: (ref, data) => writes.push(['update', ref, data]),
        create: (ref, data) => writes.push(['create', ref, data]),
      };
      const result = await fn(tx);
      await Promise.resolve();
      // kiểm tra xung đột: mọi tài liệu đã đọc phải còn nguyên phiên bản
      const conflict = [...reads].some(([path, v]) => (this.versions.get(path) || 0) !== v);
      if (conflict) continue;
      // áp dụng ghi (nguyên tử: kiểm tra trước, ghi sau)
      for (const [op, ref] of writes) {
        if (op === 'create' && this.docs.has(ref.path)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 });
        if (op === 'update' && !this.docs.has(ref.path)) throw Object.assign(new Error('NOT_FOUND'), { code: 5 });
      }
      for (const [op, ref, data] of writes) {
        const next = op === 'update' ? { ...this.docs.get(ref.path), ...data } : { ...data };
        this.docs.set(ref.path, structuredClone(next));
        this.versions.set(ref.path, (this.versions.get(ref.path) || 0) + 1);
      }
      this.commits += 1;
      return result;
    }
    throw new Error('Transaction thất bại sau nhiều lần thử');
  }
}

class Snap {
  constructor(ref, data) { this.ref = ref; this.id = ref.id; this._d = data; }
  get exists() { return this._d !== undefined; }
  data() { return this._d === undefined ? undefined : structuredClone(this._d); }
}

class DocRef {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split('/').pop(); }
  collection(name) { return new CollectionRef(this.db, `${this.path}/${name}`); }
  async get() { return new Snap(this, this.db.docs.get(this.path)); }
}

class CollectionRef {
  constructor(db, path) { this.db = db; this.path = path; this.filters = []; this.max = Infinity; }
  doc(id) { return new DocRef(this.db, `${this.path}/${id ?? `auto${++this.db.autoId}`}`); }
  where(field, op, value) { const c = new CollectionRef(this.db, this.path); c.filters = [...this.filters, [field, op, value]]; c.max = this.max; return c; }
  limit(n) { const c = new CollectionRef(this.db, this.path); c.filters = this.filters; c.max = n; return c; }
  async get() {
    const depth = this.path.split('/').length + 1;
    let rows = [...this.db.docs.entries()].filter(([k]) => k.startsWith(`${this.path}/`) && k.split('/').length === depth);
    for (const [f, , v] of this.filters) rows = rows.filter(([, d]) => d[f] === v);
    rows = rows.slice(0, this.max);
    const docs = rows.map(([k, d]) => new Snap(new DocRef(this.db, k), d));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}
