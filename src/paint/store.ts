import { ctx2d, makeCanvas, renderText, walk, type Doc, type Layer } from './doc';
import { packMesh, unpackMesh } from './mesh';

const DB = 'frameforge-paint';
const STORES = ['docs', 'layers', 'timelapse', 'fonts', 'inbox'] as const;
type StoreName = (typeof STORES)[number];

let conn: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  conn ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => {
        req.result.close();
        conn = null;
      };
      resolve(req.result);
    };
    req.onerror = () => {
      conn = null;
      reject(req.error);
    };
  });
  return conn;
}

async function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const put = (store: StoreName, key: string, value: unknown): Promise<IDBValidKey> => tx(store, 'readwrite', s => s.put(value, key));
export const get = <T>(store: StoreName, key: string): Promise<T | undefined> => tx(store, 'readonly', s => s.get(key) as IDBRequest<T | undefined>);
export const del = (store: StoreName, key: string | IDBKeyRange): Promise<undefined> => tx(store, 'readwrite', s => s.delete(key));
export const keys = (store: StoreName, range?: IDBKeyRange): Promise<string[]> => tx(store, 'readonly', s => s.getAllKeys(range)).then(k => k.map(String));

export const prefix = (p: string): IDBKeyRange => IDBKeyRange.bound(p, `${p}￿`);

export interface LayerMeta extends Omit<Layer, 'canvas' | 'mask' | 'children'> {
  hasMask: boolean;
  children?: LayerMeta[];
}

export interface DocMeta extends Omit<Doc, 'layers' | 'mesh'> {
  layers: LayerMeta[];
}

export interface GalleryItem {
  id: string;
  name: string;
  width: number;
  height: number;
  updated: number;
  thumb: Blob | null;
}

function metaOf(layers: Layer[]): LayerMeta[] {
  return layers.map(l => {
    const meta = { ...l, hasMask: !!l.mask, children: l.children ? metaOf(l.children) : undefined } as LayerMeta & Partial<Pick<Layer, 'canvas' | 'mask'>>;
    delete meta.canvas;
    delete meta.mask;
    return meta;
  });
}

export function docMeta(doc: Doc): DocMeta {
  const meta = { ...doc, layers: metaOf(doc.layers) } as DocMeta & { mesh?: unknown };
  delete meta.mesh;
  return meta;
}

const toBlob = (c: HTMLCanvasElement, type = 'image/png', q?: number): Promise<Blob> =>
  new Promise((resolve, reject) => c.toBlob(b => (b ? resolve(b) : reject(new Error('Could not encode the image.'))), type, q));

export async function saveDoc(doc: Doc, dirty: Set<string> | 'all', thumb: HTMLCanvasElement): Promise<void> {
  const writes: Promise<unknown>[] = [];
  const live = new Set<string>();
  walk(doc.layers, l => {
    if (l.kind === 'group') return;
    live.add(`${doc.id}:${l.id}`);
    if (l.mask) live.add(`${doc.id}:${l.id}:mask`);
    if (dirty !== 'all' && !dirty.has(l.id)) return;
    writes.push(toBlob(l.canvas).then(b => put('layers', `${doc.id}:${l.id}`, b)));
    if (l.mask) writes.push(toBlob(l.mask).then(b => put('layers', `${doc.id}:${l.id}:mask`, b)));
  });
  if (doc.mesh) {
    live.add(`${doc.id}:model`);
    if (dirty === 'all') writes.push(put('layers', `${doc.id}:model`, packMesh(doc.mesh)));
  }
  doc.updated = Date.now();
  writes.push(put('docs', doc.id, { meta: docMeta(doc), thumb: await toBlob(thumb, 'image/jpeg', 0.8) }));
  await Promise.all(writes);
  const existing = await keys('layers', prefix(`${doc.id}:`));
  await Promise.all(existing.filter(k => !live.has(k)).map(k => del('layers', k)));
}

export async function listDocs(): Promise<GalleryItem[]> {
  const ids = await keys('docs');
  const items: GalleryItem[] = [];
  for (const id of ids) {
    const rec = await get<{ meta: DocMeta; thumb: Blob }>('docs', id);
    if (rec) items.push({ id, name: rec.meta.name, width: rec.meta.width, height: rec.meta.height, updated: rec.meta.updated, thumb: rec.thumb });
  }
  return items.sort((a, b) => b.updated - a.updated);
}

