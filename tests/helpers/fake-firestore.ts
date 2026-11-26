/**
 * In-memory Firestore for server tests, as strict as the real one where it matters:
 *   - writing `undefined` anywhere throws (Admin SDK default);
 *   - a query that would need a composite index throws (two filters, or a filter + orderBy on
 *     another field), like "The query requires an index";
 *   - transactions: reads must come before writes; writes apply only when the callback succeeds.
 * Field paths with dots ("loyalty.memberId") read nested maps.
 */

type Data = Record<string, unknown>;

export function createFakeFirestore() {
  const store = new Map<string, Map<string, Data>>();
  let autoId = 0;

  function col(name: string) {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name)!;
  }

  function assertNoUndefined(value: unknown, path: string) {
    if (value === undefined) {
      throw new Error(`Cannot use "undefined" as a Firestore value (found in field "${path}").`);
    }
    if (value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype) {
      for (const [k, v] of Object.entries(value)) assertNoUndefined(v, path ? `${path}.${k}` : k);
    }
  }

  const clone = <T>(value: T): T => {
    if (value && typeof value === "object" && Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value)) {
      return value; // Timestamps etc. are kept as they are.
    }
    if (Array.isArray(value)) return value.map(clone) as T;
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
    }
    return value;
  };

  const getPath = (data: Data, path: string): unknown =>
    path.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Data)[key] : undefined), data);

  function docRef(collection: string, id: string) {
    const ref = {
      id,
      path: `${collection}/${id}`,
      async get() {
        const data = col(collection).get(id);
        return { id, ref, exists: data !== undefined, data: () => (data ? clone(data) : undefined) };
      },
      async set(data: Data, options?: { merge?: boolean }) {
        assertNoUndefined(data, "");
        const prev = col(collection).get(id);
        col(collection).set(id, clone(options?.merge && prev ? { ...prev, ...data } : data));
      },
      async update(data: Data) {
        assertNoUndefined(data, "");
        const prev = col(collection).get(id);
        if (!prev) throw new Error("NOT_FOUND");
        col(collection).set(id, clone({ ...prev, ...data }));
      },
    };
    return ref;
  }
  type Ref = ReturnType<typeof docRef>;

  type Filter = { field: string; value: unknown };
  function query(collection: string, filters: Filter[], order: string | null, max: number | null) {
    return {
      where(field: string, op: string, value: unknown) {
        if (op !== "==") throw new Error("fake supports == only");
        return query(collection, [...filters, { field, value }], order, max);
      },
      orderBy(field: string) {
        return query(collection, filters, field, max);
      },
      limit(n: number) {
        return query(collection, filters, order, n);
      },
      async get() {
        const fields = new Set(filters.map((f) => f.field));
        if (fields.size > 1 || (order !== null && fields.size > 0 && !fields.has(order))) {
          throw new Error(`9 FAILED_PRECONDITION: The query requires an index (${collection}).`);
        }
        let docs = [...col(collection).entries()].filter(([, d]) => filters.every((f) => getPath(d, f.field) === f.value));
        if (order) docs.sort((a, b) => String(b[1][order]).localeCompare(String(a[1][order])));
        if (max !== null) docs = docs.slice(0, max);
        const list = docs.map(([id, d]) => ({ id, ref: docRef(collection, id), exists: true, data: () => clone(d) }));
        return { docs: list, empty: list.length === 0, size: list.length };
      },
    };
  }

  const db = {
    collection(name: string) {
      return {
        // Auto ids look like real ones (letters and digits, 20 characters).
        doc: (id?: string) => docRef(name, id ?? `auto${String(++autoId).padStart(16, "0")}`),
        ...query(name, [], null, null),
      };
    },
    async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const writes: Array<() => Promise<void>> = [];
      const tx = {
        get: (ref: Ref) => {
          if (writes.length > 0) throw new Error("Firestore transactions require all reads to be executed before all writes.");
          return ref.get();
        },
        set: (ref: Ref, data: Data, options?: { merge?: boolean }) => {
          assertNoUndefined(data, "");
          writes.push(() => ref.set(data, options));
        },
        update: (ref: Ref, data: Data) => {
          assertNoUndefined(data, "");
          writes.push(() => ref.update(data));
        },
      };
      const result = await fn(tx);
      for (const write of writes) await write();
      return result;
    },
    batch() {
      const writes: Array<() => Promise<void>> = [];
      return {
        update: (ref: Ref, data: Data) => {
          assertNoUndefined(data, "");
          writes.push(() => ref.update(data));
        },
        set: (ref: Ref, data: Data, options?: { merge?: boolean }) => {
          assertNoUndefined(data, "");
          writes.push(() => ref.set(data, options));
        },
        async commit() {
          for (const write of writes) await write();
        },
      };
    },
  };

  return {
    db,
    store,
    col,
    /** Put a document directly (test setup). */
    put(collection: string, id: string, data: Data) {
      col(collection).set(id, clone(data));
    },
    get(collection: string, id: string): Data | undefined {
      return col(collection).get(id);
    },
    reset() {
      store.clear();
      autoId = 0;
    },
  };
}
