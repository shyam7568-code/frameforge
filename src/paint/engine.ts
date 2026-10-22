import { grainCanvas, tipCanvas, type Brush } from './brushes';
import { clampRect, unionRect, type Rect } from './compose';
import { ctx2d, makeCanvas } from './doc';

export interface Pt {
  x: number;
  y: number;
  p: number;
  tilt: number;
  t: number;
}

export type StrokeMode = 'paint' | 'erase' | 'smudge' | 'source';

export interface DabXf {
  (x: number, y: number, a: number): [number, number, number][];
}

export interface StrokeOptions {
  brush: Brush;
  mode: StrokeMode;
  color: [number, number, number];
  target: HTMLCanvasElement;
  maskTarget: boolean;
  selection: HTMLCanvasElement | null;
  alphaLock: boolean;
  symmetry: DabXf | null;
  assist: ((start: Pt, pt: Pt) => Pt) | null;
  source?: { canvas: CanvasImageSource; dx: number; dy: number };
  smoothing: number;
  zoomInv: number;
  pressureCurve: (p: number) => number;
  sizeScale: number;
  simulatePressure: boolean;
}

interface Sample {
  x: number;
  y: number;
  p: number;
  tilt: number;
  dir: number;
  dist: number;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let hh = 0;
  if (d) hh = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((hh * 60 + 360) % 360) / 360, max ? d / max : 0, max];
}

