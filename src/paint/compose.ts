import { ctx2d, makeCanvas, nativeBlend, type Blend, type Doc, type Layer } from './doc';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Src {
  c: CanvasImageSource;
  x: number;
  y: number;
}

export type LiveDraw = (g: CanvasRenderingContext2D, rect: Rect, layer: Layer) => void;

export interface ComposeOptions {
  live?: (layer: Layer) => LiveDraw | null;
  frame?: (layer: Layer, index: number) => { show: boolean; opacity: number; tint: string | null };
}

const pool: HTMLCanvasElement[] = [];
let poolUsed = 0;

function temp(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  let c = pool[poolUsed];
  if (!c) {
    c = makeCanvas(w, h);
    pool[poolUsed] = c;
  }
  poolUsed++;
  if (c.width < w || c.height < h) {
    c.width = Math.max(c.width, w);
    c.height = Math.max(c.height, h);
  }
  const g = ctx2d(c);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, w, h);
  return { c, g };
}

export function clampRect(r: Rect, w: number, h: number): Rect | null {
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  const x2 = Math.min(w, Math.ceil(r.x + r.w));
  const y2 = Math.min(h, Math.ceil(r.y + r.h));
  return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null;
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

const lum = (r: number, g: number, b: number): number => 0.3 * r + 0.59 * g + 0.11 * b;
const burn = (b: number, s: number): number => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s));
const dodge = (b: number, s: number): number => (b <= 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s)));

function channel(mode: Blend, b: number, s: number): number {
  switch (mode) {
    case 'linear-burn':
      return Math.max(0, b + s - 1);
    case 'vivid-light':
      return s <= 0.5 ? burn(b, 2 * s) : dodge(b, 2 * (s - 0.5));
    case 'linear-light':
      return Math.min(1, Math.max(0, b + 2 * s - 1));
    case 'pin-light':
      return s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1);
    case 'hard-mix':
      return b + s >= 1 ? 1 : 0;
    case 'subtract':
      return Math.max(0, b - s);
    case 'divide':
      return s <= 0 ? 1 : Math.min(1, b / s);
    default:
      return s;
  }
}

function softBlend(dst: ImageData, src: ImageData, mode: Blend, opacity: number): void {
  const d = dst.data;
  const s = src.data;
  for (let i = 0; i < d.length; i += 4) {
    const as = (s[i + 3] / 255) * opacity;
    if (as <= 0) continue;
    const ab = d[i + 3] / 255;
    const sr = s[i] / 255;
    const sg = s[i + 1] / 255;
    const sb = s[i + 2] / 255;
    const br = d[i] / 255;
    const bg = d[i + 1] / 255;
    const bb = d[i + 2] / 255;
    let r: number;
    let g: number;
    let b: number;
    if (mode === 'darker-color' || mode === 'lighter-color') {
      const pickSrc = mode === 'darker-color' ? lum(sr, sg, sb) < lum(br, bg, bb) : lum(sr, sg, sb) > lum(br, bg, bb);
      [r, g, b] = pickSrc ? [sr, sg, sb] : [br, bg, bb];
    } else {
      r = channel(mode, br, sr);
      g = channel(mode, bg, sg);
      b = channel(mode, bb, sb);
    }
    const ao = as + ab * (1 - as);
    const mixc = (cs: number, cb: number, cr: number): number => (as * (1 - ab) * cs + as * ab * cr + (1 - as) * ab * cb) / ao;
    d[i] = mixc(sr, br, r) * 255;
    d[i + 1] = mixc(sg, bg, g) * 255;
    d[i + 2] = mixc(sb, bb, b) * 255;
    d[i + 3] = ao * 255;
  }
}

