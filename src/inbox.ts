const DB = 'frameforge-paint';
const STORES = ['docs', 'layers', 'timelapse', 'fonts', 'inbox'];

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function takeInbox(): Promise<File[]> {
  const db = await open();
  const items = await new Promise<{ key: IDBValidKey; value: { name: string; blob: Blob } }[]>((resolve, reject) => {
    const out: { key: IDBValidKey; value: { name: string; blob: Blob } }[] = [];
    const req = db.transaction('inbox', 'readonly').objectStore('inbox').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(out);
      out.push({ key: c.key, value: c.value });
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
  if (!items.length) {
    db.close();
    return [];
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('inbox', 'readwrite');
    items.forEach(i => tx.objectStore('inbox').delete(i.key));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return items.map(i => new File([i.value.blob], i.value.name, { type: i.value.blob.type || 'image/png' }));
}

export function siblingPage(target: 'paint' | 'editor'): string {
  const file = decodeURIComponent(location.pathname.split('/').pop() ?? '');
  const packaged = /^(Frameforge|Paint)\.html$/i.test(file);
  if (target === 'paint') return packaged ? 'Paint.html' : 'paint.html';
  return packaged ? 'Frameforge.html' : 'index.html';
}