function hsvToRgb(hh: number, s: number, v: number): [number, number, number] {
  const f = (n: number): number => {
    const k = (n + hh * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

const tintCache = new Map<string, HTMLCanvasElement>();

function tinted(tip: HTMLCanvasElement, key: string, rgb: [number, number, number]): HTMLCanvasElement {
  const k = `${key}|${rgb.map(v => Math.round(v * 63)).join(',')}`;
  let c = tintCache.get(k);
  if (c) return c;
  c = makeCanvas(tip.width, tip.height);
  const g = ctx2d(c);
  g.drawImage(tip, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = `rgb(${rgb.map(v => Math.round(v * 255)).join(',')})`;
  g.fillRect(0, 0, c.width, c.height);
  if (tintCache.size > 160) tintCache.delete(tintCache.keys().next().value as string);
  tintCache.set(k, c);
  return c;
}

const grainPatterns = new Map<string, HTMLCanvasElement>();

function grainLayer(brush: Brush): HTMLCanvasElement | null {
  const base = grainCanvas(brush.grain);
  if (!base) return null;
  const key = `${brush.grain}:${brush.grainDepth.toFixed(2)}`;
  let c = grainPatterns.get(key);
  if (!c) {
    c = makeCanvas(base.width, base.height);
    const g = ctx2d(c);
    g.fillStyle = `rgba(255,255,255,${1 - brush.grainDepth})`;
    g.fillRect(0, 0, c.width, c.height);
    g.globalAlpha = brush.grainDepth;
    g.drawImage(base, 0, 0);
    grainPatterns.set(key, c);
  }
  return c;
}

export class Stroke {
  readonly opts: StrokeOptions;
  private readonly buffer: HTMLCanvasElement;
  private readonly bg: CanvasRenderingContext2D;
  private readonly before: HTMLCanvasElement;
  private readonly tip: HTMLCanvasElement;
  private readonly tipKey: string;
  private readonly seed = Math.floor(Math.random() * 1e9);
  private random: () => number;
  private samples: Sample[] = [];
  private raw: Pt[] = [];
  private smooth: Pt | null = null;
  private lastSample: Sample | null = null;
  private sinceDab = 0;
  private total = 0;
  private dirty: Rect | null = null;
  bbox: Rect | null = null;
  private carried: [number, number, number] | null = null;
  private wetSnapshot: ImageData | null = null;
  private smudgeTemp: HTMLCanvasElement | null = null;
  private start: Pt | null = null;
  private assistLocked = false;
  shapePath: { x: number; y: number }[] | null = null;
  private shapePressure = 1;

  constructor(opts: StrokeOptions, buffer: HTMLCanvasElement, before: HTMLCanvasElement) {
    this.opts = opts;
    const { target } = opts;
    if (buffer.width !== target.width || buffer.height !== target.height) {
      buffer.width = target.width;
      buffer.height = target.height;
    }
    if (before.width !== target.width || before.height !== target.height) {
      before.width = target.width;
      before.height = target.height;
    }
    this.buffer = buffer;
    this.bg = ctx2d(buffer);
    this.bg.setTransform(1, 0, 0, 1, 0, 0);
    this.bg.clearRect(0, 0, buffer.width, buffer.height);
    this.before = before;
    const bc = ctx2d(before);
    bc.globalCompositeOperation = 'copy';
    bc.drawImage(target, 0, 0);
    bc.globalCompositeOperation = 'source-over';
    this.tip = tipCanvas(opts.brush.tip, opts.brush.hardness);
    this.tipKey = `${opts.brush.tip}:${opts.brush.hardness}`;
    this.random = rng(this.seed);
    if (opts.brush.wet > 0 && opts.mode === 'paint' && !opts.maskTarget) {
      this.wetSnapshot = ctx2d(before).getImageData(0, 0, before.width, before.height);
    }
  }

  private get direct(): boolean {
    const b = this.opts.brush;
    return this.opts.mode === 'paint' && !this.opts.maskTarget && (b.wet > 0 || b.hueJitter > 0 || b.satJitter > 0 || b.briJitter > 0);
  }

  begin(pt: Pt): void {
    this.start = pt;
    this.smooth = { ...pt };
    this.raw.push(pt);
    this.addSample(pt);
  }

  move(pts: Pt[]): void {
    for (let pt of pts) {
      if (!this.smooth || !this.start) continue;
      this.raw.push(pt);
      if (this.opts.assist) {
        if (!this.assistLocked && Math.hypot(pt.x - this.start.x, pt.y - this.start.y) < 6) continue;
        this.assistLocked = true;
        pt = this.opts.assist(this.start, pt);
      }
      const prev = this.smooth;
      const radius = this.opts.smoothing * 26 * this.opts.zoomInv;
      const dx = pt.x - prev.x;
      const dy = pt.y - prev.y;
      const d = Math.hypot(dx, dy);
      const k = radius <= 0 ? 1 : Math.max(0, d - radius) / Math.max(d, 1e-6);
      const next: Pt = {
        x: prev.x + dx * k,
        y: prev.y + dy * k,
        p: prev.p + (pt.p - prev.p) * (radius <= 0 ? 1 : 0.5),
        tilt: prev.tilt + (pt.tilt - prev.tilt) * 0.5,
        t: pt.t,
      };
      if (k <= 0) {
        this.smooth = { ...prev, p: next.p, tilt: next.tilt };
        continue;
      }
      this.smooth = next;
      this.addSample(next);
    }
  }

  jump(pt: Pt): void {
    this.raw.push(pt);
    this.smooth = { ...pt };
    this.lastSample = null;
    this.sinceDab = 0;
    this.addSample(pt);
  }

  catchUp(): void {
    const last = this.raw[this.raw.length - 1];
    const s = this.smooth;
    if (!last || !s) return;
    let pt = last;
    if (this.opts.assist && this.start && this.assistLocked) pt = this.opts.assist(this.start, last);
    const d = Math.hypot(pt.x - s.x, pt.y - s.y);
    const steps = Math.ceil(d / 2);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.addSample({ x: s.x + (pt.x - s.x) * t, y: s.y + (pt.y - s.y) * t, p: s.p + (pt.p - s.p) * t, tilt: pt.tilt, t: pt.t });
    }
    this.smooth = { ...pt };
  }

  private pressure(pt: Pt): number {
    return this.opts.pressureCurve(Math.max(0.001, Math.min(1, pt.p)));
  }

  private sizeAt(p: number, tilt: number): number {
    const b = this.opts.brush;
    const base = b.size * this.opts.sizeScale;
    const pf = 1 - b.sizePressure * (1 - p);
    const tf = 1 + b.tiltSize * tilt * 2;
    return Math.max(0.5, base * Math.max(b.minSize, pf) * tf);
  }

  private addSample(pt: Pt): void {
    const last = this.lastSample;
    const p = this.pressure(pt);
    if (!last) {
      const s0: Sample = { x: pt.x, y: pt.y, p, tilt: pt.tilt, dir: 0, dist: 0 };
      this.lastSample = s0;
      this.samples.push(s0);
      this.dab(s0, 1);
      return;
    }
    const dx = pt.x - last.x;
    const dy = pt.y - last.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.01) return;
    const dir = Math.atan2(dy, dx);
    let travelled = 0;
    while (true) {
      const spacing = Math.max(0.4, this.sizeAt(p, pt.tilt) * this.opts.brush.spacing);
      const need = spacing - this.sinceDab;
      if (travelled + need > d) {
        this.sinceDab += d - travelled;
        break;
      }
      travelled += need;
      this.sinceDab = 0;
      const t = travelled / d;
      const s: Sample = {
        x: last.x + dx * t,
        y: last.y + dy * t,
        p: last.p + (p - last.p) * t,
        tilt: last.tilt + (pt.tilt - last.tilt) * t,
        dir,
        dist: this.total + travelled,
      };
      this.samples.push(s);
      this.dab(s, this.taperStart(s.dist));
    }
    this.total += d;
    this.lastSample = { x: pt.x, y: pt.y, p, tilt: pt.tilt, dir, dist: this.total };
  }

  private taperLen(which: number): number {
    return which * Math.max(60, this.opts.brush.size * this.opts.sizeScale * 10);
  }

  private taperStart(dist: number): number {
    const b = this.opts.brush;
    const L = this.taperLen(b.taperStart);
    let f = L > 0 && dist < L ? 0.15 + 0.85 * Math.sqrt(dist / L) : 1;
    if (this.opts.simulatePressure && dist < 30) f *= 0.4 + 0.6 * (dist / 30);
    return f;
  }

  private dab(s: Sample, taper: number): void {
    const b = this.opts.brush;
    const r = this.random;
    for (let n = 0; n < b.count; n++) {
      let size = this.sizeAt(s.p, s.tilt) * taper * (1 - b.sizeJitter * r());
      let alpha = b.flow * (1 - b.opacityPressure * (1 - s.p)) * (1 - b.opacityJitter * r()) * (1 - b.tiltOpacity * s.tilt * 0.6);
      if (this.opts.mode === 'smudge') alpha = Math.min(1, b.opacity * (0.35 + 0.65 * s.p));
      const angle = (b.angle * Math.PI) / 180 + (b.follow ? s.dir : 0) + (r() - 0.5) * 2 * Math.PI * b.angleJitter;
      let x = s.x;
      let y = s.y;
      if (b.scatter > 0) {
        const a = r() * Math.PI * 2;
        const d = r() * b.scatter * size;
        x += Math.cos(a) * d;
        y += Math.sin(a) * d;
      }
      size = Math.max(0.5, size);
      let color: [number, number, number] | null = null;
      if (this.direct) color = this.dabColor(x, y, r);
      const places = this.opts.symmetry ? this.opts.symmetry(x, y, angle) : [[x, y, angle] as [number, number, number]];
      for (const [px, py, pa] of places) {
        if (this.opts.mode === 'smudge') this.smudgeDab(px, py, size, pa, alpha, s);
        else this.stamp(px, py, size, pa, alpha, color);
      }
    }
  }

  private dabColor(x: number, y: number, r: () => number): [number, number, number] {
    const b = this.opts.brush;
    let rgb = this.opts.color;
    if (b.wet > 0 && this.wetSnapshot) {
      const snap = this.wetSnapshot;
      const ix = Math.round(x);
      const iy = Math.round(y);
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      for (let oy = -2; oy <= 2; oy += 2)
        for (let ox = -2; ox <= 2; ox += 2) {
          const qx = Math.min(snap.width - 1, Math.max(0, ix + ox));
          const qy = Math.min(snap.height - 1, Math.max(0, iy + oy));
          const i = (qy * snap.width + qx) * 4;
          const a = snap.data[i + 3] / 255;
          sr += (snap.data[i] / 255) * a;
          sg += (snap.data[i + 1] / 255) * a;
          sb += (snap.data[i + 2] / 255) * a;
          sa += a;
        }
      if (sa > 0.5) {
        const picked: [number, number, number] = [sr / sa, sg / sa, sb / sa];
        this.carried = this.carried ? (this.carried.map((v, i) => v + (picked[i] - v) * 0.35) as [number, number, number]) : picked;
      }
      if (this.carried) rgb = rgb.map((v, i) => v + (this.carried![i] - v) * b.wet * 0.85) as [number, number, number];
    }
    if (b.hueJitter || b.satJitter || b.briJitter) {
      const [hh, s, v] = rgbToHsv(...rgb);
      rgb = hsvToRgb(
        (hh + (r() - 0.5) * 2 * b.hueJitter + 1) % 1,
        Math.min(1, Math.max(0, s + (r() - 0.5) * 2 * b.satJitter)),
        Math.min(1, Math.max(0, v + (r() - 0.5) * 2 * b.briJitter)),
      );
    }
    return rgb;
  }

  private mark(x: number, y: number, size: number): void {
    const half = size * 0.75 + 2;
    const rect = clampRect({ x: x - half, y: y - half, w: half * 2, h: half * 2 }, this.buffer.width, this.buffer.height);
    if (!rect) return;
    this.dirty = unionRect(this.dirty, rect);
    this.bbox = unionRect(this.bbox, rect);
  }

  private stamp(x: number, y: number, size: number, angle: number, alpha: number, color: [number, number, number] | null): void {
    const b = this.opts.brush;
    const g = this.bg;
    const T = this.tip.width;
    const sc = size / T;
    const cs = Math.cos(angle) * sc;
    const sn = Math.sin(angle) * sc;
    g.setTransform(cs, sn, -sn * b.roundness, cs * b.roundness, x, y);
    g.globalAlpha = Math.max(0, Math.min(1, alpha));
    g.drawImage(color ? tinted(this.tip, this.tipKey, color) : this.tip, -T / 2, -T / 2);
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.mark(x, y, size);
  }

  private smudgeDab(x: number, y: number, size: number, angle: number, alpha: number, s: Sample): void {
    const prev = this.samples.length > 1 ? this.samples[this.samples.length - 2] : s;
    const S = Math.ceil(size) + 2;
    if (!this.smudgeTemp || this.smudgeTemp.width < S) this.smudgeTemp = makeCanvas(S, S);
    const t = this.smudgeTemp;
    const tg = ctx2d(t);
    tg.setTransform(1, 0, 0, 1, 0, 0);
    tg.globalCompositeOperation = 'copy';
    const offX = x - s.x;
    const offY = y - s.y;
    tg.drawImage(this.opts.target, prev.x + offX - S / 2, prev.y + offY - S / 2, S, S, 0, 0, S, S);
    tg.globalCompositeOperation = 'destination-in';
    tg.translate(S / 2, S / 2);
    tg.rotate(angle);
    tg.scale(1, this.opts.brush.roundness);
    tg.drawImage(this.tip, -size / 2, -size / 2, size, size);
    tg.setTransform(1, 0, 0, 1, 0, 0);
    tg.globalCompositeOperation = 'source-over';
    if (this.opts.selection) {
      tg.globalCompositeOperation = 'destination-in';
      tg.drawImage(this.opts.selection, x - S / 2, y - S / 2, S, S, 0, 0, S, S);
      tg.globalCompositeOperation = 'source-over';
    }
    const g = ctx2d(this.opts.target);
    g.save();
    g.globalAlpha = alpha;
    g.globalCompositeOperation = this.opts.alphaLock ? 'source-atop' : 'source-over';
    g.drawImage(t, 0, 0, S, S, x - S / 2, y - S / 2, S, S);
    g.restore();
    this.mark(x, y, size);
  }

  flush(): Rect | null {
    const rect = this.dirty;
    this.dirty = null;
    if (!rect || this.opts.mode === 'smudge') return rect;
    this.applyRegion(rect);
    return rect;
  }

  private applyRegion(rect: Rect): void {
    const o = this.opts;
    const g = ctx2d(o.target);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(rect.x, rect.y, rect.w, rect.h);
    g.drawImage(this.before, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
    g.restore();
    const colored = this.colorize(rect);
    const opacity = o.mode === 'smudge' ? 1 : o.brush.opacity;
    g.save();
    g.globalAlpha = opacity;
    if (o.maskTarget) {
      const lumv = 0.299 * o.color[0] + 0.587 * o.color[1] + 0.114 * o.color[2];
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(colored, 0, 0, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
      if (o.mode !== 'erase') {
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = opacity * lumv;
        g.drawImage(colored, 0, 0, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
      }
    } else if (o.mode === 'erase') {
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(colored, 0, 0, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
    } else {
      g.globalCompositeOperation = o.alphaLock ? 'source-atop' : 'source-over';
      g.drawImage(colored, 0, 0, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
      if (o.brush.glow) {
        g.globalCompositeOperation = o.alphaLock ? 'source-atop' : 'lighter';
        g.globalAlpha = opacity * 0.55;
        const small = glowCanvas(colored, rect.w, rect.h, Math.max(2, o.brush.size * o.sizeScale * 0.6));
        g.drawImage(small.c, 0, 0, small.w, small.h, rect.x, rect.y, rect.w, rect.h);
      }
    }
    g.restore();
  }

  private colorize(rect: Rect): HTMLCanvasElement {
    const o = this.opts;
    const t = scratch(rect.w, rect.h);
    const g = ctx2d(t);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'copy';
    if (this.direct) {
      g.drawImage(this.buffer, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    } else {
      if (o.mode === 'source' && o.source) {
        g.drawImage(o.source.canvas, rect.x + o.source.dx, rect.y + o.source.dy, rect.w, rect.h, 0, 0, rect.w, rect.h);
        g.globalCompositeOperation = 'destination-in';
      } else {
        const c = o.mode === 'erase' || o.maskTarget ? [1, 1, 1] : o.color;
        g.fillStyle = `rgb(${c.map(v => Math.round(v * 255)).join(',')})`;
        g.fillRect(0, 0, rect.w, rect.h);
        g.globalCompositeOperation = 'destination-in';
      }
      g.drawImage(this.buffer, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    }
    const grain = grainLayer(o.brush);
    if (grain) {
      g.globalCompositeOperation = 'destination-in';
      const pat = g.createPattern(grain, 'repeat');
      if (pat) {
        const s = o.brush.grainScale;
        pat.setTransform(new DOMMatrix([s, 0, 0, s, -rect.x, -rect.y]));
        g.fillStyle = pat;
        g.fillRect(0, 0, rect.w, rect.h);
      }
    }
    if (o.selection) {
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(o.selection, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    }
    g.globalCompositeOperation = 'source-over';
    return t;
  }

  replay(endTaper: boolean): void {
    const b = this.opts.brush;
    const full = this.bbox;
    if (!full) return;
    this.bg.setTransform(1, 0, 0, 1, 0, 0);
    this.bg.clearRect(full.x, full.y, full.w, full.h);
    this.random = rng(this.seed);
    this.carried = null;
    const total = this.total;
    const endL = endTaper ? this.taperLen(b.taperEnd) || (this.opts.simulatePressure ? 30 : 0) : 0;
    const samples = this.samples;
    this.samples = [];
    for (const s of samples) {
      this.samples.push(s);
      let f = this.taperStart(s.dist);
      const left = total - s.dist;
      if (endL > 0 && left < endL) f *= 0.12 + 0.88 * Math.sqrt(Math.max(0, left) / endL);
      this.dab(s, f);
    }
    this.dirty = unionRect(full, this.dirty);
  }

  finish(): void {
    if (this.opts.mode !== 'smudge') {
      this.catchUp();
      const b = this.opts.brush;
      if (b.taperEnd > 0 || this.opts.simulatePressure) this.replay(true);
      this.flush();
    }
  }

  restore(): void {
    const g = ctx2d(this.opts.target);
    g.save();
    g.globalCompositeOperation = 'copy';
    g.drawImage(this.before, 0, 0);
    g.restore();
  }

  beforeData(rect: Rect): ImageData {
    return ctx2d(this.before).getImageData(rect.x, rect.y, rect.w, rect.h);
  }

  get rawPoints(): Pt[] {
    return this.raw;
  }

  setShape(path: { x: number; y: number }[], pressure: number): void {
    this.shapePath = path;
    this.shapePressure = pressure;
    const full = this.bbox;
    if (full) {
      const g = ctx2d(this.opts.target);
      g.save();
      g.clearRect(full.x, full.y, full.w, full.h);
      g.drawImage(this.before, full.x, full.y, full.w, full.h, full.x, full.y, full.w, full.h);
      g.restore();
      this.bg.clearRect(full.x, full.y, full.w, full.h);
    }
    this.random = rng(this.seed);
    this.samples = [];
    this.lastSample = null;
    this.sinceDab = 0;
    this.total = 0;
    this.carried = null;
    const prevDirty = full;
    for (const q of path) this.addSample({ x: q.x, y: q.y, p: this.shapePressure, tilt: 0, t: 0 });
    this.dirty = unionRect(prevDirty, this.dirty);
  }
}

let scratchCanvas: HTMLCanvasElement | null = null;

function scratch(w: number, h: number): HTMLCanvasElement {
  if (!scratchCanvas) scratchCanvas = makeCanvas(w, h);
  if (scratchCanvas.width < w || scratchCanvas.height < h) {
    scratchCanvas.width = Math.max(scratchCanvas.width, w);
    scratchCanvas.height = Math.max(scratchCanvas.height, h);
  }
  return scratchCanvas;
}

let glowSmall: HTMLCanvasElement | null = null;

function glowCanvas(src: HTMLCanvasElement, w: number, h: number, radius: number): { c: HTMLCanvasElement; w: number; h: number } {
  const f = Math.max(2, Math.min(16, Math.round(radius / 2)));
  const sw = Math.max(1, Math.round(w / f));
  const sh = Math.max(1, Math.round(h / f));
  if (!glowSmall) glowSmall = makeCanvas(sw, sh);
  if (glowSmall.width < sw || glowSmall.height < sh) {
    glowSmall.width = Math.max(glowSmall.width, sw);
    glowSmall.height = Math.max(glowSmall.height, sh);
  }
  const g = ctx2d(glowSmall);
  g.clearRect(0, 0, glowSmall.width, glowSmall.height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h, 0, 0, sw, sh);
  return { c: glowSmall, w: sw, h: sh };
}

export function symmetryXf(kind: 'vertical' | 'horizontal' | 'quadrant' | 'radial', cx: number, cy: number, rotationDeg: number, radial: number, rotational: boolean): DabXf {
  const base = (rotationDeg * Math.PI) / 180;
  const reflect = (x: number, y: number, a: number, theta: number): [number, number, number] => {
    const ux = Math.cos(theta);
    const uy = Math.sin(theta);
    const vx = x - cx;
    const vy = y - cy;
    const d = vx * ux + vy * uy;
    return [cx + 2 * d * ux - vx, cy + 2 * d * uy - vy, 2 * theta - a];
  };
  const rotate = (x: number, y: number, a: number, phi: number): [number, number, number] => {
    const vx = x - cx;
    const vy = y - cy;
    return [cx + vx * Math.cos(phi) - vy * Math.sin(phi), cy + vx * Math.sin(phi) + vy * Math.cos(phi), a + phi];
  };
  return (x, y, a) => {
    const out: [number, number, number][] = [[x, y, a]];
    if (kind === 'vertical') out.push(rotational ? rotate(x, y, a, Math.PI) : reflect(x, y, a, base + Math.PI / 2));
    else if (kind === 'horizontal') out.push(rotational ? rotate(x, y, a, Math.PI) : reflect(x, y, a, base));
    else if (kind === 'quadrant') {
      if (rotational) for (let k = 1; k < 4; k++) out.push(rotate(x, y, a, (k * Math.PI) / 2));
      else {
        out.push(reflect(x, y, a, base + Math.PI / 2), reflect(x, y, a, base));
        out.push(rotate(x, y, a, Math.PI));
      }
    } else {
      const n = Math.max(2, radial);
      for (let k = 1; k < n; k++) out.push(rotate(x, y, a, (k * 2 * Math.PI) / n));
      if (!rotational) {
        const m = reflect(x, y, a, base + Math.PI / 2);
        for (let k = 0; k < n; k++) out.push(rotate(m[0], m[1], m[2], (k * 2 * Math.PI) / n));
      }
    }
    return out;
  };
}
