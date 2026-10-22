import type { App } from './app';
import { LIQUIFY_MODES } from './adjust';
import { ctx2d, makeCanvas } from './doc';
import type { Pt } from './engine';
import { floodMask } from './selection';
import { moveHandle, shapeHandles, type Shape } from './shapes';
import type { V } from './transform';
import { toast } from '../util';

interface PointerInfo {
  id: number;
  type: string;
  x: number;
  y: number;
  sx: number;
  sy: number;
  t0: number;
  moved: number;
}

type Mode = 'idle' | 'draw' | 'gesture' | 'pan' | 'rotate' | 'select' | 'xf' | 'text' | 'liquify' | 'eyedrop' | 'shape' | 'guide' | 'none';

const HANDLE = 14;

export class View {
  readonly root = document.createElement('div');
  readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  tx = 0;
  ty = 0;
  scale = 1;
  rot = 0;
  flipX = false;
  private dpr = 1;
  private pointers = new Map<number, PointerInfo>();
  private mode: Mode = 'idle';
  private penSeen = false;
  private raf = 0;
  private needs = true;
  private gesture: { c0: V; d0: number; a0: number; m0: DOMMatrix; t0: number; count: number; maxMove: number; undoTimer: number; undos: number } | null = null;
  private holdTimer = 0;
  private shapeArmed = false;
  private lastPt: Pt | null = null;
  private lastMove = { x: 0, y: 0, t: 0 };
  private strokeStartedAt = 0;
  private hover: V | null = null;
  private hoverType = 'mouse';
  private loupe: { x: number; y: number; color: string; prev: string } | null = null;
  private selPath: V[] = [];
  private polyPts: V[] = [];
  private selStart: V | null = null;
  private autoSel: { x: number; y: number; sx: number; threshold: number; data: ImageData; mask: HTMLCanvasElement | null; pending: boolean } | null = null;
  private xfDrag: { id: string; start: V[]; warp: V[]; from: V } | null = null;
  private textDrag: { id: string; from: V; x: number; y: number; scale: number; rotation: number } | null = null;
  private shapeDrag: { index: number; base: Shape } | null = null;
  private heldShape: { base: Shape; from: V } | null = null;
  private guideDrag: number | null = null;
  private liqLast: V | null = null;
  private spaceDown = false;
  private checker: CanvasPattern | null = null;
  private autoPreview: HTMLCanvasElement | null = null;
  onUiToggle: () => void = () => undefined;
  onColorPicked: () => void = () => undefined;

