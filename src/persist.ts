import { analyze } from './media';
import { store } from './state';
import type { Project } from './types';

const KEY = 'frameforge:project';
const DB_NAME = 'frameforge';
const STORE_NAME = 'media';
export const MASK_STORE = 'masks';
export const SOUND_STORE = 'sounds';

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      for (const name of [STORE_NAME, MASK_STORE, SOUND_STORE]) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>, storeName = STORE_NAME): Promise<T> {
  const conn = await db();
  return new Promise((resolve, reject) => {
    const req = fn(conn.transaction(storeName, mode).objectStore(storeName));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const putBlob = (id: string, blob: Blob): Promise<IDBValidKey> => run('readwrite', s => s.put({ id, blob }));
export const deleteBlob = (id: string): Promise<undefined> => run('readwrite', s => s.delete(id));
export const clearBlobs = (): Promise<undefined> => run('readwrite', s => s.clear()).then(() => run('readwrite', s => s.clear(), MASK_STORE));
export const putRecord = (storeName: string, id: string, blob: Blob): Promise<IDBValidKey> => run('readwrite', s => s.put({ id, blob }), storeName);
export const getRecord = (storeName: string, id: string): Promise<Blob | undefined> =>
  run<{ id: string; blob: Blob } | undefined>('readonly', s => s.get(id), storeName).then(r => r?.blob);
export const deleteRecord = (storeName: string, id: string): Promise<undefined> => run('readwrite', s => s.delete(id), storeName);
export const recordKeys = (storeName: string): Promise<string[]> => run('readonly', s => s.getAllKeys(), storeName).then(k => k.map(String));
const allBlobs = (): Promise<{ id: string; blob: Blob }[]> => run('readonly', s => s.getAll());

function isProject(p: unknown): p is Project {
  const v = p as Project | null;
  return !!v && v.version === 1 && Array.isArray(v.tracks) && Array.isArray(v.clips) && Array.isArray(v.media);
}

export function parseProject(text: string): Project {
  const data = JSON.parse(text) as { project?: unknown };
  const p = data.project ?? data;
  if (!isProject(p)) throw new Error('This file is not a Frameforge project.');
  return p;
}

export function startAutosave(): void {
  let timer = 0;
  store.on(c => {
    if (c !== 'project') return;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(store.project));
      } catch {
        /* storage full or blocked: the project still lives in memory */
      }
    }, 400);
  });
}

export async function restore(): Promise<void> {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) store.load(parseProject(saved));
  } catch {
    /* ignore a corrupt autosave */
  }
  const records = await allBlobs().catch(() => []);
  const restored: { id: string; url: string; blob: Blob }[] = [];
  for (const rec of records) {
    if (!store.media(rec.id)) {
      void deleteBlob(rec.id);
      continue;
    }
    const url = URL.createObjectURL(rec.blob);
    store.runtime.set(rec.id, { url, thumb: '', peaks: '', blob: rec.blob });
    restored.push({ id: rec.id, url, blob: rec.blob });
  }
  if (restored.length) store.emit('media');
  for (const r of restored) {
    const meta = store.media(r.id);
    if (!meta) continue;
    try {
      const info = await analyze(meta.kind, r.url, r.blob);
      const rt = store.runtime.get(r.id);
      if (rt) Object.assign(rt, { thumb: info.thumb, peaks: info.peaks });
      store.emit('media');
    } catch {
      /* leave the media without a preview */
    }
  }
}