async function blobCanvas(blob: Blob | undefined, w: number, h: number): Promise<HTMLCanvasElement> {
  const c = makeCanvas(w, h);
  if (blob) {
    const bmp = await createImageBitmap(blob);
    ctx2d(c).drawImage(bmp, 0, 0);
    bmp.close();
  }
  return c;
}

async function rebuild(meta: LayerMeta[], w: number, h: number, read: (key: string) => Promise<Blob | undefined>): Promise<Layer[]> {
  const out: Layer[] = [];
  for (const m of meta) {
    const { hasMask, children, ...rest } = m;
    const layer: Layer = {
      ...rest,
      canvas: m.kind === 'group' ? makeCanvas(1, 1) : await blobCanvas(await read(m.id), w, h),
      mask: hasMask ? await blobCanvas(await read(`${m.id}:mask`), w, h) : null,
      children: children ? await rebuild(children, w, h, read) : undefined,
    };
    if (layer.kind === 'text') renderText(layer, w, h);
    out.push(layer);
  }
  return out;
}

export async function loadDoc(id: string): Promise<Doc | null> {
  const rec = await get<{ meta: DocMeta }>('docs', id);
  if (!rec) return null;
  const m = rec.meta;
  const layers = await rebuild(m.layers, m.width, m.height, k => get<Blob>('layers', `${id}:${k}`));
  const meshBlob = m.model ? await get<Blob>('layers', `${id}:model`) : undefined;
  return { ...m, layers, mesh: meshBlob ? await unpackMesh(meshBlob) : undefined };
}

export async function deleteDoc(id: string): Promise<void> {
  await del('docs', id);
  await del('layers', prefix(`${id}:`));
  await del('timelapse', prefix(`${id}:`));
}

export async function packDoc(doc: Doc): Promise<Blob> {
  const files: { key: string; blob: Blob }[] = [];
  const pending: Promise<void>[] = [];
  walk(doc.layers, l => {
    if (l.kind === 'group') return;
    pending.push(toBlob(l.canvas).then(b => void files.push({ key: l.id, blob: b })));
    if (l.mask) pending.push(toBlob(l.mask).then(b => void files.push({ key: `${l.id}:mask`, blob: b })));
  });
  await Promise.all(pending);
  if (doc.mesh) files.push({ key: 'model', blob: packMesh(doc.mesh) });
  const header = new TextEncoder().encode(JSON.stringify({ meta: docMeta(doc), files: files.map(f => ({ key: f.key, size: f.blob.size })) }));
  const magic = new TextEncoder().encode('FFPAINT1');
  return new Blob([magic, new Uint32Array([header.length]), header, ...files.map(f => f.blob)], { type: 'application/octet-stream' });
}

export async function unpackDoc(file: Blob, newId: string): Promise<Doc> {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(buf.subarray(0, 8)) !== 'FFPAINT1') throw new Error('This is not a Frameforge Paint file.');
  const len = new DataView(buf.buffer).getUint32(8, true);
  const head = JSON.parse(new TextDecoder().decode(buf.subarray(12, 12 + len))) as { meta: DocMeta; files: { key: string; size: number }[] };
  const map = new Map<string, Blob>();
  let o = 12 + len;
  for (const f of head.files) {
    map.set(f.key, new Blob([buf.slice(o, o + f.size)], { type: 'image/png' }));
    o += f.size;
  }
  const m = head.meta;
  const layers = await rebuild(m.layers, m.width, m.height, async k => map.get(k));
  const meshBlob = map.get('model');
  return { ...m, id: newId, layers, mesh: meshBlob ? await unpackMesh(meshBlob) : undefined };
}

export async function saveFont(name: string, blob: Blob): Promise<void> {
  await put('fonts', name, blob);
}

export async function loadFonts(): Promise<string[]> {
  const names = await keys('fonts').catch(() => [] as string[]);
  for (const n of names) {
    const blob = await get<Blob>('fonts', n);
    if (!blob) continue;
    try {
      const face = new FontFace(n, await blob.arrayBuffer());
      await face.load();
      document.fonts.add(face);
    } catch {
      /* skip fonts the browser cannot read */
    }
  }
  return names;
}
