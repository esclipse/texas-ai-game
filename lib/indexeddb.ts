type StoredValue = unknown;

type DbConfig = {
  name: string;
  version: number;
  storeName: string;
};

const defaultDb: DbConfig = {
  name: "ai-game-web",
  version: 1,
  storeName: "kv",
};

function openDb(cfg: DbConfig = defaultDb): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this environment."));
      return;
    }

    const req = indexedDB.open(cfg.name, cfg.version);
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB."));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(cfg.storeName)) {
        db.createObjectStore(cfg.storeName);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

export async function idbGet<T = StoredValue>(key: string, cfg: DbConfig = defaultDb): Promise<T | undefined> {
  const db = await openDb(cfg);
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(cfg.storeName, "readonly");
      const store = tx.objectStore(cfg.storeName);
      const req = store.get(key);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB get failed."));
      req.onsuccess = () => resolve(req.result as T | undefined);
    });
  } finally {
    db.close();
  }
}

export async function idbSet(key: string, value: StoredValue, cfg: DbConfig = defaultDb): Promise<void> {
  const db = await openDb(cfg);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(cfg.storeName, "readwrite");
      const store = tx.objectStore(cfg.storeName);
      const req = store.put(value, key);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB set failed."));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed."));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted."));
    });
  } finally {
    db.close();
  }
}

export async function idbDel(key: string, cfg: DbConfig = defaultDb): Promise<void> {
  const db = await openDb(cfg);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(cfg.storeName, "readwrite");
      const store = tx.objectStore(cfg.storeName);
      const req = store.delete(key);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB delete failed."));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed."));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted."));
    });
  } finally {
    db.close();
  }
}

