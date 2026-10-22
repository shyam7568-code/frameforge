import { ADJUSTMENTS, Liquify, adjustParams, canvasCopy, defaultCurves, runAdjust, type AdjustKind, type CurveState, type Param } from './adjust';
import { ERASER_DEFAULT, LIBRARY, SMUDGE_DEFAULT, loadCustomBrushes, type Brush } from './brushes';
import { clampRect, composeDoc, flatten, unionRect, type ComposeOptions, type Rect } from './compose';
import { allLayers, cloneTree, ctx2d, findLayer, makeCanvas, newDoc, newLayer, renderText, textBounds, walk, type Doc, type Layer, type TextProps } from './doc';
import { Stroke, symmetryXf, type Pt, type StrokeMode } from './engine';
import { History } from './history';
import { detect, perfect, shapePath, transformShape, type Shape } from './shapes';
import { Selection, floodMask, selectionOverlay, type SelectMode } from './selection';
import { put, saveDoc } from './store';
import { TransformSession, type XfMode } from './transform';
import { toast } from '../util';

export type Tool = 'brush' | 'smudge' | 'erase' | 'select' | 'transform' | 'adjust';
export type SelectTool = 'auto' | 'freehand' | 'rect' | 'ellipse';

export interface Prefs {
  light: boolean;
  rightHanded: boolean;
  cursor: boolean;
  touchPaint: boolean;
  holdDelay: number;
  smoothing: number;
  pressureGamma: number;
  simulatePressure: boolean;
  dynamicSize: boolean;
  fingerGestures: boolean;
}

const PREF_KEY = 'frameforge-paint:prefs';

export const defaultPrefs = (): Prefs => ({
  light: false,
  rightHanded: false,
  cursor: true,
  touchPaint: true,
  holdDelay: 450,
  smoothing: 0,
  pressureGamma: 1,
  simulatePressure: true,
  dynamicSize: false,
  fingerGestures: true,
});

export interface AdjustSession {
  kind: AdjustKind;
  layer: Layer;
  before: HTMLCanvasElement;
  params: Param[];
  values: Record<string, number>;
  curves: CurveState;
  mode: 'layer' | 'pencil';
  result: HTMLCanvasElement | null;
  liquify: Liquify | null;
  cloneSource: { x: number; y: number } | null;
  cloneOffset: { dx: number; dy: number } | null;
}

export interface ShapeEdit {
  shape: Shape;
  stroke: Stroke;
  pressure: number;
}

type Listener = (what: string) => void;

export class App {
  doc: Doc = newDoc('Untitled', 2048, 1536);
  readonly history = new History(() => this.doc);
  readonly composite = makeCanvas(2048, 1536);
  readonly selection = new Selection(2048, 1536);
  readonly selOverlay = makeCanvas(2048, 1536);
  private readonly strokeBuffer = makeCanvas(2048, 1536);
  private readonly strokeBefore = makeCanvas(2048, 1536);
  private listeners = new Set<Listener>();
  tool: Tool = 'brush';
  selectTool: SelectTool = 'freehand';
  selectMode: SelectMode = 'replace';
  color: [number, number, number] = [0.07, 0.07, 0.09];
  secondary: [number, number, number] = [1, 1, 1];
  recent: string[] = [];
  brushes: Brush[] = [...LIBRARY, ...loadCustomBrushes()];
  toolBrush: Record<'brush' | 'smudge' | 'erase', string> = { brush: 'sketch-hb-graphite', smudge: SMUDGE_DEFAULT, erase: ERASER_DEFAULT };
  sizes: Record<string, number> = {};
  opacities: Record<string, number> = {};
  prefs: Prefs = defaultPrefs();
  stroke: Stroke | null = null;
  shapeEdit: ShapeEdit | null = null;
  xf: TransformSession | null = null;
  xfMode: XfMode = 'freeform';
  xfSnap = false;
  adjust: AdjustSession | null = null;
  dirtyLayers = new Set<string>();
  pendingRect: Rect | null = null;
  playing = false;
  zoom = 1;
  private saveTimer = 0;
  private lapseTimer = 0;
  private lapseIndex = 0;
  private startTime = Date.now();
  open = false;
  guideEditing = false;
  mode3d = false;
  uiHidden = false;

