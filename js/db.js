// Step 2: IndexedDB layer. All storage lives here — no DOM code in this file
// (see JEWELRY-PWA-SPEC.md §3 and §17). app.js talks to the database only
// through the DB object below, never through raw IndexedDB calls.

const DB_NAME = "jewelry";
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("items")) {
        db.createObjectStore("items", { keyPath: "uid" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

function withStore(storeName, mode, run) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const store = db.transaction(storeName, mode).objectStore(storeName);
        const req = run(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

const DB = {
  // ---- items ----

  getItem(uid) {
    return withStore("items", "readonly", (store) => store.get(uid)).then(
      (result) => result ?? null
    );
  },

  getAllItems() {
    return withStore("items", "readonly", (store) => store.getAll());
  },

  putItem(item) {
    return withStore("items", "readwrite", (store) => store.put(item)).then(() => item);
  },

  deleteItem(uid) {
    return withStore("items", "readwrite", (store) => store.delete(uid));
  },

  // Step 8: restore wipes the store and rebuilds it from a backup file.
  clearItems() {
    return withStore("items", "readwrite", (store) => store.clear());
  },

  // ---- meta ----

  getMeta(key) {
    return withStore("meta", "readonly", (store) => store.get(key)).then(
      (result) => (result ? result.value : null)
    );
  },

  putMeta(key, value) {
    return withStore("meta", "readwrite", (store) => store.put({ key, value }));
  },

  clearMeta() {
    return withStore("meta", "readwrite", (store) => store.clear());
  },
};
