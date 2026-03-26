export type AiMemoryRecord = {
  id: string;
  memories: string[];
  updatedAt: number;
};

const DB_NAME = "ai-texas-memory";
const DB_VERSION = 1;
const STORE_NAME = "memories";
const MAX_MEMORIES = 6;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    const timeoutMs = 1500;
    const timer = window.setTimeout(() => {
      try {
        req.onerror = null;
        req.onsuccess = null;
        req.onupgradeneeded = null;
        // onblocked exists on IDBOpenDBRequest in browsers that implement it.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (req as any).onblocked = null;
      } catch {
        // ignore
      }
      reject(new Error("indexedDB open timeout"));
    }, timeoutMs);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).onblocked = () => {
      window.clearTimeout(timer);
      reject(new Error("indexedDB open blocked"));
    };
    req.onsuccess = () => {
      window.clearTimeout(timer);
      const db = req.result;
      // If another tab upgrades the db, close to avoid blocking/hanging transactions.
      db.onversionchange = () => {
        try {
          db.close();
        } catch {
          // ignore
        }
      };
      resolve(db);
    };
    req.onerror = () => {
      window.clearTimeout(timer);
      reject(req.error);
    };
  });
}

async function readRecord(id: string): Promise<AiMemoryRecord | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve((req.result as AiMemoryRecord | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function writeRecord(record: AiMemoryRecord): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function loadAiMemories(ids: string[]): Promise<Record<string, string[]>> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return {};
  const result: Record<string, string[]> = {};
  for (const id of ids) {
    try {
      const record = await readRecord(id);
      result[id] = record?.memories ?? [];
    } catch {
      result[id] = [];
    }
  }
  return result;
}

export async function appendAiMemory(id: string, line: string): Promise<string[]> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return [];
  const trimmed = line.trim();
  if (!trimmed) return [];

  const current = await readRecord(id);
  const prev = current?.memories ?? [];
  const next = [trimmed, ...prev.filter((m) => m !== trimmed)].slice(0, MAX_MEMORIES);
  await writeRecord({
    id,
    memories: next,
    updatedAt: Date.now(),
  });
  return next;
}
