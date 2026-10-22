import type { Rect } from './compose';
import { ctx2d, makeCanvas } from './doc';
import { filters } from './filters';

export type SelectMode = 'replace' | 'add' | 'subtract';

export class Selection {
  readonly mask: HTMLCanvasElement;
  saved: HTMLCanvasElement[] = [];
  active = false;
  version = 0;

  constructor(
    public width: number,
    public height: number,
  ) {
    this.mask = makeCanvas(width, height);
  }

  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.mask.width = w;
    this.mask.height = h;
    this.active = false;
    this.version++;
  }

  private g(): CanvasRenderingContext2D {
    return ctx2d(this.mask);
  }

  snapshot(): HTMLCanvasElement | null {
    if (!this.active) return null;
    const c = makeCanvas(this.width, this.height);
    ctx2d(c).drawImage(this.mask, 0, 0);
    return c;
  }

  restore(c: HTMLCanvasElement | null): void {
    const g = this.g();
    g.clearRect(0, 0, this.width, this.height);
    if (c) g.drawImage(c, 0, 0);
    this.active = !!c;
    this.version++;
  }

  clear(): void {
    this.g().clearRect(0, 0, this.width, this.height);
    this.active = false;
    this.version++;
  }

  all(): void {
    const g = this.g();
    g.fillStyle = '#fff';
    g.fillRect(0, 0, this.width, this.height);
    this.active = true;
    this.version++;
  }

  apply(mode: SelectMode, draw: (g: CanvasRenderingContext2D) => void): void {
    const g = this.g();
    g.save();
    if (mode === 'replace' || !this.active) g.clearRect(0, 0, this.width, this.height);
    g.globalCompositeOperation = mode === 'subtract' ? 'destination-out' : 'source-over';
    g.fillStyle = '#fff';
    draw(g);
    g.restore();
    this.active = mode !== 'subtract' || this.active;
    this.version++;
    if (this.bounds() === null) this.active = false;
  }

  path(points: { x: number; y: number }[], mode: SelectMode): void {
    if (points.length < 3) return;
    this.apply(mode, g => {
      g.beginPath();
      points.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath();
      g.fill();
    });
  }

  rect(r: Rect, mode: SelectMode): void {
    this.apply(mode, g => g.fillRect(r.x, r.y, r.w, r.h));
  }

  ellipse(r: Rect, mode: SelectMode): void {
    this.apply(mode, g => {
      g.beginPath();
      g.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.abs(r.w / 2), Math.abs(r.h / 2), 0, 0, Math.PI * 2);
      g.fill();
    });
  }

  fromMask(m: HTMLCanvasElement, mode: SelectMode): void {
    this.apply(mode, g => g.drawImage(m, 0, 0));
  }

  fromAlpha(c: HTMLCanvasElement, mode: SelectMode): void {
    this.apply(mode, g => {
      const t = makeCanvas(this.width, this.height);
      const tg = ctx2d(t);
      tg.drawImage(c, 0, 0);
      tg.globalCompositeOperation = 'source-in';
      tg.fillStyle = '#fff';
      tg.fillRect(0, 0, this.width, this.height);
      g.drawImage(t, 0, 0);
    });
  }

  invert(): void {
    const g = this.g();
    g.save();
    g.globalCompositeOperation = 'xor';
    g.fillStyle = '#fff';
    g.fillRect(0, 0, this.width, this.height);
    g.restore();
    this.active = true;
    this.version++;
    if (this.bounds() === null) this.active = false;
  }

  feather(radius: number): void {
    if (!this.active || radius <= 0) return;
    const f = filters();
    const out = f.run(this.mask, f.blurPasses(radius));
    const g = this.g();
    g.save();
    g.globalCompositeOperation = 'copy';
    g.drawImage(out, 0, 0);
    g.restore();
    this.version++;
  }

  save(): void {
    const s = this.snapshot();
    if (s) this.saved.push(s);
  }

  bounds(): Rect | null {
    const step = Math.max(1, Math.floor(Math.max(this.width, this.height) / 512));
    const sw = Math.ceil(this.width / step);
    const sh = Math.ceil(this.height / step);
    const t = makeCanvas(sw, sh);
    const tg = ctx2d(t);
    tg.drawImage(this.mask, 0, 0, sw, sh);
    const d = tg.getImageData(0, 0, sw, sh).data;
    let x0 = sw;
    let y0 = sh;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++)
        if (d[(y * sw + x) * 4 + 3] > 2) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
    if (x1 < 0) return null;
    const x = Math.max(0, (x0 - 1) * step);
    const y = Math.max(0, (y0 - 1) * step);
    return { x, y, w: Math.min(this.width, (x1 + 2) * step) - x, h: Math.min(this.height, (y1 + 2) * step) - y };
  }
}

