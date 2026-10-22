import { loadObjectModel, objectAt } from './ai';
import { cutoutOf, speedOf } from './looks';
import { decode, encode, grow, innerPoint, overlap, refine, resample, shape, type Frame } from './masks';
import { MASK_STORE, deleteRecord, getRecord, putRecord } from './persist';
import { store } from './state';
import type { Clip } from './types';
import { uid } from './util';

export interface MaskSet {
  id: string;
  width: number;
  height: number;
  rate: number;
  from: number;
  frames: (Uint8Array | undefined)[];
  plate: Uint8Array | null;
  rev?: number;
}

interface Point {
  x: number;
  y: number;
}

export const TRACK_RATE = 15;
const LONG_SIDE = 512;

const sets = new Map<string, MaskSet>();
const loading = new Set<string>();
const decoded = new Map<string, Uint8Array>();
let notify: () => void = () => undefined;

export function onMasksLoaded(fn: () => void): void {
  notify = fn;
}

function serialize(set: MaskSet): Blob {
  const frames = set.frames.map(f => f ?? new Uint8Array(0));
  const header = new TextEncoder().encode(
    JSON.stringify({ width: set.width, height: set.height, rate: set.rate, from: set.from, lengths: frames.map(f => f.length), plate: !!set.plate }),
  );
  const size = new Uint32Array([header.length]);
  return new Blob([size, header, ...frames, ...(set.plate ? [set.plate] : [])]);
}

async function deserialize(id: string, blob: Blob): Promise<MaskSet> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const len = new DataView(buf.buffer).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + len))) as { width: number; height: number; rate: number; from: number; lengths: number[]; plate: boolean };
  let o = 4 + len;
  const frames = head.lengths.map(n => {
    const f = buf.slice(o, o + n);
    o += n;
    return n ? f : undefined;
  });
  const plate = head.plate ? buf.slice(o, o + head.width * head.height * 4) : null;
  return { id, width: head.width, height: head.height, rate: head.rate, from: head.from, frames, plate };
}

async function load(id: string): Promise<void> {
  try {
    const blob = await getRecord(MASK_STORE, id);
    if (blob) {
      sets.set(id, await deserialize(id, blob));
      notify();
    }
  } catch {
    /* missing masks show the clip uncut until it is tracked again */
  }
}

export function maskSet(id: string): MaskSet | null {
  const s = sets.get(id);
  if (s) return s;
  if (id && !loading.has(id)) {
    loading.add(id);
    void load(id);
  }
  return null;
}

function frameAt(set: MaskSet, i: number): Uint8Array | null {
  const n = set.frames.length;
  for (let d = 0; d < n; d++) {
    for (const j of [i - d, i + d]) {
      const rle = j >= 0 && j < n ? set.frames[j] : undefined;
      if (!rle) continue;
      const key = `${set.id}:${j}`;
      let out = decoded.get(key);
      if (!out) {
        out = decode(rle, set.width * set.height);
        if (decoded.size > 12) decoded.delete(decoded.keys().next().value as string);
        decoded.set(key, out);
      }
      return out;
    }
  }
  return null;
}

export function maskAt(set: MaskSet, mediaTime: number, expand: number, feather: number, known: string): { data: Uint8Array | null; key: string } | null {
  const f = Math.max(0, (mediaTime - set.from) * set.rate);
  const i0 = Math.min(set.frames.length - 1, Math.floor(f));
  const i1 = Math.min(set.frames.length - 1, i0 + 1);
  const k = Math.round((f - i0) * 4) / 4;
  const key = `${set.id}:${i0}:${k}:${expand}:${feather}:${set.rev ?? 0}`;
  if (key === known) return { data: null, key };
  const a = frameAt(set, i0);
  if (!a) return null;
  let raw = a;
  if (k > 0 && i1 !== i0) {
    const b = frameAt(set, i1);
    if (b && b !== a) {
      raw = new Uint8Array(a.length);
      for (let i = 0; i < a.length; i++) raw[i] = a[i] + (b[i] - a[i]) * k;
    }
  }
  return { data: shape(raw, set.width, set.height, expand, feather), key };
}

interface Source {
  canvas: HTMLCanvasElement;
  grab(t: number): Promise<Frame>;
  dispose(): void;
}

