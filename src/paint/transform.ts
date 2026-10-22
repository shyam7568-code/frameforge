import type { Rect } from './compose';
import { ctx2d, makeCanvas } from './doc';

export type XfMode = 'freeform' | 'uniform' | 'distort' | 'warp';

export interface V {
  x: number;
  y: number;
}

const lerp = (a: V, b: V, t: number): V => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function homography(q: V[]): (u: number, v: number) => V {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
  const g = (sx * dy2 - dx2 * sy) / den;
  const hh = (dx1 * sy - sx * dy1) / den;
  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + hh * p3.x;
  const c = p0.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + hh * p3.y;
  const f = p0.y;
  return (u, v) => {
    const w = g * u + hh * v + 1;
    return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w };
  };
}

function bezierPatch(ctrl: V[]): (u: number, v: number) => V {
  const B = (t: number): number[] => [(1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t * t * (1 - t), t ** 3];
  return (u, v) => {
    const bu = B(u);
    const bv = B(v);
    let x = 0;
    let y = 0;
    for (let j = 0; j < 4; j++)
      for (let i = 0; i < 4; i++) {
        const w = bu[i] * bv[j];
        x += ctrl[j * 4 + i].x * w;
        y += ctrl[j * 4 + i].y * w;
      }
    return { x, y };
  };
}

function drawTriangle(g: CanvasRenderingContext2D, img: CanvasImageSource, s: V[], d: V[]): void {
  const [s0, s1, s2] = s;
  const [d0, d1, d2] = d;
  const den = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
  if (Math.abs(den) < 1e-9) return;
  const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / den;
  const b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / den;
  const c = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / den;
  const dd = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / den;
  const e = d0.x - a * s0.x - c * s0.y;
  const f = d0.y - b * s0.x - dd * s0.y;
  const cx = (d0.x + d1.x + d2.x) / 3;
  const cy = (d0.y + d1.y + d2.y) / 3;
  const grow = (p: V): V => {
    const vx = p.x - cx;
    const vy = p.y - cy;
    const l = Math.hypot(vx, vy) || 1;
    return { x: p.x + (vx / l) * 0.7, y: p.y + (vy / l) * 0.7 };
  };
  const [e0, e1, e2] = [grow(d0), grow(d1), grow(d2)];
  g.save();
  g.beginPath();
  g.moveTo(e0.x, e0.y);
  g.lineTo(e1.x, e1.y);
  g.lineTo(e2.x, e2.y);
  g.closePath();
  g.clip();
  g.setTransform(a, b, c, dd, e, f);
  g.drawImage(img, 0, 0);
  g.restore();
}

export class TransformSession {
  readonly before: HTMLCanvasElement;
  readonly content: HTMLCanvasElement;
  readonly hole: HTMLCanvasElement;
  readonly src: Rect;
  corners: V[];
  warp: V[];
  mode: XfMode = 'freeform';
  smooth = true;
  dirty: Rect;
  private selBefore: HTMLCanvasElement | null;

  constructor(
    readonly target: HTMLCanvasElement,
    area: Rect,
    selection: HTMLCanvasElement | null,
  ) {
    const W = target.width;
    const H = target.height;
    this.before = makeCanvas(W, H);
    ctx2d(this.before).drawImage(target, 0, 0);
    this.src = area;
    this.content = makeCanvas(area.w, area.h);
    const cg = ctx2d(this.content);
    cg.drawImage(target, area.x, area.y, area.w, area.h, 0, 0, area.w, area.h);
    this.hole = makeCanvas(W, H);
    const hg = ctx2d(this.hole);
    hg.drawImage(target, 0, 0);
    this.selBefore = null;
    if (selection) {
      this.selBefore = makeCanvas(W, H);
      ctx2d(this.selBefore).drawImage(selection, 0, 0);
      cg.globalCompositeOperation = 'destination-in';
      cg.drawImage(selection, area.x, area.y, area.w, area.h, 0, 0, area.w, area.h);
      hg.globalCompositeOperation = 'destination-out';
      hg.drawImage(selection, 0, 0);
    } else {
      hg.clearRect(area.x, area.y, area.w, area.h);
    }
    this.corners = [
      { x: area.x, y: area.y },
      { x: area.x + area.w, y: area.y },
      { x: area.x + area.w, y: area.y + area.h },
      { x: area.x, y: area.y + area.h },
    ];
    this.warp = this.gridFromCorners();
    this.dirty = { x: 0, y: 0, w: W, h: H };
  }

  gridFromCorners(): V[] {
    const H = homography(this.corners);
    const out: V[] = [];
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) out.push(H(i / 3, j / 3));
    return out;
  }

  map(): (u: number, v: number) => V {
    return this.mode === 'warp' ? bezierPatch(this.warp) : homography(this.corners);
  }

  get affine(): boolean {
    const [a, b, c, d] = this.corners;
    return this.mode !== 'warp' && Math.abs(a.x + c.x - b.x - d.x) < 0.5 && Math.abs(a.y + c.y - b.y - d.y) < 0.5;
  }

  drawInto(g: CanvasRenderingContext2D, img: CanvasImageSource, w: number, h: number): void {
    g.imageSmoothingEnabled = this.smooth;
    g.imageSmoothingQuality = 'high';
    if (this.affine) {
      const [a, b, , d] = this.corners;
      g.save();
      g.setTransform((b.x - a.x) / w, (b.y - a.y) / w, (d.x - a.x) / h, (d.y - a.y) / h, a.x, a.y);
      g.drawImage(img, 0, 0);
      g.restore();
      return;
    }
    const f = this.map();
    const N = this.mode === 'warp' ? 16 : 12;
    const grid: V[] = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) grid.push(f(i / N, j / N));
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const s00 = { x: (i / N) * w, y: (j / N) * h };
        const s10 = { x: ((i + 1) / N) * w, y: (j / N) * h };
        const s01 = { x: (i / N) * w, y: ((j + 1) / N) * h };
        const s11 = { x: ((i + 1) / N) * w, y: ((j + 1) / N) * h };
        const d00 = grid[j * (N + 1) + i];
        const d10 = grid[j * (N + 1) + i + 1];
        const d01 = grid[(j + 1) * (N + 1) + i];
        const d11 = grid[(j + 1) * (N + 1) + i + 1];
        drawTriangle(g, img, [s00, s10, s11], [d00, d10, d11]);
        drawTriangle(g, img, [s00, s11, s01], [d00, d11, d01]);
      }
  }

  render(): void {
    const g = ctx2d(this.target);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'copy';
    g.drawImage(this.hole, 0, 0);
    g.globalCompositeOperation = 'source-over';
    this.drawInto(g, this.content, this.src.w, this.src.h);
    g.restore();
  }

  transformSelection(sel: HTMLCanvasElement): void {
    if (!this.selBefore) return;
    const piece = makeCanvas(this.src.w, this.src.h);
    ctx2d(piece).drawImage(this.selBefore, this.src.x, this.src.y, this.src.w, this.src.h, 0, 0, this.src.w, this.src.h);
    const g = ctx2d(sel);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, sel.width, sel.height);
    this.drawInto(g, piece, this.src.w, this.src.h);
    g.restore();
  }

  restore(): void {
    const g = ctx2d(this.target);
    g.save();
    g.globalCompositeOperation = 'copy';
    g.drawImage(this.before, 0, 0);
    g.restore();
  }

  center(): V {
    const c = this.corners;
    return { x: (c[0].x + c[1].x + c[2].x + c[3].x) / 4, y: (c[0].y + c[1].y + c[2].y + c[3].y) / 4 };
  }

  handles(): { id: string; p: V }[] {
    if (this.mode === 'warp') return this.warp.map((p, i) => ({ id: `w${i}`, p }));
    const c = this.corners;
    const out = c.map((p, i) => ({ id: `c${i}`, p }));
    for (let i = 0; i < 4; i++) out.push({ id: `e${i}`, p: lerp(c[i], c[(i + 1) % 4], 0.5) });
    const top = lerp(c[0], c[1], 0.5);
    const ctr = this.center();
    const L = Math.hypot(top.x - ctr.x, top.y - ctr.y) || 1;
    out.push({ id: 'rot', p: { x: top.x + ((top.x - ctr.x) / L) * 40, y: top.y + ((top.y - ctr.y) / L) * 40 } });
    return out;
  }

  rotate(rad: number, about = this.center()): void {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const r = (p: V): V => ({ x: about.x + (p.x - about.x) * c - (p.y - about.y) * s, y: about.y + (p.x - about.x) * s + (p.y - about.y) * c });
    this.corners = this.corners.map(r);
    this.warp = this.warp.map(r);
  }

  translate(dx: number, dy: number): void {
    this.corners = this.corners.map(p => ({ x: p.x + dx, y: p.y + dy }));
    this.warp = this.warp.map(p => ({ x: p.x + dx, y: p.y + dy }));
  }

  flip(horizontal: boolean): void {
    const [a, b, c, d] = this.corners;
    this.corners = horizontal ? [b, a, d, c] : [d, c, b, a];
    const w = this.warp;
    this.warp = w.map((_, i) => {
      const x = i % 4;
      const y = Math.floor(i / 4);
      return horizontal ? w[y * 4 + (3 - x)] : w[(3 - y) * 4 + x];
    });
  }

  fit(W: number, H: number): void {
    const s = Math.min(W / this.src.w, H / this.src.h);
    const w = this.src.w * s;
    const h = this.src.h * s;
    const x = (W - w) / 2;
    const y = (H - h) / 2;
    this.corners = [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ];
    this.warp = this.gridFromCorners();
  }

  drag(id: string, start: V[], startWarp: V[], from: V, to: V, snap: boolean, uniformOverride: boolean): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (id === 'move') {
      this.corners = start.map(p => ({ x: p.x + dx, y: p.y + dy }));
      this.warp = startWarp.map(p => ({ x: p.x + dx, y: p.y + dy }));
      return;
    }
    if (id.startsWith('w')) {
      const i = Number(id.slice(1));
      this.warp = startWarp.slice();
      this.warp[i] = { x: startWarp[i].x + dx, y: startWarp[i].y + dy };
      return;
    }
    if (id === 'rot') {
      const c = {
        x: (start[0].x + start[1].x + start[2].x + start[3].x) / 4,
        y: (start[0].y + start[1].y + start[2].y + start[3].y) / 4,
      };
      let a = Math.atan2(to.y - c.y, to.x - c.x) - Math.atan2(from.y - c.y, from.x - c.x);
      if (snap) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      this.corners = start.slice();
      this.warp = startWarp.slice();
      this.rotate(a, c);
      return;
    }
    const idx = Number(id.slice(1));
    if (this.mode === 'distort') {
      this.corners = start.slice();
      if (id[0] === 'c') this.corners[idx] = { x: start[idx].x + dx, y: start[idx].y + dy };
      else {
        const j = (idx + 1) % 4;
        this.corners[idx] = { x: start[idx].x + dx, y: start[idx].y + dy };
        this.corners[j] = { x: start[j].x + dx, y: start[j].y + dy };
      }
      this.warp = this.gridFromCorners();
      return;
    }
    const uniform = this.mode === 'uniform' || uniformOverride;
    const ux = { x: start[1].x - start[0].x, y: start[1].y - start[0].y };
    const uy = { x: start[3].x - start[0].x, y: start[3].y - start[0].y };
    const lx = Math.hypot(ux.x, ux.y) || 1;
    const ly = Math.hypot(uy.x, uy.y) || 1;
    const ex = { x: ux.x / lx, y: ux.y / lx };
    const ey = { x: uy.x / ly, y: uy.y / ly };
    const proj = (v: V, e: V): number => v.x * e.x + v.y * e.y;
    let sx = 1;
    let sy = 1;
    let ax = 0;
    let ay = 0;
    const d = { x: dx, y: dy };
    if (id[0] === 'c') {
      const signs = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ][idx];
      sx = 1 + (signs[0] * proj(d, ex)) / lx;
      sy = 1 + (signs[1] * proj(d, ey)) / ly;
      ax = signs[0] < 0 ? 1 : 0;
      ay = signs[1] < 0 ? 1 : 0;
      if (uniform) sx = sy = (sx + sy) / 2;
    } else {
      if (idx === 0 || idx === 2) {
        sy = 1 + ((idx === 0 ? -1 : 1) * proj(d, ey)) / ly;
        ay = idx === 0 ? 1 : 0;
        ax = 0.5;
        if (uniform) sx = sy;
      } else {
        sx = 1 + ((idx === 3 ? -1 : 1) * proj(d, ex)) / lx;
        ax = idx === 3 ? 1 : 0;
        ay = 0.5;
        if (uniform) sy = sx;
      }
    }
    const anchor = { x: start[0].x + ux.x * ax + uy.x * ay, y: start[0].y + ux.y * ax + uy.y * ay };
    this.corners = start.map(p => {
      const v = { x: p.x - anchor.x, y: p.y - anchor.y };
      const a = proj(v, ex) * sx;
      const b = proj(v, ey) * sy;
      return { x: anchor.x + ex.x * a + ey.x * b, y: anchor.y + ex.y * a + ey.y * b };
    });
    this.warp = this.gridFromCorners();
  }
}