export function floodMask(ref: ImageData, sx: number, sy: number, threshold: number, contiguous = true): HTMLCanvasElement {
  const { width: w, height: h, data } = ref;
  const out = makeCanvas(w, h);
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return out;
  const i0 = (y0 * w + x0) * 4;
  const tr = data[i0];
  const tg = data[i0 + 1];
  const tb = data[i0 + 2];
  const ta = data[i0 + 3];
  const tol = threshold * threshold * 4 * 255 * 255;
  const diff = (i: number): number => {
    const dr = data[i] - tr;
    const dg = data[i + 1] - tg;
    const db = data[i + 2] - tb;
    const da = data[i + 3] - ta;
    return dr * dr + dg * dg + db * db + da * da * 1.5;
  };
  const filled = new Uint8Array(w * h);
  const img = new ImageData(w, h);
  const set = (p: number): void => {
    filled[p] = 1;
    const d = diff(p * 4);
    const a = tol > 0 ? Math.min(1, Math.max(0, 1.25 - (d / tol) * 0.5)) : 1;
    img.data[p * 4] = img.data[p * 4 + 1] = img.data[p * 4 + 2] = 255;
    img.data[p * 4 + 3] = a * 255;
  };
  if (!contiguous) {
    for (let p = 0; p < w * h; p++) if (diff(p * 4) <= tol) set(p);
  } else {
    const stack = [y0 * w + x0];
    while (stack.length) {
      const p = stack.pop() as number;
      let x = p % w;
      const y = (p - x) / w;
      while (x >= 0 && !filled[y * w + x] && diff((y * w + x) * 4) <= tol) x--;
      x++;
      let up = false;
      let down = false;
      while (x < w && !filled[y * w + x] && diff((y * w + x) * 4) <= tol) {
        set(y * w + x);
        if (y > 0) {
          const q = (y - 1) * w + x;
          const ok = !filled[q] && diff(q * 4) <= tol;
          if (ok && !up) stack.push(q);
          up = ok;
        }
        if (y < h - 1) {
          const q = (y + 1) * w + x;
          const ok = !filled[q] && diff(q * 4) <= tol;
          if (ok && !down) stack.push(q);
          down = ok;
        }
        x++;
      }
    }
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (filled[p]) continue;
      if ((x > 0 && filled[p - 1]) || (x < w - 1 && filled[p + 1]) || (y > 0 && filled[p - w]) || (y < h - 1 && filled[p + w])) {
        img.data[p * 4] = img.data[p * 4 + 1] = img.data[p * 4 + 2] = 255;
        img.data[p * 4 + 3] = 140;
      }
    }
  ctx2d(out).putImageData(img, 0, 0);
  return out;
}

let stripes: HTMLCanvasElement | null = null;

export function selectionOverlay(sel: Selection, target: HTMLCanvasElement): void {
  if (target.width !== sel.width || target.height !== sel.height) {
    target.width = sel.width;
    target.height = sel.height;
  }
  const g = ctx2d(target);
  g.clearRect(0, 0, target.width, target.height);
  if (!sel.active) return;
  if (!stripes) {
    stripes = makeCanvas(16, 16);
    const s = ctx2d(stripes);
    s.strokeStyle = 'rgba(40,120,255,0.5)';
    s.lineWidth = 4;
    for (let i = -16; i <= 32; i += 8) {
      s.beginPath();
      s.moveTo(i, 0);
      s.lineTo(i - 16, 16);
      s.stroke();
    }
  }
  const pat = g.createPattern(stripes, 'repeat');
  if (!pat) return;
  const scale = Math.max(1, Math.max(sel.width, sel.height) / 1400);
  pat.setTransform(new DOMMatrix([scale, 0, 0, scale, 0, 0]));
  g.fillStyle = pat;
  g.fillRect(0, 0, target.width, target.height);
  g.globalCompositeOperation = 'destination-out';
  g.drawImage(sel.mask, 0, 0);
  g.globalCompositeOperation = 'source-over';
}