  constructor() {
    try {
      const raw = localStorage.getItem(PREF_KEY);
      if (raw) this.prefs = { ...defaultPrefs(), ...(JSON.parse(raw) as Partial<Prefs>) };
    } catch {
      /* defaults */
    }
    this.history.onChange = () => this.emit('history');
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(what: string): void {
    this.listeners.forEach(fn => fn(what));
  }

  savePrefs(): void {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(this.prefs));
    } catch {
      /* ignore */
    }
    this.emit('prefs');
  }

  get layer(): Layer {
    return findLayer(this.doc.layers, this.doc.activeId)?.layer ?? this.doc.layers[this.doc.layers.length - 1];
  }

  brush(tool: 'brush' | 'smudge' | 'erase' = this.tool === 'smudge' || this.tool === 'erase' ? this.tool : 'brush'): Brush {
    const id = this.toolBrush[tool];
    const b = this.brushes.find(x => x.id === id) ?? this.brushes[0];
    const size = this.sizes[`${tool}:${b.id}`];
    const opacity = this.opacities[`${tool}:${b.id}`];
    return { ...b, size: size ?? b.size, opacity: opacity ?? b.opacity };
  }

  setSize(v: number): void {
    const t = this.tool === 'smudge' || this.tool === 'erase' ? this.tool : 'brush';
    this.sizes[`${t}:${this.toolBrush[t]}`] = v;
    this.emit('brush');
  }

  setOpacity(v: number): void {
    const t = this.tool === 'smudge' || this.tool === 'erase' ? this.tool : 'brush';
    this.opacities[`${t}:${this.toolBrush[t]}`] = v;
    this.emit('brush');
  }

  load(doc: Doc): void {
    this.endSessions(true);
    this.doc = doc;
    for (const c of [this.composite, this.strokeBuffer, this.strokeBefore, this.selOverlay]) {
      c.width = doc.width;
      c.height = doc.height;
    }
    this.selection.resize(doc.width, doc.height);
    this.history.clear();
    this.dirtyLayers.clear();
    this.lapseIndex = 0;
    this.startTime = Date.now();
    walk(doc.layers, l => {
      if (l.kind === 'text') renderText(l, doc.width, doc.height);
    });
    this.open = true;
    this.recompose();
    this.emit('doc');
    void import('./store').then(m => m.keys('timelapse', m.prefix(`${doc.id}:`))).then(k => (this.lapseIndex = k.length));
  }

  composeOptions(): ComposeOptions {
    const a = this.doc.anim;
    if (!a.on) return {};
    const top = this.doc.layers;
    const bgIdx = a.background ? 0 : -1;
    const fgIdx = a.foreground ? top.length - 1 : -1;
    const frames = top.map((_, i) => i).filter(i => i !== bgIdx && i !== fgIdx);
    const cur = Math.min(frames.length - 1, Math.max(0, a.current));
    return {
      frame: (_layer, i) => {
        if (i === bgIdx || i === fgIdx) return { show: true, opacity: 1, tint: null };
        const pos = frames.indexOf(i);
        if (pos === cur) return { show: true, opacity: 1, tint: null };
        if (this.playing || a.onion === 0) return { show: false, opacity: 0, tint: null };
        const d = pos - cur;
        if (Math.abs(d) > a.onion) return { show: false, opacity: 0, tint: null };
        const fade = a.onionOpacity * (1 - (Math.abs(d) - 1) / Math.max(1, a.onion));
        return { show: true, opacity: fade, tint: a.colorSecondary ? (d < 0 ? '#ff3b30' : '#32d74b') : null };
      },
    };
  }

  frames(): Layer[] {
    const a = this.doc.anim;
    const top = this.doc.layers;
    return top.filter((_, i) => !(a.background && i === 0) && !(a.foreground && i === top.length - 1));
  }

  recompose(rect?: Rect | null): Rect | null {
    const full = { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
    const r = rect ? clampRect(rect, this.doc.width, this.doc.height) : full;
    if (!r) return null;
    composeDoc(ctx2d(this.composite), this.doc, r, this.composeOptions(), 0, 0, true);
    this.pendingRect = unionRect(this.pendingRect, r);
    return r;
  }

  changed(layer: Layer | null, rect?: Rect | null): void {
    if (layer) this.dirtyLayers.add(layer.id);
    this.recompose(rect ?? null);
    this.emit('render');
    this.scheduleSave();
  }

  structure(label: string, fn: () => void): void {
    const before = this.history.snapshot();
    fn();
    this.history.tree(before, label);
    this.dirtyLayers.add('*');
    this.recompose();
    this.emit('layers');
    this.emit('render');
    this.scheduleSave();
  }

  scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.save(), 1200);
  }

  async save(): Promise<void> {
    if (!this.open) return;
    clearTimeout(this.saveTimer);
    const d = this.doc;
    d.seconds += Math.round((Date.now() - this.startTime) / 1000);
    this.startTime = Date.now();
    const dirty: Set<string> | 'all' = this.dirtyLayers.has('*') ? 'all' : new Set(this.dirtyLayers);
    this.dirtyLayers.clear();
    try {
      await saveDoc(d, dirty, this.thumbnail(360));
    } catch (e) {
      toast(`Could not save: ${(e as Error).message}`);
    }
  }

  thumbnail(max: number): HTMLCanvasElement {
    const s = Math.min(1, max / Math.max(this.doc.width, this.doc.height));
    const c = makeCanvas(this.doc.width * s, this.doc.height * s);
    const g = ctx2d(c);
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.composite, 0, 0, c.width, c.height);
    return c;
  }

  captureLapse(): void {
    clearTimeout(this.lapseTimer);
    this.lapseTimer = window.setTimeout(() => {
      const c = this.thumbnail(1080);
      const id = this.doc.id;
      const index = this.lapseIndex++;
      c.toBlob(b => b && void put('timelapse', `${id}:${String(index).padStart(7, '0')}`, b), 'image/jpeg', 0.82);
    }, 250);
  }

  committed(layer: Layer, rect: Rect | null, before: ImageData | null, label: string, target?: HTMLCanvasElement): void {
    if (rect && before) this.history.pixels(target ?? layer.canvas, rect, before, label);
    this.doc.strokes++;
    this.changed(layer, rect);
    this.emit('thumbs');
    this.captureLapse();
  }

  canPaint(silent = false): boolean {
    const l = this.layer;
    const say = (m: string): false => {
      if (!silent) toast(m);
      return false;
    };
    if (l.kind === 'group') return say('Select a layer inside the group to paint.');
    if (l.locked) return say('This layer is locked.');
    if (!l.visible) return say('This layer is hidden.');
    if (l.kind === 'text') {
      this.rasterize(l);
      toast('Text layer rasterized so it can be painted.');
    }
    return true;
  }

  pressureCurve(): (p: number) => number {
    const g = this.prefs.pressureGamma;
    return p => Math.pow(p, g);
  }

  private assistFor(layer: Layer): ((start: Pt, pt: Pt) => Pt) | null {
    const gd = this.doc.guides;
    if (!layer.assist || gd.type === 'none' || gd.type === 'symmetry') return null;
    const dirs: number[] = [];
    let vps: { x: number; y: number }[] = [];
    if (gd.type === 'grid') dirs.push(0, Math.PI / 2);
    if (gd.type === 'isometric') dirs.push(Math.PI / 6, Math.PI / 2, (5 * Math.PI) / 6);
    if (gd.type === 'perspective') {
      vps = gd.points;
      dirs.push(Math.PI / 2);
      if (gd.points.length < 2) dirs.push(0);
    }
    let lock: { ox: number; oy: number; ux: number; uy: number } | null = null;
    return (start, pt) => {
      if (!lock) {
        const vx = pt.x - start.x;
        const vy = pt.y - start.y;
        const a = Math.atan2(vy, vx);
        let best = Infinity;
        const cands: number[] = [...dirs.map(d => d + (gd.rotation * Math.PI) / 180)];
        for (const vp of vps) cands.push(Math.atan2(vp.y - start.y, vp.x - start.x));
        let pick = cands[0];
        for (const c of cands) {
          const diff = Math.abs(Math.sin(a - c));
          if (diff < best) {
            best = diff;
            pick = c;
          }
        }
        lock = { ox: start.x, oy: start.y, ux: Math.cos(pick), uy: Math.sin(pick) };
      }
      const d = (pt.x - lock.ox) * lock.ux + (pt.y - lock.oy) * lock.uy;
      return { ...pt, x: lock.ox + lock.ux * d, y: lock.oy + lock.uy * d };
    };
  }

  beginStroke(pt: Pt, mode?: StrokeMode, pointer = 'pen'): boolean {
    this.finishShapeEdit();
    if (this.tool === 'adjust' && this.adjust) {
      if (this.adjust.kind === 'liquify') return false;
      if (this.adjust.kind === 'clone') {
        if (!this.adjust.cloneSource) {
          toast('Touch and hold, or Alt-click, to set the clone source first.');
          return false;
        }
        if (!this.adjust.cloneOffset) this.adjust.cloneOffset = { dx: this.adjust.cloneSource.x - pt.x, dy: this.adjust.cloneSource.y - pt.y };
        mode = 'source';
      } else if (this.adjust.mode === 'pencil') mode = 'source';
      else return false;
    }
    if (!this.canPaint()) return false;
    const layer = this.layer;
    const toolKey = this.tool === 'smudge' || this.tool === 'erase' ? this.tool : 'brush';
    const brush = this.brush(toolKey);
    const m: StrokeMode = mode ?? (this.tool === 'erase' ? 'erase' : this.tool === 'smudge' ? 'smudge' : 'paint');
    const maskTarget = this.doc.maskTarget && !!layer.mask;
    const gd = this.doc.guides;
    const symmetry = layer.assist && gd.type === 'symmetry' ? symmetryXf(gd.symmetry, gd.cx, gd.cy, gd.rotation, gd.radial, gd.rotational) : null;
    let source: { canvas: CanvasImageSource; dx: number; dy: number } | undefined;
    if (m === 'source' && this.adjust) {
      if (this.adjust.kind === 'clone' && this.adjust.cloneOffset) source = { canvas: this.adjust.before, dx: this.adjust.cloneOffset.dx, dy: this.adjust.cloneOffset.dy };
      else if (this.adjust.result) source = { canvas: this.adjust.result, dx: 0, dy: 0 };
    }
    this.stroke = new Stroke(
      {
        brush,
        mode: m,
        color: this.color,
        target: maskTarget && layer.mask ? layer.mask : layer.canvas,
        maskTarget,
        selection: this.selection.active ? this.selection.mask : null,
        alphaLock: layer.alphaLock && !maskTarget,
        symmetry,
        assist: this.assistFor(layer),
        source,
        smoothing: Math.max(brush.smoothing, this.prefs.smoothing),
        zoomInv: 1 / Math.max(0.05, this.zoom),
        pressureCurve: this.pressureCurve(),
        sizeScale: this.prefs.dynamicSize ? 1 / Math.max(0.05, this.zoom) : 1,
        simulatePressure: pointer !== 'pen' && this.prefs.simulatePressure,
      },
      this.strokeBuffer,
      this.strokeBefore,
    );
    this.stroke.begin(pt);
    this.pushRecent();
    return true;
  }

  moveStroke(pts: Pt[]): void {
    this.stroke?.move(pts);
  }

  flushStroke(): Rect | null {
    const s = this.stroke ?? this.shapeEdit?.stroke;
    if (!s) return null;
    const r = s.flush();
    if (r) this.recompose(r);
    return r;
  }

  endStroke(): void {
    const s = this.stroke;
    if (!s) return;
    s.finish();
    const r = s.flush();
    if (r) this.recompose(r);
    this.stroke = null;
    const rect = s.bbox;
    if (!rect) return;
    const layer = this.layer;
    this.committed(layer, rect, s.beforeData(rect), this.tool === 'erase' ? 'Erase' : 'Paint', s.opts.target);
    if (this.shapeEdit && this.shapeEdit.stroke === s) this.shapeEdit = { ...this.shapeEdit };
  }

  cancelStroke(): void {
    const s = this.stroke;
    if (!s) return;
    s.restore();
    this.stroke = null;
    this.recompose(s.bbox);
    this.emit('render');
  }

  quickShape(): boolean {
    const s = this.stroke;
    if (!s) return false;
    const pts = s.rawPoints;
    const shape = detect(pts);
    if (!shape) return false;
    const pressure = pts.reduce((a, p) => a + p.p, 0) / pts.length;
    s.setShape(shapePath(shape), pressure);
    this.shapeEdit = { shape, stroke: s, pressure };
    this.recompose(s.flush());
    this.emit('render');
    this.emit('shape');
    return true;
  }

  adjustHeldShape(from: { x: number; y: number }, to: { x: number; y: number }, perfectShape: boolean, base: Shape): void {
    const se = this.shapeEdit;
    if (!se) return;
    let shape = transformShape(base, from, to);
    if (perfectShape) shape = perfect(shape);
    se.shape = shape;
    se.stroke.setShape(shapePath(shape), se.pressure);
    this.recompose(se.stroke.flush());
    this.emit('render');
  }

  previewShape(shape: Shape): void {
    const se = this.shapeEdit;
    if (!se || this.stroke) return;
    se.stroke.setShape(shapePath(shape), se.pressure);
    this.recompose(se.stroke.bbox);
    this.emit('render');
  }

  editShape(shape: Shape): void {
    const se = this.shapeEdit;
    if (!se || this.stroke) return;
    this.history.dropLast();
    se.shape = shape;
    se.stroke.setShape(shapePath(shape), se.pressure);
    const r = se.stroke.flush();
    this.recompose(se.stroke.bbox ?? r);
    const rect = se.stroke.bbox;
    if (rect) this.history.pixels(se.stroke.opts.target, rect, se.stroke.beforeData(rect), 'Edit shape');
    this.changed(this.layer, rect);
  }

  finishShapeEdit(): void {
    if (this.shapeEdit && !this.stroke) {
      this.shapeEdit = null;
      this.emit('shape');
    }
  }

  sample(x: number, y: number, fromLayer = false): [number, number, number] | null {
    const src = fromLayer ? this.layer.canvas : this.composite;
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= src.width || iy >= src.height) return null;
    const d = ctx2d(src).getImageData(Math.max(0, ix - 1), Math.max(0, iy - 1), 3, 3).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let i = 0; i < d.length; i += 4) {
      const w = d[i + 3] / 255;
      r += d[i] * w;
      g += d[i + 1] * w;
      b += d[i + 2] * w;
      a += w;
    }
    if (a < 0.01) return null;
    return [r / a / 255, g / a / 255, b / a / 255];
  }

  setColor(rgb: [number, number, number], record = false): void {
    this.color = rgb;
    if (record) this.pushRecent();
    this.emit('color');
  }

  pushRecent(): void {
    const hex = `#${this.color.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
    this.recent = [hex, ...this.recent.filter(h => h !== hex)].slice(0, 12);
  }

  colorDrop(x: number, y: number, threshold: number, undoPrevious: boolean): void {
    if (!this.canPaint()) return;
    if (undoPrevious) this.history.undo();
    const layer = this.layer;
    const refLayer = allLayers(this.doc.layers).find(l => l.reference && l.kind !== 'group');
    const data = ctx2d((refLayer ?? layer).canvas).getImageData(0, 0, this.doc.width, this.doc.height);
    const mask = floodMask(data, x, y, threshold);
    const full = { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
    const before = ctx2d(layer.canvas).getImageData(0, 0, full.w, full.h);
    const t = makeCanvas(full.w, full.h);
    const tg = ctx2d(t);
    tg.fillStyle = `rgb(${this.color.map(v => Math.round(v * 255)).join(',')})`;
    tg.fillRect(0, 0, full.w, full.h);
    tg.globalCompositeOperation = 'destination-in';
    tg.drawImage(mask, 0, 0);
    if (this.selection.active) tg.drawImage(this.selection.mask, 0, 0);
    const g = ctx2d(layer.canvas);
    g.save();
    g.globalCompositeOperation = layer.alphaLock ? 'source-atop' : 'source-over';
    g.drawImage(t, 0, 0);
    g.restore();
    this.committed(layer, full, before, 'Color fill');
  }

  fillLayer(): void {
    if (!this.canPaint()) return;
    const layer = this.layer;
    const full = { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
    const before = ctx2d(layer.canvas).getImageData(0, 0, full.w, full.h);
    const g = ctx2d(layer.canvas);
    g.save();
    g.fillStyle = `rgb(${this.color.map(v => Math.round(v * 255)).join(',')})`;
    if (this.selection.active) {
      const t = makeCanvas(full.w, full.h);
      const tg = ctx2d(t);
      tg.fillStyle = g.fillStyle;
      tg.fillRect(0, 0, full.w, full.h);
      tg.globalCompositeOperation = 'destination-in';
      tg.drawImage(this.selection.mask, 0, 0);
      g.globalCompositeOperation = layer.alphaLock ? 'source-atop' : 'source-over';
      g.drawImage(t, 0, 0);
    } else {
      g.globalCompositeOperation = layer.alphaLock ? 'source-atop' : 'source-over';
      g.fillRect(0, 0, full.w, full.h);
    }
    g.restore();
    this.committed(layer, full, before, 'Fill layer');
  }

  clearLayer(): void {
    const layer = this.layer;
    if (layer.kind === 'group' || layer.locked) return;
    const full = { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
    const before = ctx2d(layer.canvas).getImageData(0, 0, full.w, full.h);
    const g = ctx2d(layer.canvas);
    if (this.selection.active) {
      g.save();
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(this.selection.mask, 0, 0);
      g.restore();
    } else g.clearRect(0, 0, full.w, full.h);
    this.committed(layer, full, before, 'Clear');
  }

  invertLayer(): void {
    this.startAdjust('invert');
    this.applyAdjust();
  }

  addLayer(kind: Layer['kind'] = 'paint', above = this.doc.activeId): Layer {
    const layer = newLayer(this.doc, kind === 'group' ? 'Group' : `Layer ${allLayers(this.doc.layers).length + 1}`, kind);
    this.structure('Add layer', () => {
      const at = findLayer(this.doc.layers, above);
      if (at) at.list.splice(at.index + 1, 0, layer);
      else this.doc.layers.push(layer);
      this.doc.activeId = layer.id;
      this.doc.maskTarget = false;
    });
    return layer;
  }

  insertLayer(layer: Layer): void {
    this.structure('Insert', () => {
      const at = findLayer(this.doc.layers, this.doc.activeId);
      if (at) at.list.splice(at.index + 1, 0, layer);
      else this.doc.layers.push(layer);
      this.doc.activeId = layer.id;
    });
  }

  deleteLayer(id = this.doc.activeId): void {
    if (allLayers(this.doc.layers).filter(l => l.kind !== 'group').length <= 1 && findLayer(this.doc.layers, id)?.layer.kind !== 'group') {
      toast('A canvas needs at least one layer.');
      return;
    }
    this.structure('Delete layer', () => {
      const at = findLayer(this.doc.layers, id);
      if (!at) return;
      at.list.splice(at.index, 1);
      const next = at.list[Math.min(at.index, at.list.length - 1)] ?? this.doc.layers[this.doc.layers.length - 1];
      this.doc.activeId = next?.id ?? '';
      if (!findLayer(this.doc.layers, this.doc.activeId)) this.doc.activeId = allLayers(this.doc.layers).find(l => l.kind !== 'group')?.id ?? '';
    });
  }

  duplicateLayer(id = this.doc.activeId): void {
    const at = findLayer(this.doc.layers, id);
    if (!at) return;
    const copy = (l: Layer): Layer => ({
      ...l,
      id: newLayer(this.doc, '').id,
      name: l === at.layer ? `${l.name} copy` : l.name,
      canvas: canvasCopy(l.canvas),
      mask: l.mask ? canvasCopy(l.mask) : null,
      text: l.text && { ...l.text },
      children: l.children?.map(copy),
    });
    const dup = copy(at.layer);
    this.structure('Duplicate', () => {
      at.list.splice(at.index + 1, 0, dup);
      this.doc.activeId = dup.id;
    });
  }

  moveLayer(id: string, dir: 1 | -1): void {
    const at = findLayer(this.doc.layers, id);
    if (!at) return;
    const j = at.index + dir;
    if (j < 0 || j >= at.list.length) return;
    this.structure('Move layer', () => {
      const [l] = at.list.splice(at.index, 1);
      at.list.splice(j, 0, l);
    });
  }

  reorder(id: string, targetId: string, after: boolean): void {
    if (id === targetId) return;
    const from = findLayer(this.doc.layers, id);
    const to = findLayer(this.doc.layers, targetId);
    if (!from || !to) return;
    if (from.layer.children && findLayer(from.layer.children, targetId)) return;
    this.structure('Move layer', () => {
      from.list.splice(from.index, 1);
      const t = findLayer(this.doc.layers, targetId);
      if (!t) return;
      if (t.layer.kind === 'group' && !after && !t.layer.collapsed) t.layer.children!.push(from.layer);
      else t.list.splice(t.index + (after ? 1 : 0), 0, from.layer);
    });
  }

  mergeDown(id = this.doc.activeId): void {
    const at = findLayer(this.doc.layers, id);
    if (!at || at.index === 0) return;
    const upper = at.layer;
    const lower = at.list[at.index - 1];
    if (lower.kind === 'group' || lower.locked) {
      toast('The layer below cannot be merged into.');
      return;
    }
    const before = ctx2d(lower.canvas).getImageData(0, 0, this.doc.width, this.doc.height);
    if (lower.kind === 'text') this.rasterize(lower, false);
    const snap = this.history.snapshot();
    const merged = makeCanvas(this.doc.width, this.doc.height);
    composeDoc(ctx2d(merged), { ...this.doc, bgVisible: false, anim: { ...this.doc.anim, on: false }, layers: [{ ...lower, blend: 'normal', opacity: 1 }, { ...upper, clip: false }] }, { x: 0, y: 0, w: this.doc.width, h: this.doc.height }, {}, 0, 0, false);
    const g = ctx2d(lower.canvas);
    g.save();
    g.globalCompositeOperation = 'copy';
    g.drawImage(merged, 0, 0);
    g.restore();
    at.list.splice(at.index, 1);
    this.doc.activeId = lower.id;
    const step = this.history.pixelStep(lower.canvas, { x: 0, y: 0, w: this.doc.width, h: this.doc.height }, before);
    this.history.tree(snap, 'Merge down', [step]);
    this.dirtyLayers.add('*');
    this.recompose();
    this.emit('layers');
    this.emit('render');
    this.scheduleSave();
  }

  group(id = this.doc.activeId): void {
    const at = findLayer(this.doc.layers, id);
    if (!at) return;
    this.structure('Group', () => {
      const g = newLayer(this.doc, 'New group', 'group');
      const take = at.index > 0 ? 2 : 1;
      const members = at.list.splice(at.index - take + 1, take);
      g.children = members;
      at.list.splice(at.index - take + 1, 0, g);
      this.doc.activeId = id;
    });
  }

  ungroup(id = this.doc.activeId): void {
    const at = findLayer(this.doc.layers, id);
    if (!at || at.layer.kind !== 'group') return;
    this.structure('Ungroup', () => {
      at.list.splice(at.index, 1, ...(at.layer.children ?? []));
      this.doc.activeId = at.layer.children?.[at.layer.children.length - 1]?.id ?? this.doc.layers[0].id;
    });
  }

  setLayerProp<K extends keyof Layer>(id: string, key: K, value: Layer[K], label = 'Layer setting'): void {
    const at = findLayer(this.doc.layers, id);
    if (!at) return;
    this.structure(label, () => {
      const l = findLayer(this.doc.layers, id)?.layer;
      if (l) l[key] = value;
    });
  }

  addMask(id = this.doc.activeId): void {
    const at = findLayer(this.doc.layers, id);
    if (!at || at.layer.mask) return;
    const m = makeCanvas(this.doc.width, this.doc.height);
    const g = ctx2d(m);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, m.width, m.height);
    this.structure('Add mask', () => {
      const l = findLayer(this.doc.layers, id)?.layer;
      if (l) {
        l.mask = m;
        l.maskOn = true;
      }
      this.doc.maskTarget = true;
    });
  }

  removeMask(apply: boolean, id = this.doc.activeId): void {
    const at = findLayer(this.doc.layers, id);
    if (!at?.layer.mask) return;
    const l = at.layer;
    const snap = this.history.snapshot();
    let step;
    if (apply && l.kind !== 'group') {
      const before = ctx2d(l.canvas).getImageData(0, 0, this.doc.width, this.doc.height);
      const g = ctx2d(l.canvas);
      g.save();
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(l.mask as HTMLCanvasElement, 0, 0);
      g.restore();
      step = this.history.pixelStep(l.canvas, { x: 0, y: 0, w: this.doc.width, h: this.doc.height }, before);
    }
    l.mask = null;
    this.doc.maskTarget = false;
    this.history.tree(snap, apply ? 'Apply mask' : 'Delete mask', step ? [step] : undefined);
    this.dirtyLayers.add('*');
    this.recompose();
    this.emit('layers');
    this.emit('render');
  }

  rasterize(layer: Layer, record = true): void {
    if (layer.kind !== 'text') return;
    const doIt = (): void => {
      const l = findLayer(this.doc.layers, layer.id)?.layer;
      if (l) {
        l.kind = 'paint';
        l.text = undefined;
      }
    };
    if (record) this.structure('Rasterize', doIt);
    else doIt();
  }

  addText(content = 'Text'): Layer {
    const layer = newLayer(this.doc, content.slice(0, 24) || 'Text', 'text');
    const size = Math.round(Math.min(this.doc.width, this.doc.height) / 10);
    layer.text = {
      content,
      font: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      size,
      weight: 600,
      italic: false,
      underline: false,
      align: 'center',
      tracking: 0,
      leading: 1.2,
      color: `#${this.color.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`,
      outline: 0,
      outlineColor: '#ffffff',
      x: this.doc.width / 2,
      y: this.doc.height / 2 - size / 2,
      rotation: 0,
      scale: 1,
    };
    renderText(layer, this.doc.width, this.doc.height);
    this.insertLayer(layer);
    return layer;
  }

  updateText(patch: Partial<TextProps>, record: boolean): void {
    const l = this.layer;
    if (!l.text) return;
    const apply = (): void => {
      const target = findLayer(this.doc.layers, l.id)?.layer;
      if (!target?.text) return;
      Object.assign(target.text, patch);
      if (patch.content !== undefined) target.name = patch.content.split('\n')[0].slice(0, 24) || 'Text';
      renderText(target, this.doc.width, this.doc.height);
    };
    if (record) this.structure('Edit text', apply);
    else {
      apply();
      this.changed(l);
      this.emit('layers');
    }
  }

  textBox(): { x: number; y: number; w: number; h: number } | null {
    return textBounds(this.layer);
  }

  selectLayerAlpha(id = this.doc.activeId): void {
    const at = findLayer(this.doc.layers, id);
    if (!at) return;
    this.selection.fromAlpha(at.layer.canvas, 'replace');
    this.selectionChanged();
  }

  selectionChanged(): void {
    selectionOverlay(this.selection, this.selOverlay);
    this.emit('selection');
    this.emit('render');
  }

  copy(cut: boolean): HTMLCanvasElement | null {
    const l = this.layer;
    if (l.kind === 'group') return null;
    const c = canvasCopy(l.canvas);
    if (this.selection.active) {
      const g = ctx2d(c);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(this.selection.mask, 0, 0);
    }
    if (cut) this.clearLayer();
    return c;
  }

  paste(c: HTMLCanvasElement): void {
    const layer = newLayer(this.doc, 'Pasted');
    ctx2d(layer.canvas).drawImage(c, (this.doc.width - c.width) / 2, (this.doc.height - c.height) / 2);
    this.insertLayer(layer);
  }

  startTransform(): boolean {
    const l = this.layer;
    if (l.kind === 'group' || l.locked) {
      toast(l.locked ? 'This layer is locked.' : 'Select a layer inside the group to transform it.');
      return false;
    }
    if (l.kind === 'text') {
      this.xf = null;
      return true;
    }
    let area = this.selection.active ? this.selection.bounds() : contentBounds(l.canvas);
    if (!area) area = { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
    this.xf = new TransformSession(l.canvas, area, this.selection.active ? this.selection.mask : null);
    this.xf.mode = this.xfMode;
    this.xf.render();
    this.recompose();
    this.emit('render');
    return true;
  }

  updateTransform(): void {
    if (!this.xf) return;
    this.xf.render();
    this.recompose();
    this.emit('render');
  }

  commitTransform(): void {
    const xf = this.xf;
    if (!xf) return;
    this.xf = null;
    const full = { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
    const before = ctx2d(xf.before).getImageData(0, 0, full.w, full.h);
    if (this.selection.active) {
      xf.transformSelection(this.selection.mask);
      selectionOverlay(this.selection, this.selOverlay);
    }
    this.committed(this.layer, full, before, 'Transform');
  }

  cancelTransform(): void {
    const xf = this.xf;
    if (!xf) return;
    this.xf = null;
    xf.restore();
    this.recompose();
    this.emit('render');
  }

  startAdjust(kind: AdjustKind): boolean {
    this.endSessions(false);
    const l = this.layer;
    if (l.kind === 'group' || l.locked) {
      toast(l.locked ? 'This layer is locked.' : 'Select a layer to adjust.');
      return false;
    }
    if (l.kind === 'text') this.rasterize(l);
    const before = canvasCopy(l.canvas);
    const params = adjustParams(kind, this.doc.width, this.doc.height);
    this.adjust = {
      kind,
      layer: l,
      before,
      params,
      values: Object.fromEntries(params.map(p => [p.key, p.value])),
      curves: defaultCurves(),
      mode: 'layer',
      result: null,
      liquify: kind === 'liquify' ? new Liquify(before, l.canvas) : null,
      cloneSource: null,
      cloneOffset: null,
    };
    this.tool = 'adjust';
    if (kind !== 'liquify' && kind !== 'clone') this.refreshAdjust();
    this.emit('tool');
    this.emit('adjust');
    return true;
  }

  refreshAdjust(): void {
    const a = this.adjust;
    if (!a || a.kind === 'liquify' || a.kind === 'clone') return;
    const out = runAdjust(a.kind, a.before, a.values, a.curves);
    if (!a.result) a.result = makeCanvas(this.doc.width, this.doc.height);
    const rg = ctx2d(a.result);
    rg.save();
    rg.globalCompositeOperation = 'copy';
    rg.drawImage(out, 0, 0);
    rg.restore();
    const g = ctx2d(a.layer.canvas);
    g.save();
    g.globalCompositeOperation = 'copy';
    g.drawImage(a.before, 0, 0);
    g.restore();
    if (a.mode === 'layer') {
      g.save();
      if (this.selection.active) {
        const t = canvasCopy(a.result);
        const tg = ctx2d(t);
        tg.globalCompositeOperation = 'destination-in';
        tg.drawImage(this.selection.mask, 0, 0);
        g.globalCompositeOperation = 'destination-out';
        g.drawImage(this.selection.mask, 0, 0);
        g.globalCompositeOperation = 'source-over';
        g.drawImage(t, 0, 0);
      } else {
        g.globalCompositeOperation = 'copy';
        g.drawImage(a.result, 0, 0);
      }
      g.restore();
    }
    this.recompose();
    this.emit('render');
  }

  applyAdjust(): void {
    const a = this.adjust;
    if (!a) return;
    this.adjust = null;
    a.liquify?.dispose();
    const full = { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
    const before = ctx2d(a.before).getImageData(0, 0, full.w, full.h);
    this.tool = 'brush';
    this.committed(a.layer, full, before, ADJUSTMENTS.find(x => x.id === a.kind)?.label ?? 'Adjustment');
    this.emit('tool');
    this.emit('adjust');
  }

  cancelAdjust(): void {
    const a = this.adjust;
    if (!a) return;
    this.adjust = null;
    a.liquify?.dispose();
    const g = ctx2d(a.layer.canvas);
    g.save();
    g.globalCompositeOperation = 'copy';
    g.drawImage(a.before, 0, 0);
    g.restore();
    this.tool = 'brush';
    this.recompose();
    this.emit('render');
    this.emit('tool');
    this.emit('adjust');
  }

  endSessions(cancel: boolean): void {
    if (this.stroke) this.endStroke();
    if (this.xf) {
      if (cancel) this.cancelTransform();
      else this.commitTransform();
    }
    if (this.adjust) {
      if (cancel) this.cancelAdjust();
      else this.applyAdjust();
    }
    this.shapeEdit = null;
  }

  setTool(t: Tool): void {
    if (t === this.tool && t !== 'transform') return;
    if (this.tool === 'transform' && t !== 'transform') this.commitTransform();
    if (this.tool === 'adjust' && t !== 'adjust') this.applyAdjust();
    this.finishShapeEdit();
    this.tool = t;
    if (t === 'transform' && !this.startTransform()) this.tool = 'brush';
    this.emit('tool');
  }

  resizeCanvas(w: number, h: number, anchorX: number, anchorY: number, resample: boolean): void {
    w = Math.max(16, Math.min(16384, Math.round(w)));
    h = Math.max(16, Math.min(16384, Math.round(h)));
    this.endSessions(false);
    const ow = this.doc.width;
    const oh = this.doc.height;
    const ox = resample ? 0 : (w - ow) * anchorX;
    const oy = resample ? 0 : (h - oh) * anchorY;
    const remap = (c: HTMLCanvasElement): HTMLCanvasElement => {
      const n = makeCanvas(w, h);
      const g = ctx2d(n);
      g.imageSmoothingQuality = 'high';
      if (resample) g.drawImage(c, 0, 0, w, h);
      else g.drawImage(c, ox, oy);
      return n;
    };
    const walkMap = (list: Layer[]): Layer[] =>
      list.map(l => {
        const n = { ...l, canvas: l.kind === 'group' ? l.canvas : remap(l.canvas), mask: l.mask ? remap(l.mask) : null, children: l.children && walkMap(l.children) };
        if (n.text) n.text = { ...n.text, x: resample ? (n.text.x * w) / ow : n.text.x + ox, y: resample ? (n.text.y * h) / oh : n.text.y + oy, scale: resample ? (n.text.scale * w) / ow : n.text.scale };
        return n;
      });
    this.structure('Canvas size', () => {
      this.doc.layers = walkMap(this.doc.layers);
      this.doc.width = w;
      this.doc.height = h;
    });
    this.load(this.doc);
    this.dirtyLayers.add('*');
    this.scheduleSave();
  }

  flipCanvas(horizontal: boolean): void {
    this.endSessions(false);
    const flip = (c: HTMLCanvasElement): HTMLCanvasElement => {
      const n = makeCanvas(c.width, c.height);
      const g = ctx2d(n);
      g.translate(horizontal ? c.width : 0, horizontal ? 0 : c.height);
      g.scale(horizontal ? -1 : 1, horizontal ? 1 : -1);
      g.drawImage(c, 0, 0);
      return n;
    };
    const walkMap = (list: Layer[]): Layer[] =>
      list.map(l => ({
        ...l,
        kind: l.kind === 'text' ? 'paint' : l.kind,
        text: undefined,
        canvas: l.kind === 'group' ? l.canvas : flip(l.canvas),
        mask: l.mask ? flip(l.mask) : null,
        children: l.children && walkMap(l.children),
      }));
    this.structure(horizontal ? 'Flip canvas horizontally' : 'Flip canvas vertically', () => {
      this.doc.layers = walkMap(this.doc.layers);
    });
  }

  rotateCanvas(): void {
    this.endSessions(false);
    const W = this.doc.width;
    const H = this.doc.height;
    const rot = (c: HTMLCanvasElement): HTMLCanvasElement => {
      const n = makeCanvas(H, W);
      const g = ctx2d(n);
      g.translate(H, 0);
      g.rotate(Math.PI / 2);
      g.drawImage(c, 0, 0);
      return n;
    };
    const walkMap = (list: Layer[]): Layer[] =>
      list.map(l => ({ ...l, kind: l.kind === 'text' ? 'paint' : l.kind, text: undefined, canvas: l.kind === 'group' ? l.canvas : rot(l.canvas), mask: l.mask ? rot(l.mask) : null, children: l.children && walkMap(l.children) }));
    this.structure('Rotate canvas', () => {
      this.doc.layers = walkMap(this.doc.layers);
      this.doc.width = H;
      this.doc.height = W;
    });
    this.load(this.doc);
    this.dirtyLayers.add('*');
    this.scheduleSave();
  }

  setBackground(color: string | null): void {
    const snap = this.history.snapshot();
    if (color === null) this.doc.bgVisible = !this.doc.bgVisible;
    else this.doc.background = color;
    this.history.tree(snap, 'Background');
    this.recompose();
    this.emit('layers');
    this.emit('render');
    this.scheduleSave();
  }

  undo(): void {
    if (this.stroke) return;
    this.endSessions(true);
    const label = this.history.undo();
    if (label) toast(`Undo ${label}`);
    this.afterTravel();
  }

  redo(): void {
    if (this.stroke) return;
    this.endSessions(true);
    const label = this.history.redo();
    if (label) toast(`Redo ${label}`);
    this.afterTravel();
  }

  private afterTravel(): void {
    if (this.composite.width !== this.doc.width || this.composite.height !== this.doc.height) {
      for (const c of [this.composite, this.strokeBuffer, this.strokeBefore, this.selOverlay]) {
        c.width = this.doc.width;
        c.height = this.doc.height;
      }
      this.selection.resize(this.doc.width, this.doc.height);
    }
    if (!findLayer(this.doc.layers, this.doc.activeId)) this.doc.activeId = this.doc.layers[this.doc.layers.length - 1].id;
    walk(this.doc.layers, l => {
      if (l.kind === 'text') renderText(l, this.doc.width, this.doc.height);
    });
    this.dirtyLayers.add('*');
    this.recompose();
    this.emit('layers');
    this.emit('render');
    this.emit('doc-size');
    this.scheduleSave();
  }

  flattened(background = true): HTMLCanvasElement {
    return flatten(this.doc, background);
  }

  layerTree(): Layer[] {
    return cloneTree(this.doc.layers);
  }
}

export function contentBounds(c: HTMLCanvasElement): Rect | null {
  const step = Math.max(1, Math.floor(Math.max(c.width, c.height) / 600));
  const sw = Math.ceil(c.width / step);
  const sh = Math.ceil(c.height / step);
  const t = makeCanvas(sw, sh);
  const g = ctx2d(t);
  g.drawImage(c, 0, 0, sw, sh);
  const d = g.getImageData(0, 0, sw, sh).data;
  let x0 = sw;
  let y0 = sh;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++)
      if (d[(y * sw + x) * 4 + 3] > 0) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  if (x1 < 0) return null;
  const x = Math.max(0, (x0 - 1) * step);
  const y = Math.max(0, (y0 - 1) * step);
  return { x, y, w: Math.min(c.width, (x1 + 2) * step) - x, h: Math.min(c.height, (y1 + 2) * step) - y };
}