async function openSource(clip: Clip): Promise<Source> {
  const rt = store.runtime.get(clip.mediaId ?? '');
  if (!rt) throw new Error('This clip’s media is offline. Import it again first.');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is not available.');
  const fit = (w: number, h: number): void => {
    const s = Math.min(1, LONG_SIDE / Math.max(w, h));
    canvas.width = Math.max(2, Math.round(w * s));
    canvas.height = Math.max(2, Math.round(h * s));
  };
  const read = (src: CanvasImageSource): Frame => {
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    return { rgba: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
  };
  if (clip.kind === 'image') {
    const img = new Image();
    img.src = rt.url;
    await img.decode();
    fit(img.naturalWidth, img.naturalHeight);
    const frame = read(img);
    return { canvas, grab: async () => frame, dispose: () => undefined };
  }
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = rt.url;
  await new Promise<void>((resolve, reject) => {
    v.addEventListener('loadeddata', () => resolve(), { once: true });
    v.addEventListener('error', () => reject(new Error('The video could not be read.')), { once: true });
  });
  fit(v.videoWidth, v.videoHeight);
  return {
    canvas,
    async grab(t: number) {
      if (Math.abs(v.currentTime - t) > 1e-3) {
        const seeked = new Promise<void>(r => v.addEventListener('seeked', () => r(), { once: true }));
        v.currentTime = t;
        await Promise.race([seeked, new Promise(r => setTimeout(r, 4000))]);
      }
      return read(v);
    },
    dispose() {
      v.removeAttribute('src');
      v.load();
    },
  };
}

export interface TrackJob {
  clipId: string;
  progress: number;
  abort: AbortController;
}

export const jobs = new Map<string, TrackJob>();

export async function trackObject(clipId: string, points: Point[], at: number, onProgress: () => void): Promise<number> {
  const clip = store.clip(clipId);
  if (!clip || !points.length) throw new Error('Pick an object first.');
  const job: TrackJob = { clipId, progress: 0, abort: new AbortController() };
  jobs.get(clipId)?.abort.abort();
  jobs.set(clipId, job);
  onProgress();
  const source = await openSource(clip);
  try {
    const model = await loadObjectModel();
    const meta = store.media(clip.mediaId);
    const rate = clip.kind === 'image' ? 1 : TRACK_RATE;
    const from = clip.kind === 'image' ? 0 : clip.offset;
    const to = clip.kind === 'image' ? 0 : Math.min(meta?.duration ?? Infinity, clip.offset + clip.duration * speedOf(clip)) - 0.02;
    const count = clip.kind === 'image' ? 1 : Math.max(1, Math.floor((to - from) * rate) + 1);
    const seed = Math.min(count - 1, Math.max(0, Math.round((at - from) * rate)));
    const { width: w, height: h } = source.canvas;
    const set: MaskSet = { id: uid(), width: w, height: h, rate, from, frames: Array.from({ length: count }, () => undefined), plate: null };
    const sum = new Float32Array(w * h * 3);
    const hits = new Uint16Array(w * h);
    const segmentAt = (p: Point, frame: Frame): Uint8Array | null => {
      const raw = objectAt(model, source.canvas, Math.min(0.999, Math.max(0, p.x)), Math.min(0.999, Math.max(0, p.y)));
      return raw ? refine(resample(raw.data, raw.width, raw.height, w, h), frame) : null;
    };
    const previous = clip.cutout?.maskId;
    let done = 0;
    let published = false;
    const pass = async (indices: number[]): Promise<void> => {
      let state: { mask: Uint8Array | null; point: Point }[] = points.map(p => ({ mask: null, point: p }));
      for (const i of indices) {
        if (job.abort.signal.aborted) throw new DOMException('Tracking cancelled', 'AbortError');
        const frame = await source.grab(from + i / rate);
        const combined = new Uint8Array(w * h);
        state = state.map(s => {
          const first = s.mask ? innerPoint(s.mask, w, h) ?? s.point : s.point;
          let mask = segmentAt(first, frame);
          if (s.mask && (!mask || overlap(mask, s.mask) < 0.35)) {
            const retry = segmentAt(s.point, frame);
            if (retry && (!mask || overlap(retry, s.mask) > overlap(mask, s.mask))) mask = retry;
            if (!mask || overlap(mask, s.mask) < 0.1) mask = s.mask;
          }
          if (!mask) return s;
          for (let k = 0; k < combined.length; k++) if (mask[k] > combined[k]) combined[k] = mask[k];
          return { mask, point: innerPoint(mask, w, h) ?? first };
        });
        set.frames[i] = encode(combined);
        set.rev = (set.rev ?? 0) + 1;
        const halo = grow(combined, w, h, Math.round(Math.max(w, h) / 60));
        for (let k = 0; k < halo.length; k++) {
          if (halo[k] > 10 || hits[k] === 65535) continue;
          hits[k]++;
          sum[k * 3] += frame.rgba[k * 4];
          sum[k * 3 + 1] += frame.rgba[k * 4 + 1];
          sum[k * 3 + 2] += frame.rgba[k * 4 + 2];
        }
        done++;
        job.progress = done / count;
        if (!published) {
          published = true;
          sets.set(set.id, set);
          const live = store.clip(clipId);
          if (live) {
            live.cutout = { ...cutoutOf(live), maskId: set.id, points, at };
            if (live.cutout.mode === 'off') live.cutout.mode = 'keep';
            store.emit('project');
          }
        }
        onProgress();
        if (done % 2 === 0) notify();
      }
    };
    await pass(Array.from({ length: count - seed }, (_, k) => seed + k));
    await pass(Array.from({ length: seed }, (_, k) => seed - 1 - k));
    const plate = new Uint8Array(w * h * 4);
    for (let k = 0; k < hits.length; k++) {
      if (!hits[k]) continue;
      plate[k * 4] = sum[k * 3] / hits[k];
      plate[k * 4 + 1] = sum[k * 3 + 1] / hits[k];
      plate[k * 4 + 2] = sum[k * 3 + 2] / hits[k];
      plate[k * 4 + 3] = 255;
    }
    set.plate = count > 1 ? plate : null;
    set.rev = (set.rev ?? 0) + 1;
    await putRecord(MASK_STORE, set.id, serialize(set)).catch(() => undefined);
    if (previous && previous !== set.id) {
      sets.delete(previous);
      void deleteRecord(MASK_STORE, previous).catch(() => undefined);
    }
    notify();
    return count;
  } finally {
    source.dispose();
    jobs.delete(clipId);
    onProgress();
  }
}