export function blendInto(g: CanvasRenderingContext2D, ox: number, oy: number, src: Src, rect: Rect, blend: Blend, opacity: number): void {
  if (opacity <= 0) return;
  const op = nativeBlend(blend);
  const dx = rect.x - ox;
  const dy = rect.y - oy;
  if (op) {
    g.save();
    g.globalCompositeOperation = op;
    g.globalAlpha = opacity;
    g.drawImage(src.c, src.x, src.y, rect.w, rect.h, dx, dy, rect.w, rect.h);
    g.restore();
    return;
  }
  const t = temp(rect.w, rect.h);
  t.g.drawImage(src.c, src.x, src.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  const dst = g.getImageData(dx, dy, rect.w, rect.h);
  softBlend(dst, t.g.getImageData(0, 0, rect.w, rect.h), blend, opacity);
  g.putImageData(dst, dx, dy);
  poolUsed--;
}

function applyMask(g: CanvasRenderingContext2D, layer: Layer, rect: Rect): void {
  if (!layer.mask || !layer.maskOn) return;
  g.save();
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(layer.mask, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  g.restore();
}

function layerPixels(layer: Layer, rect: Rect, opts: ComposeOptions, forceCopy: boolean): Src {
  const live = opts.live?.(layer) ?? null;
  const needsMask = !!layer.mask && layer.maskOn;
  if (layer.kind === 'group') {
    const t = temp(rect.w, rect.h);
    composeList(t.g, rect.x, rect.y, layer.children ?? [], rect, opts, false);
    applyMask(t.g, layer, rect);
    return { c: t.c, x: 0, y: 0 };
  }
  if (!live && !needsMask && !forceCopy) return { c: layer.canvas, x: rect.x, y: rect.y };
  const t = temp(rect.w, rect.h);
  if (live) live(t.g, rect, layer);
  else t.g.drawImage(layer.canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  applyMask(t.g, layer, rect);
  return { c: t.c, x: 0, y: 0 };
}

function tinted(src: Src, rect: Rect, tint: string): Src {
  const t = temp(rect.w, rect.h);
  t.g.drawImage(src.c, src.x, src.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  t.g.globalCompositeOperation = 'source-atop';
  t.g.globalAlpha = 0.65;
  t.g.fillStyle = tint;
  t.g.fillRect(0, 0, rect.w, rect.h);
  t.g.globalAlpha = 1;
  t.g.globalCompositeOperation = 'source-over';
  return { c: t.c, x: 0, y: 0 };
}

function composeList(g: CanvasRenderingContext2D, ox: number, oy: number, list: Layer[], rect: Rect, opts: ComposeOptions, top: boolean): void {
  for (let i = 0; i < list.length; i++) {
    const layer = list[i];
    let end = i + 1;
    while (end < list.length && list[end].clip) end++;
    const clips = list.slice(i + 1, end).filter(c => c.visible);
    const frame = top && opts.frame ? opts.frame(layer, i) : { show: true, opacity: 1, tint: null };
    if (!layer.visible || !frame.show) {
      i = end - 1;
      continue;
    }
    const mark = poolUsed;
    let src = layerPixels(layer, rect, opts, clips.length > 0);
    if (clips.length) {
      const base = src;
      const tb = ctx2d(base.c as HTMLCanvasElement);
      for (const clip of clips) {
        const cm = poolUsed;
        const cs = layerPixels(clip, rect, opts, true);
        const cg = ctx2d(cs.c as HTMLCanvasElement);
        cg.globalCompositeOperation = 'destination-in';
        cg.drawImage(base.c, 0, 0, rect.w, rect.h, 0, 0, rect.w, rect.h);
        cg.globalCompositeOperation = 'source-over';
        const op = nativeBlend(clip.blend);
        if (op) {
          tb.save();
          tb.globalCompositeOperation = op === 'source-over' ? 'source-atop' : op;
          tb.globalAlpha = clip.opacity;
          tb.drawImage(cs.c, 0, 0, rect.w, rect.h, 0, 0, rect.w, rect.h);
          tb.restore();
        } else {
          blendInto(tb, rect.x, rect.y, cs, rect, clip.blend, clip.opacity);
        }
        poolUsed = cm;
      }
      src = base;
      i = end - 1;
    }
    if (frame.tint) src = tinted(src, rect, frame.tint);
    blendInto(g, ox, oy, src, rect, layer.blend, layer.opacity * frame.opacity);
    poolUsed = mark;
  }
}

export function composeDoc(g: CanvasRenderingContext2D, doc: Doc, rect: Rect, opts: ComposeOptions = {}, ox = 0, oy = 0, background = true): void {
  poolUsed = 0;
  const dx = rect.x - ox;
  const dy = rect.y - oy;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.clearRect(dx, dy, rect.w, rect.h);
  if (background && doc.bgVisible) {
    g.fillStyle = doc.background;
    g.fillRect(dx, dy, rect.w, rect.h);
  }
  g.beginPath();
  g.rect(dx, dy, rect.w, rect.h);
  g.clip();
  composeList(g, ox, oy, doc.layers, rect, opts, true);
  g.restore();
  poolUsed = 0;
}

export function flatten(doc: Doc, background = true, opts: ComposeOptions = {}): HTMLCanvasElement {
  const out = makeCanvas(doc.width, doc.height);
  composeDoc(ctx2d(out), doc, { x: 0, y: 0, w: doc.width, h: doc.height }, opts, 0, 0, background);
  return out;
}

export function composeLayers(layers: Layer[], w: number, h: number): HTMLCanvasElement {
  const out = makeCanvas(w, h);
  poolUsed = 0;
  composeList(ctx2d(out), 0, 0, layers, { x: 0, y: 0, w, h }, {}, false);
  poolUsed = 0;
  return out;
}