  constructor(private readonly app: App) {
    this.root.className = 'pv-root';
    this.canvas.className = 'pv-canvas';
    this.root.append(this.canvas);
    const g = this.canvas.getContext('2d', { alpha: false });
    if (!g) throw new Error('Canvas is not available.');
    this.g = g;
    new ResizeObserver(() => this.resize()).observe(this.root);
    this.canvas.addEventListener('pointerdown', e => this.down(e));
    this.canvas.addEventListener('pointermove', e => this.move(e));
    this.canvas.addEventListener('pointerup', e => this.up(e));
    this.canvas.addEventListener('pointercancel', e => this.up(e, true));
    this.canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      this.request();
    });
    this.canvas.addEventListener('wheel', e => this.wheel(e), { passive: false });
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    for (const ev of ['gesturestart', 'gesturechange', 'touchmove']) this.canvas.addEventListener(ev, e => e.preventDefault(), { passive: false });
    window.addEventListener('keydown', e => {
      if (e.code === 'Space' && !(e.target as HTMLElement).closest('input,textarea,select')) {
        this.spaceDown = true;
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', e => {
      if (e.code === 'Space') this.spaceDown = false;
    });
    app.on(w => {
      if (w === 'render' || w === 'selection' || w === 'shape' || w === 'tool' || w === 'guides' || w === 'prefs') this.request();
      if (w === 'doc') this.fit();
    });
    this.loop();
  }

  private resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    this.canvas.width = Math.max(1, Math.round(w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(h * this.dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    if (!this.fitted) this.fit();
    this.request();
  }

  private fitted = false;

  fit(): void {
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    if (!w || !h) return;
    const d = this.app.doc;
    this.scale = Math.min((w - 40) / d.width, (h - 40) / d.height);
    this.rot = 0;
    this.flipX = false;
    this.tx = w / 2 - (d.width * this.scale) / 2;
    this.ty = h / 2 - (d.height * this.scale) / 2;
    this.fitted = true;
    this.app.zoom = this.scale;
    this.request();
    this.app.emit('view');
  }

  actualSize(): void {
    const c = this.screenCenter();
    const p = this.toDoc(c.x, c.y);
    this.scale = 1;
    this.rot = 0;
    const s = this.toScreenRaw(p.x, p.y);
    this.tx += c.x - s.x;
    this.ty += c.y - s.y;
    this.app.zoom = 1;
    this.request();
    this.app.emit('view');
  }

  flipView(): void {
    const c = this.screenCenter();
    const p = this.toDoc(c.x, c.y);
    this.flipX = !this.flipX;
    const s = this.toScreenRaw(p.x, p.y);
    this.tx += c.x - s.x;
    this.ty += c.y - s.y;
    this.request();
  }

  private screenCenter(): V {
    return { x: this.root.clientWidth / 2, y: this.root.clientHeight / 2 };
  }

  matrix(): DOMMatrix {
    return new DOMMatrix()
      .translate(this.tx, this.ty)
      .rotate((this.rot * 180) / Math.PI)
      .scale(this.flipX ? -this.scale : this.scale, this.scale)
      .translate(this.flipX ? -this.app.doc.width : 0, 0);
  }

  private setMatrix(m: DOMMatrix): void {
    const sx = Math.hypot(m.a, m.b);
    this.scale = Math.max(0.02, Math.min(64, sx));
    this.rot = this.flipX ? Math.atan2(-m.b, -m.a) : Math.atan2(m.b, m.a);
    const probe = new DOMMatrix()
      .rotate((this.rot * 180) / Math.PI)
      .scale(this.flipX ? -this.scale : this.scale, this.scale)
      .translate(this.flipX ? -this.app.doc.width : 0, 0);
    this.tx = m.e - probe.e;
    this.ty = m.f - probe.f;
    this.app.zoom = this.scale;
  }

  toDoc(x: number, y: number): V {
    const p = this.matrix().inverse().transformPoint(new DOMPoint(x, y));
    return { x: p.x, y: p.y };
  }

  private toScreenRaw(x: number, y: number): V {
    const p = this.matrix().transformPoint(new DOMPoint(x, y));
    return { x: p.x, y: p.y };
  }

  toScreen(p: V): V {
    return this.toScreenRaw(p.x, p.y);
  }

  private local(e: PointerEvent | WheelEvent): V {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private pt(e: PointerEvent): Pt {
    const l = this.local(e);
    const d = this.toDoc(l.x, l.y);
    const tilt = e.pointerType === 'pen' ? Math.min(1, Math.hypot(e.tiltX || 0, e.tiltY || 0) / 70) : 0;
    const p = e.pointerType === 'pen' ? e.pressure || 0.5 : 1;
    return { x: d.x, y: d.y, p, tilt, t: e.timeStamp };
  }

  request(): void {
    this.needs = true;
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (this.app.stroke || this.app.shapeEdit) {
      if (this.app.flushStroke()) this.needs = true;
    }
    if (this.mode === 'draw' && !this.heldShape && this.shapeArmed && this.lastPt && performance.now() - this.lastMove.t > 600) {
      this.shapeArmed = false;
      this.tryShape(this.lastPt);
    }
    if (this.autoSel?.pending) this.runAutoSel();
    if (this.app.adjust?.liquify && this.liqDirty) {
      this.app.adjust.liquify.render();
      this.app.recompose();
      this.liqDirty = false;
      this.needs = true;
    }
    if (!this.needs || this.app.mode3d) return;
    this.needs = false;
    this.draw();
  };

  private liqDirty = false;

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  private draw(): void {
    const g = this.g;
    const app = this.app;
    const d = app.doc;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = app.prefs.light ? '#d9d9de' : '#1f1f23';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!app.open) return;
    const m = new DOMMatrix().scale(this.dpr, this.dpr).multiply(this.matrix());
    g.setTransform(m);
    g.shadowColor = 'rgba(0,0,0,0.45)';
    g.shadowBlur = 18 * this.dpr;
    g.fillStyle = '#000';
    g.fillRect(0, 0, d.width, d.height);
    g.shadowBlur = 0;
    if (!d.bgVisible) {
      if (!this.checker) {
        const c = makeCanvas(16, 16);
        const cg = ctx2d(c);
        cg.fillStyle = '#fff';
        cg.fillRect(0, 0, 16, 16);
        cg.fillStyle = '#d0d0d4';
        cg.fillRect(0, 0, 8, 8);
        cg.fillRect(8, 8, 8, 8);
        this.checker = g.createPattern(c, 'repeat');
      }
      if (this.checker) {
        this.checker.setTransform(new DOMMatrix().scale(1 / this.scale, 1 / this.scale));
        g.fillStyle = this.checker;
        g.fillRect(0, 0, d.width, d.height);
      }
    }
    g.imageSmoothingEnabled = this.scale < 2;
    g.imageSmoothingQuality = 'high';
    g.drawImage(app.composite, 0, 0);
    if (app.selection.active && app.tool !== 'transform') g.drawImage(app.selOverlay, 0, 0);
    if (this.autoSel && this.autoPreview) g.drawImage(this.autoPreview, 0, 0);
    this.drawGuides(m);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawSelectionPreview();
    this.drawTransform();
    this.drawShapeHandles();
    this.drawGuideHandles();
    this.drawCursor();
    this.drawLoupe();
  }

  private line(a: V, b: V): void {
    const s1 = this.toScreen(a);
    const s2 = this.toScreen(b);
    this.g.moveTo(s1.x, s1.y);
    this.g.lineTo(s2.x, s2.y);
  }

  private drawGuides(_m: DOMMatrix): void {
    const app = this.app;
    const gd = app.doc.guides;
    if (gd.type === 'none') return;
    const g = this.g;
    const d = app.doc;
    g.save();
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalAlpha = gd.opacity;
    g.strokeStyle = gd.color;
    g.lineWidth = gd.thickness;
    g.beginPath();
    const W = d.width;
    const H = d.height;
    const clipDoc = (): void => {
      const c = [this.toScreen({ x: 0, y: 0 }), this.toScreen({ x: W, y: 0 }), this.toScreen({ x: W, y: H }), this.toScreen({ x: 0, y: H })];
      g.save();
      g.beginPath();
      c.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath();
      g.clip();
      g.beginPath();
    };
    clipDoc();
    if (gd.type === 'grid') {
      for (let x = 0; x <= W; x += gd.size) this.line({ x, y: 0 }, { x, y: H });
      for (let y = 0; y <= H; y += gd.size) this.line({ x: 0, y }, { x: W, y });
    } else if (gd.type === 'isometric') {
      const t = Math.tan(Math.PI / 6);
      const span = W + H;
      for (let x = -span; x <= span; x += gd.size) {
        this.line({ x, y: 0 }, { x, y: H });
        this.line({ x, y: 0 }, { x: x + H / t, y: H });
        this.line({ x, y: 0 }, { x: x - H / t, y: H });
      }
    } else if (gd.type === 'perspective') {
      const R = Math.hypot(W, H) * 3;
      gd.points.forEach(vp => {
        for (let k = 0; k < 36; k++) {
          const a = (k / 36) * Math.PI * 2;
          this.line(vp, { x: vp.x + Math.cos(a) * R, y: vp.y + Math.sin(a) * R });
        }
      });
      if (gd.points.length >= 2) {
        const [a, b] = gd.points;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const L = Math.hypot(dx, dy) || 1;
        this.line({ x: a.x - (dx / L) * R, y: a.y - (dy / L) * R }, { x: b.x + (dx / L) * R, y: b.y + (dy / L) * R });
      }
    } else if (gd.type === 'symmetry') {
      const R = Math.hypot(W, H);
      const base = (gd.rotation * Math.PI) / 180;
      const c = { x: gd.cx, y: gd.cy };
      const axes = gd.symmetry === 'vertical' ? [base + Math.PI / 2] : gd.symmetry === 'horizontal' ? [base] : gd.symmetry === 'quadrant' ? [base, base + Math.PI / 2] : Array.from({ length: gd.radial }, (_, k) => base + Math.PI / 2 + (k * Math.PI) / gd.radial);
      for (const a of axes) this.line({ x: c.x - Math.cos(a) * R, y: c.y - Math.sin(a) * R }, { x: c.x + Math.cos(a) * R, y: c.y + Math.sin(a) * R });
    }
    g.stroke();
    g.restore();
    g.restore();
  }

  private guideHandlePoints(): V[] {
    const gd = this.app.doc.guides;
    if (!this.app.guideEditing) return [];
    if (gd.type === 'perspective') return gd.points;
    if (gd.type === 'symmetry') return [{ x: gd.cx, y: gd.cy }];
    return [];
  }

  private drawGuideHandles(): void {
    const g = this.g;
    for (const p of this.guideHandlePoints()) {
      const s = this.toScreen(p);
      g.beginPath();
      g.arc(s.x, s.y, 10, 0, Math.PI * 2);
      g.fillStyle = '#3d8bf0';
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = '#fff';
      g.stroke();
    }
  }

  private drawSelectionPreview(): void {
    const g = this.g;
    const path = this.selPath.length ? this.selPath : this.polyPts;
    if (this.mode === 'select' && this.selStart && (this.app.selectTool === 'rect' || this.app.selectTool === 'ellipse') && this.selPath.length) {
      const a = this.selStart;
      const b = this.selPath[this.selPath.length - 1];
      const pts = this.app.selectTool === 'rect' ? [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }] : Array.from({ length: 48 }, (_, i) => {
        const t = (i / 48) * Math.PI * 2;
        return { x: (a.x + b.x) / 2 + (Math.cos(t) * (b.x - a.x)) / 2, y: (a.y + b.y) / 2 + (Math.sin(t) * (b.y - a.y)) / 2 };
      });
      this.dash(pts, true);
      return;
    }
    if (path.length > 1) this.dash(path, this.selPath.length > 0);
    if (this.polyPts.length) {
      for (const p of this.polyPts) {
        const s = this.toScreen(p);
        g.fillStyle = '#fff';
        g.fillRect(s.x - 3, s.y - 3, 6, 6);
      }
    }
  }

  private dash(pts: V[], closed: boolean): void {
    const g = this.g;
    g.beginPath();
    pts.forEach((p, i) => {
      const s = this.toScreen(p);
      if (i) g.lineTo(s.x, s.y);
      else g.moveTo(s.x, s.y);
    });
    if (closed) g.closePath();
    g.lineWidth = 1.5;
    g.setLineDash([6, 4]);
    g.strokeStyle = '#fff';
    g.stroke();
    g.lineDashOffset = 5;
    g.strokeStyle = '#000';
    g.stroke();
    g.setLineDash([]);
    g.lineDashOffset = 0;
  }

  private drawTransform(): void {
    const app = this.app;
    if (app.tool !== 'transform') return;
    const g = this.g;
    if (app.xf) {
      const xf = app.xf;
      const c = xf.corners.map(p => this.toScreen(p));
      g.beginPath();
      if (xf.mode === 'warp') {
        const w = xf.warp.map(p => this.toScreen(p));
        for (let j = 0; j < 4; j++) {
          for (let i = 0; i < 4; i++) {
            const p = w[j * 4 + i];
            if (i) g.lineTo(p.x, p.y);
            else g.moveTo(p.x, p.y);
          }
        }
        for (let i = 0; i < 4; i++) {
          for (let j = 0; j < 4; j++) {
            const p = w[j * 4 + i];
            if (j) g.lineTo(p.x, p.y);
            else g.moveTo(p.x, p.y);
          }
        }
      } else {
        c.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
        g.closePath();
      }
      g.lineWidth = 1.5;
      g.strokeStyle = '#3d8bf0';
      g.stroke();
      for (const h of xf.handles()) this.handle(this.toScreen(h.p), h.id === 'rot' ? '#2fbf71' : '#fff');
    } else {
      const box = app.textBox();
      if (!box) return;
      const t = app.layer.text;
      if (!t) return;
      const pts = this.textCorners(box).map(p => this.toScreen(p));
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath();
      g.strokeStyle = '#3d8bf0';
      g.lineWidth = 1.5;
      g.stroke();
      pts.forEach(p => this.handle(p, '#fff'));
      this.handle(this.toScreen(this.textRotHandle(box)), '#2fbf71');
    }
  }

  private textCorners(box: { x: number; y: number; w: number; h: number }): V[] {
    const t = this.app.layer.text;
    const a = ((t?.rotation ?? 0) * Math.PI) / 180;
    const ox = t?.x ?? 0;
    const oy = t?.y ?? 0;
    const r = (p: V): V => ({ x: ox + (p.x - ox) * Math.cos(a) - (p.y - oy) * Math.sin(a), y: oy + (p.x - ox) * Math.sin(a) + (p.y - oy) * Math.cos(a) });
    return [
      { x: box.x, y: box.y },
      { x: box.x + box.w, y: box.y },
      { x: box.x + box.w, y: box.y + box.h },
      { x: box.x, y: box.y + box.h },
    ].map(r);
  }

  private textRotHandle(box: { x: number; y: number; w: number; h: number }): V {
    const c = this.textCorners(box);
    const top = { x: (c[0].x + c[1].x) / 2, y: (c[0].y + c[1].y) / 2 };
    const t = this.app.layer.text;
    const a = (((t?.rotation ?? 0) - 90) * Math.PI) / 180;
    const off = 40 / this.scale;
    return { x: top.x + Math.cos(a) * off, y: top.y + Math.sin(a) * off };
  }

  private handle(p: V, color: string): void {
    const g = this.g;
    g.beginPath();
    g.arc(p.x, p.y, 7, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = '#1b6fe0';
    g.stroke();
  }

  private drawShapeHandles(): void {
    const se = this.app.shapeEdit;
    if (!se || this.app.stroke) return;
    for (const p of shapeHandles(se.shape)) this.handle(this.toScreen(p), '#ffb347');
  }

  private drawCursor(): void {
    const app = this.app;
    if (!this.hover || !app.prefs.cursor || this.hoverType === 'touch') return;
    if (!['brush', 'smudge', 'erase'].includes(app.tool) && !(app.tool === 'adjust' && app.adjust && (app.adjust.mode === 'pencil' || app.adjust.kind === 'liquify' || app.adjust.kind === 'clone'))) return;
    const g = this.g;
    const s = this.toScreen(this.hover);
    let r: number;
    if (app.adjust?.kind === 'liquify') r = (app.adjust.values.size / 2) * this.scale;
    else {
      const b = app.brush();
      r = Math.max(2, (b.size * (app.prefs.dynamicSize ? 1 / this.scale : 1) * this.scale) / 2);
    }
    g.beginPath();
    g.arc(s.x, s.y, r, 0, Math.PI * 2);
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.stroke();
    g.beginPath();
    g.arc(s.x, s.y, r + 1, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.stroke();
    if (app.adjust?.kind === 'clone' && app.adjust.cloneSource) {
      const off = app.adjust.cloneOffset;
      const src = off ? { x: this.hover.x + off.dx, y: this.hover.y + off.dy } : app.adjust.cloneSource;
      const q = this.toScreen(src);
      g.beginPath();
      g.arc(q.x, q.y, r, 0, Math.PI * 2);
      g.setLineDash([4, 4]);
      g.strokeStyle = '#ffb347';
      g.stroke();
      g.setLineDash([]);
    }
  }

  private drawLoupe(): void {
    const l = this.loupe;
    if (!l) return;
    const g = this.g;
    const R = 46;
    const cx = l.x;
    const cy = l.y - 80;
    g.save();
    g.lineWidth = 16;
    g.beginPath();
    g.arc(cx, cy, R, -Math.PI, 0);
    g.strokeStyle = l.color;
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI);
    g.strokeStyle = l.prev;
    g.stroke();
    g.lineWidth = 2;
    g.strokeStyle = '#fff';
    g.beginPath();
    g.arc(cx, cy, R + 9, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, R - 9, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }

  private rgbHex(c: [number, number, number]): string {
    return `#${c.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
  }

  private eyedropAt(e: PointerEvent): void {
    const l = this.local(e);
    const d = this.toDoc(l.x, l.y);
    const c = this.app.sample(d.x, d.y);
    if (c) {
      this.app.setColor(c);
      this.onColorPicked();
    }
    this.loupe = { x: l.x, y: l.y, color: this.rgbHex(c ?? this.app.color), prev: this.loupe?.prev ?? this.rgbHex(this.app.color) };
    this.request();
  }

  startEyedrop(): void {
    this.mode = 'eyedrop';
  }

  eyedropArmed = false;

  private canDraw(type: string): boolean {
    if (type === 'pen' || type === 'mouse') return true;
    return this.app.prefs.touchPaint && !this.penSeen;
  }

  private down(e: PointerEvent): void {
    const app = this.app;
    if (!app.open) return;
    if (e.pointerType === 'pen') this.penSeen = true;
    const l = this.local(e);
    this.pointers.set(e.pointerId, { id: e.pointerId, type: e.pointerType, x: l.x, y: l.y, sx: l.x, sy: l.y, t0: performance.now(), moved: 0 });
    this.canvas.setPointerCapture(e.pointerId);
    const touches = [...this.pointers.values()].filter(p => p.type === 'touch');
    if (e.pointerType === 'touch' && touches.length >= 2) {
      if (this.mode === 'draw' && performance.now() - this.strokeStartedAt < 300) app.cancelStroke();
      else if (this.mode === 'draw') {
        if (this.heldShape) this.heldShape = null;
        app.endStroke();
      }
      if (this.mode === 'eyedrop') this.endEyedrop(false);
      this.selPath = [];
      this.startGesture();
      return;
    }
    if (this.mode === 'gesture') return;
    if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
      this.mode = 'pan';
      return;
    }
    if (e.button === 2) {
      this.mode = 'rotate';
      return;
    }
    const d = this.toDoc(l.x, l.y);
    if (this.eyedropArmed || (e.altKey && e.button === 0 && app.tool !== 'adjust')) {
      this.eyedropArmed = false;
      this.mode = 'eyedrop';
      this.eyedropAt(e);
      return;
    }
    if (app.guideEditing) {
      const hit = this.guideHandlePoints().findIndex(p => {
        const s = this.toScreen(p);
        return Math.hypot(s.x - l.x, s.y - l.y) < 22;
      });
      if (hit >= 0) {
        this.mode = 'guide';
        this.guideDrag = hit;
        return;
      }
    }
    if (app.shapeEdit && !app.stroke) {
      const hs = shapeHandles(app.shapeEdit.shape);
      const hit = hs.findIndex(p => {
        const s = this.toScreen(p);
        return Math.hypot(s.x - l.x, s.y - l.y) < 22;
      });
      if (hit >= 0) {
        this.mode = 'shape';
        this.shapeDrag = { index: hit, base: app.shapeEdit.shape };
        return;
      }
      app.finishShapeEdit();
    }
    if (e.pointerType === 'touch' && !this.canDraw('touch') && !['select', 'transform'].includes(app.tool)) {
      this.mode = 'pan';
      this.armHold(e);
      return;
    }
    switch (app.tool) {
      case 'brush':
      case 'smudge':
      case 'erase':
        this.beginDraw(e);
        break;
      case 'adjust':
        this.adjustDown(e, d);
        break;
      case 'select':
        this.selectDown(e, d);
        break;
      case 'transform':
        this.xfDown(l, d);
        break;
    }
  }

  private beginDraw(e: PointerEvent): void {
    const pt = this.pt(e);
    if (!this.app.beginStroke(pt, undefined, e.pointerType)) {
      this.mode = 'none';
      return;
    }
    this.mode = 'draw';
    this.strokeStartedAt = performance.now();
    this.lastMove = { x: pt.x, y: pt.y, t: performance.now() };
    this.lastPt = pt;
    this.shapeArmed = false;
    if (e.pointerType === 'touch') this.armHold(e);
  }

  private armHold(e: PointerEvent): void {
    clearTimeout(this.holdTimer);
    const id = e.pointerId;
    this.holdTimer = window.setTimeout(() => {
      const p = this.pointers.get(id);
      if (!p || p.moved > 8 || this.pointers.size !== 1) return;
      if (this.mode === 'draw') this.app.cancelStroke();
      if (this.mode === 'draw' || this.mode === 'pan' || this.mode === 'idle') {
        if (this.app.tool === 'adjust' && this.app.adjust?.kind === 'clone') {
          const d = this.toDoc(p.x, p.y);
          this.app.adjust.cloneSource = d;
          this.app.adjust.cloneOffset = null;
          this.mode = 'none';
          toast('Clone source set');
          return;
        }
        this.mode = 'eyedrop';
        this.loupe = { x: p.x, y: p.y, color: this.rgbHex(this.app.color), prev: this.rgbHex(this.app.color) };
        const d = this.toDoc(p.x, p.y);
        const c = this.app.sample(d.x, d.y);
        if (c) {
          this.app.setColor(c);
          this.onColorPicked();
          this.loupe.color = this.rgbHex(c);
        }
        this.request();
      }
    }, this.app.prefs.holdDelay);
  }

  private adjustDown(e: PointerEvent, d: V): void {
    const a = this.app.adjust;
    if (!a) return;
    if (a.kind === 'liquify') {
      this.mode = 'liquify';
      this.liqLast = d;
      return;
    }
    if (a.kind === 'clone' && (e.altKey || !a.cloneSource)) {
      if (e.altKey || e.pointerType !== 'touch') {
        a.cloneSource = d;
        a.cloneOffset = null;
        toast('Clone source set. Now paint to copy from it.');
        this.mode = 'none';
        return;
      }
    }
    if (a.kind === 'clone' || a.mode === 'pencil') this.beginDraw(e);
    else {
      this.mode = 'pan';
    }
  }

  private selectDown(e: PointerEvent, d: V): void {
    const app = this.app;
    this.mode = 'select';
    this.selStart = d;
    this.selPath = [];
    if (app.selectTool === 'auto') {
      const layer = app.layer;
      const src = layer.kind === 'group' ? app.composite : layer.canvas;
      this.autoSel = { x: d.x, y: d.y, sx: this.local(e).x, threshold: 0.12, data: ctx2d(src).getImageData(0, 0, app.doc.width, app.doc.height), mask: null, pending: true };
      toast('Drag left or right to change the threshold');
    } else if (app.selectTool === 'freehand') {
      if (this.polyPts.length) {
        const first = this.toScreen(this.polyPts[0]);
        const l = this.local(e);
        if (Math.hypot(first.x - l.x, first.y - l.y) < 18 && this.polyPts.length > 2) {
          app.selection.path(this.polyPts, app.selectMode);
          this.polyPts = [];
          this.mode = 'none';
          app.selectionChanged();
          return;
        }
      }
    }
  }

  private runAutoSel(): void {
    const a = this.autoSel;
    if (!a) return;
    a.pending = false;
    a.mask = floodMask(a.data, a.x, a.y, a.threshold);
    if (!this.autoPreview) this.autoPreview = makeCanvas(a.mask.width, a.mask.height);
    if (this.autoPreview.width !== a.mask.width || this.autoPreview.height !== a.mask.height) {
      this.autoPreview.width = a.mask.width;
      this.autoPreview.height = a.mask.height;
    }
    const ov = ctx2d(this.autoPreview);
    ov.globalCompositeOperation = 'copy';
    ov.drawImage(a.mask, 0, 0);
    ov.globalCompositeOperation = 'source-in';
    ov.fillStyle = 'rgba(47,123,255,0.45)';
    ov.fillRect(0, 0, a.mask.width, a.mask.height);
    ov.globalCompositeOperation = 'source-over';
    this.request();
    this.app.emit('autoselect');
  }

  get autoThreshold(): number | null {
    return this.autoSel ? this.autoSel.threshold : null;
  }

  private xfDown(l: V, d: V): void {
    const app = this.app;
    if (app.xf) {
      const inside = this.inQuad(d, app.xf.corners);
      const near = app.xf
        .handles()
        .map(h => {
          const s = this.toScreen(h.p);
          return { id: h.id, dist: Math.hypot(s.x - l.x, s.y - l.y) };
        })
        .filter(h => h.dist < HANDLE + 6)
        .sort((a, b) => a.dist - b.dist);
      const precise = near.find(h => !inside || h.dist < 9 || h.id === 'rot' || h.id.startsWith('w'));
      const id = precise ? precise.id : inside || app.xf.mode === 'warp' ? 'move' : 'rot';
      this.xfDrag = { id, start: app.xf.corners.map(p => ({ ...p })), warp: app.xf.warp.map(p => ({ ...p })), from: d };
      this.mode = 'xf';
      return;
    }
    const t = app.layer.text;
    const box = app.textBox();
    if (!t || !box) return;
    const corners = this.textCorners(box);
    const rotH = this.toScreen(this.textRotHandle(box));
    let id = 'move';
    if (Math.hypot(rotH.x - l.x, rotH.y - l.y) < HANDLE + 6) id = 'rot';
    else if (corners.some(c => {
      const s = this.toScreen(c);
      return Math.hypot(s.x - l.x, s.y - l.y) < HANDLE + 6;
    })) id = 'scale';
    this.textDrag = { id, from: d, x: t.x, y: t.y, scale: t.scale, rotation: t.rotation };
    this.mode = 'text';
  }

  private inQuad(p: V, q: V[]): boolean {
    let inside = false;
    for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
      if (q[i].y > p.y !== q[j].y > p.y && p.x < ((q[j].x - q[i].x) * (p.y - q[i].y)) / (q[j].y - q[i].y) + q[i].x) inside = !inside;
    }
    return inside;
  }

  private startGesture(): void {
    const ts = [...this.pointers.values()].filter(p => p.type === 'touch');
    const c = { x: ts.reduce((s, p) => s + p.x, 0) / ts.length, y: ts.reduce((s, p) => s + p.y, 0) / ts.length };
    const d0 = ts.length >= 2 ? Math.hypot(ts[0].x - ts[1].x, ts[0].y - ts[1].y) : 1;
    const a0 = ts.length >= 2 ? Math.atan2(ts[1].y - ts[0].y, ts[1].x - ts[0].x) : 0;
    const prev = this.gesture;
    clearInterval(prev?.undoTimer);
    this.gesture = { c0: c, d0, a0, m0: this.matrix(), t0: prev?.t0 ?? performance.now(), count: Math.max(prev?.count ?? 0, ts.length), maxMove: prev?.maxMove ?? 0, undoTimer: 0, undos: 0 };
    this.mode = 'gesture';
    clearTimeout(this.holdTimer);
    if (ts.length === 2 && this.app.prefs.fingerGestures) {
      const g = this.gesture;
      g.undoTimer = window.setTimeout(() => {
        if (!this.gesture || this.gesture.maxMove > 14) return;
        this.gesture.undoTimer = window.setInterval(() => {
          if (!this.gesture || this.gesture.maxMove > 14) return;
          this.app.undo();
          this.gesture.undos++;
        }, 140);
      }, 600) as unknown as number;
    }
  }

  private move(e: PointerEvent): void {
    const l = this.local(e);
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType !== 'touch') {
        this.hover = this.toDoc(l.x, l.y);
        this.hoverType = e.pointerType;
        this.request();
      }
      return;
    }
    p.moved = Math.max(p.moved, Math.hypot(l.x - p.sx, l.y - p.sy));
    const dx = l.x - p.x;
    const dy = l.y - p.y;
    p.x = l.x;
    p.y = l.y;
    if (e.pointerType !== 'touch') {
      this.hover = this.toDoc(l.x, l.y);
      this.hoverType = e.pointerType;
    }
    const app = this.app;
    switch (this.mode) {
      case 'gesture':
        this.gestureMove();
        break;
      case 'pan':
        this.tx += dx;
        this.ty += dy;
        this.request();
        this.app.emit('view');
        break;
      case 'rotate': {
        const c = this.screenCenter();
        const m = new DOMMatrix().translate(c.x, c.y).rotate(dx * 0.4).translate(-c.x, -c.y).multiply(this.matrix());
        this.setMatrix(m);
        this.request();
        break;
      }
      case 'draw': {
        const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
        const pts = (events.length ? events : [e]).map(ev => this.pt(ev));
        if (this.heldShape) {
          const last = pts[pts.length - 1];
          app.adjustHeldShape(this.heldShape.from, last, e.shiftKey || this.pointers.size > 1, this.heldShape.base);
          break;
        }
        app.moveStroke(pts);
        const last = pts[pts.length - 1];
        this.lastPt = last;
        if (Math.hypot(last.x - this.lastMove.x, last.y - this.lastMove.y) * this.scale > 3) {
          this.lastMove = { x: last.x, y: last.y, t: performance.now() };
          this.shapeArmed = true;
        }
        this.request();
        break;
      }
      case 'eyedrop':
        this.eyedropAt(e);
        break;
      case 'select': {
        const d = this.toDoc(l.x, l.y);
        if (app.selectTool === 'auto' && this.autoSel) {
          this.autoSel.threshold = Math.min(1, Math.max(0, 0.12 + (l.x - this.autoSel.sx) / 400));
          this.autoSel.pending = true;
        } else if (p.moved > 4) {
          this.selPath.push(d);
          this.request();
        }
        break;
      }
      case 'xf': {
        const xf = app.xf;
        const drag = this.xfDrag;
        if (!xf || !drag) break;
        const d = this.toDoc(l.x, l.y);
        xf.drag(drag.id, drag.start, drag.warp, drag.from, d, app.xfSnap || e.shiftKey, e.shiftKey && xf.mode === 'freeform');
        app.updateTransform();
        break;
      }
      case 'text': {
        const td = this.textDrag;
        const t = app.layer.text;
        if (!td || !t) break;
        const d = this.toDoc(l.x, l.y);
        if (td.id === 'move') app.updateText({ x: td.x + d.x - td.from.x, y: td.y + d.y - td.from.y }, false);
        else if (td.id === 'scale') {
          const k = Math.hypot(d.x - td.x, d.y - td.y) / Math.max(1, Math.hypot(td.from.x - td.x, td.from.y - td.y));
          app.updateText({ scale: Math.max(0.05, td.scale * k) }, false);
        } else {
          let a = td.rotation + ((Math.atan2(d.y - td.y, d.x - td.x) - Math.atan2(td.from.y - td.y, td.from.x - td.x)) * 180) / Math.PI;
          if (app.xfSnap || e.shiftKey) a = Math.round(a / 15) * 15;
          app.updateText({ rotation: a }, false);
        }
        this.request();
        break;
      }
      case 'liquify': {
        const a = app.adjust;
        const lq = a?.liquify;
        if (!a || !lq || !this.liqLast) break;
        const d = this.toDoc(l.x, l.y);
        const v = a.values;
        const pressure = e.pointerType === 'pen' ? Math.max(0.1, e.pressure) : 1;
        lq.apply(Math.round(v.mode), d.x, d.y, d.x - this.liqLast.x, d.y - this.liqLast.y, v.size, v.pressure * pressure, v.distortion, v.momentum);
        this.liqLast = d;
        this.liqDirty = true;
        break;
      }
      case 'shape': {
        const sd = this.shapeDrag;
        if (!sd || !app.shapeEdit) break;
        const shape = moveHandle(sd.base, sd.index, this.toDoc(l.x, l.y));
        app.shapeEdit.shape = shape;
        app.previewShape(shape);
        break;
      }
      case 'guide': {
        const gd = app.doc.guides;
        const d = this.toDoc(l.x, l.y);
        if (gd.type === 'perspective' && this.guideDrag !== null) gd.points[this.guideDrag] = d;
        else if (gd.type === 'symmetry') {
          gd.cx = d.x;
          gd.cy = d.y;
        }
        this.request();
        break;
      }
    }
  }

  private tryShape(at: Pt): void {
    if (this.mode !== 'draw' || this.heldShape) return;
    if (this.app.quickShape() && this.app.shapeEdit) {
      this.heldShape = { base: this.app.shapeEdit.shape, from: at };
      toast('Shape snapped. Keep holding and move to adjust; add a finger or Shift for a perfect shape.');
    }
  }

  private gestureMove(): void {
    const g = this.gesture;
    if (!g) return;
    const ts = [...this.pointers.values()].filter(p => p.type === 'touch');
    for (const p of ts) g.maxMove = Math.max(g.maxMove, p.moved);
    if (ts.length < 2) return;
    const c = { x: (ts[0].x + ts[1].x) / 2, y: (ts[0].y + ts[1].y) / 2 };
    const dist = Math.hypot(ts[0].x - ts[1].x, ts[0].y - ts[1].y);
    const ang = Math.atan2(ts[1].y - ts[0].y, ts[1].x - ts[0].x);
    let da = ang - g.a0;
    const m = new DOMMatrix()
      .translate(c.x, c.y)
      .rotate((da * 180) / Math.PI)
      .scale(dist / g.d0)
      .translate(-g.c0.x, -g.c0.y)
      .multiply(g.m0);
    this.setMatrix(m);
    const snapped = Math.round(this.rot / (Math.PI / 2)) * (Math.PI / 2);
    if (Math.abs(this.rot - snapped) < 0.06) {
      da = snapped - this.rot;
      const cc = this.screenCenter();
      this.setMatrix(new DOMMatrix().translate(cc.x, cc.y).rotate((da * 180) / Math.PI).translate(-cc.x, -cc.y).multiply(this.matrix()));
    }
    this.request();
    this.app.emit('view');
  }

  private endEyedrop(commit: boolean): void {
    this.loupe = null;
    this.mode = 'idle';
    if (commit) this.app.pushRecent();
    this.app.emit('color');
    this.request();
  }

  private up(e: PointerEvent, cancelled = false): void {
    const app = this.app;
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    clearTimeout(this.holdTimer);
    this.shapeArmed = false;
    if (!p) return;
    if (this.mode === 'gesture') {
      const g = this.gesture;
      const remaining = [...this.pointers.values()].filter(q => q.type === 'touch').length;
      if (remaining === 0 && g) {
        clearTimeout(g.undoTimer);
        clearInterval(g.undoTimer);
        const quick = performance.now() - g.t0 < 320 && g.maxMove < 14;
        if (quick && app.prefs.fingerGestures && g.undos === 0) {
          if (g.count === 2) app.undo();
          else if (g.count === 3) app.redo();
          else if (g.count >= 4) this.onUiToggle();
        }
        const fit = Math.min((this.root.clientWidth - 40) / app.doc.width, (this.root.clientHeight - 40) / app.doc.height);
        if (this.scale < fit * 0.85 && performance.now() - g.t0 < 450) this.fit();
        this.gesture = null;
        this.mode = 'idle';
      } else if (remaining >= 2) this.startGesture();
      return;
    }
    const l = this.local(e);
    switch (this.mode) {
      case 'draw':
        if (cancelled) app.cancelStroke();
        else app.endStroke();
        this.heldShape = null;
        break;
      case 'eyedrop':
        this.endEyedrop(true);
        break;
      case 'select':
        this.finishSelect(l, p);
        break;
      case 'xf':
        this.xfDrag = null;
        break;
      case 'text':
        if (this.textDrag) {
          const t = app.layer.text;
          const td = this.textDrag;
          if (t) {
            const now = { x: t.x, y: t.y, scale: t.scale, rotation: t.rotation };
            app.updateText({ x: td.x, y: td.y, scale: td.scale, rotation: td.rotation }, false);
            app.updateText(now, true);
          }
        }
        this.textDrag = null;
        break;
      case 'liquify':
        this.liqLast = null;
        break;
      case 'shape':
        if (this.shapeDrag && app.shapeEdit) app.editShape(app.shapeEdit.shape);
        this.shapeDrag = null;
        break;
      case 'guide':
        this.guideDrag = null;
        app.emit('guides');
        app.scheduleSave();
        break;
    }
    if (this.pointers.size === 0) this.mode = 'idle';
    this.request();
  }

  private finishSelect(l: V, p: PointerInfo): void {
    const app = this.app;
    const d = this.toDoc(l.x, l.y);
    const sel = app.selection;
    if (app.selectTool === 'auto' && this.autoSel) {
      if (this.autoSel.pending || !this.autoSel.mask) this.runAutoSel();
      if (this.autoSel.mask) sel.fromMask(this.autoSel.mask, app.selectMode);
      this.autoSel = null;
      app.selectionChanged();
      app.emit('autoselect');
      return;
    }
    const a = this.selStart;
    if (!a) return;
    if (app.selectTool === 'rect' || app.selectTool === 'ellipse') {
      const r = { x: Math.min(a.x, d.x), y: Math.min(a.y, d.y), w: Math.abs(d.x - a.x), h: Math.abs(d.y - a.y) };
      if (r.w > 2 && r.h > 2) {
        if (app.selectTool === 'rect') sel.rect(r, app.selectMode);
        else sel.ellipse(r, app.selectMode);
        app.selectionChanged();
      }
    } else if (p.moved > 6 && this.selPath.length > 3) {
      sel.path([a, ...this.selPath], app.selectMode);
      app.selectionChanged();
    } else {
      this.polyPts.push(d);
      toast(this.polyPts.length === 1 ? 'Tap more points; tap the first point to close the shape' : `${this.polyPts.length} points`);
    }
    this.selPath = [];
    this.selStart = null;
  }

  closePolygon(): void {
    if (this.polyPts.length > 2) {
      this.app.selection.path(this.polyPts, this.app.selectMode);
      this.app.selectionChanged();
    }
    this.polyPts = [];
    this.request();
  }

  clearPolygon(): void {
    this.polyPts = [];
    this.request();
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const l = this.local(e);
    if (e.ctrlKey || e.metaKey) {
      const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
      const m = new DOMMatrix().translate(l.x, l.y).scale(k).translate(-l.x, -l.y).multiply(this.matrix());
      this.setMatrix(m);
    } else if (e.altKey) {
      const m = new DOMMatrix().translate(l.x, l.y).rotate(e.deltaY * 0.15).translate(-l.x, -l.y).multiply(this.matrix());
      this.setMatrix(m);
    } else {
      this.tx -= e.shiftKey ? e.deltaY : e.deltaX;
      this.ty -= e.shiftKey ? 0 : e.deltaY;
    }
    this.request();
    this.app.emit('view');
  }

  zoomBy(k: number): void {
    const c = this.screenCenter();
    this.setMatrix(new DOMMatrix().translate(c.x, c.y).scale(k).translate(-c.x, -c.y).multiply(this.matrix()));
    this.request();
    this.app.emit('view');
  }

  liquifyLabel(): string {
    const a = this.app.adjust;
    return a ? LIQUIFY_MODES[Math.round(a.values.mode ?? 0)] : '';
  }
}
