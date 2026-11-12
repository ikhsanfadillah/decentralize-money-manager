const IDB_DB_NAME = "dmm_sqlite_storage_v1";
const IDB_STORE_NAME = "sqlite_files";

export function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

export function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbReadFile(path: string): Promise<Uint8Array | null> {
  if (!hasIndexedDb()) return null;
  try {
    const idb = await openIdb();
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE_NAME, "readonly");
      const req = tx.objectStore(IDB_STORE_NAME).get(path);
      req.onsuccess = () => {
        const val = req.result;
        resolve(val instanceof Uint8Array ? val : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function idbWriteFile(path: string, data: Uint8Array): Promise<void> {
  if (!hasIndexedDb()) return;
  try {
    const idb = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE_NAME, "readwrite");
      tx.objectStore(IDB_STORE_NAME).put(data, path);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore IDB quota/unavailable errors in restricted contexts
  }
}

export async function idbDeleteFile(path: string): Promise<void> {
  if (!hasIndexedDb()) return;
  try {
    const idb = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE_NAME, "readwrite");
      tx.objectStore(IDB_STORE_NAME).delete(path);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore
  }
}

