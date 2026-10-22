import type { Rect } from './compose';
import { cloneTree, ctx2d, type Doc, type Layer } from './doc';

interface PixelStep {
  kind: 'pixels';
  canvas: HTMLCanvasElement;
  rect: Rect;
  before: ImageData;
  after: ImageData;
  label: string;
}

interface TreeStep {
  kind: 'tree';
  before: Layer[];
  after: Layer[];
  activeBefore: string;
  activeAfter: string;
  props?: { before: Partial<Doc>; after: Partial<Doc> };
  pixels?: PixelStep[];
  label: string;
}

type Step = PixelStep | TreeStep;

const BYTE_LIMIT = (navigator as Navigator & { deviceMemory?: number }).deviceMemory && ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4 ? 220e6 : 600e6;

export class History {
  private undoStack: Step[] = [];
  private redoStack: Step[] = [];
  private bytes = 0;
  onChange: () => void = () => undefined;

  constructor(private doc: () => Doc) {}

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.bytes = 0;
    this.onChange();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private size(s: Step): number {
    if (s.kind === 'pixels') return s.before.data.length * 2;
    return (s.pixels ?? []).reduce((n, p) => n + p.before.data.length * 2, 0) + 1000;
  }

  private push(step: Step): void {
    this.undoStack.push(step);
    this.bytes += this.size(step);
    this.redoStack = [];
    while ((this.bytes > BYTE_LIMIT || this.undoStack.length > 250) && this.undoStack.length > 1) {
      const old = this.undoStack.shift();
      if (old) this.bytes -= this.size(old);
    }
    this.onChange();
  }

  pixels(canvas: HTMLCanvasElement, rect: Rect, before: ImageData, label = 'Paint'): void {
    const after = ctx2d(canvas).getImageData(rect.x, rect.y, rect.w, rect.h);
    this.push({ kind: 'pixels', canvas, rect, before, after, label });
  }

  snapshot(): { tree: Layer[]; active: string; props: Partial<Doc> } {
    const d = this.doc();
    return { tree: cloneTree(d.layers), active: d.activeId, props: { width: d.width, height: d.height, background: d.background, bgVisible: d.bgVisible } };
  }

  tree(before: { tree: Layer[]; active: string; props: Partial<Doc> }, label: string, pixels?: PixelStep[]): void {
    const now = this.snapshot();
    this.push({ kind: 'tree', before: before.tree, after: now.tree, activeBefore: before.active, activeAfter: now.active, props: { before: before.props, after: now.props }, pixels, label });
  }

  pixelStep(canvas: HTMLCanvasElement, rect: Rect, before: ImageData): PixelStep {
    return { kind: 'pixels', canvas, rect, before, after: ctx2d(canvas).getImageData(rect.x, rect.y, rect.w, rect.h), label: '' };
  }

  private apply(step: Step, undo: boolean): void {
    const d = this.doc();
    if (step.kind === 'pixels') {
      ctx2d(step.canvas).putImageData(undo ? step.before : step.after, step.rect.x, step.rect.y);
      return;
    }
    if (step.props) Object.assign(d, undo ? step.props.before : step.props.after);
    const pix = step.pixels ?? [];
    if (undo) [...pix].reverse().forEach(p => this.restoreCanvas(p, true));
    d.layers = cloneTree(undo ? step.before : step.after);
    d.activeId = undo ? step.activeBefore : step.activeAfter;
    if (!undo) pix.forEach(p => this.restoreCanvas(p, false));
  }

  private restoreCanvas(p: PixelStep, undo: boolean): void {
    const img = undo ? p.before : p.after;
    if (p.canvas.width !== img.width || p.canvas.height !== img.height) {
      if (p.rect.x === 0 && p.rect.y === 0) {
        p.canvas.width = img.width;
        p.canvas.height = img.height;
      }
    }
    ctx2d(p.canvas).putImageData(img, p.rect.x, p.rect.y);
  }

  undo(): string | null {
    const s = this.undoStack.pop();
    if (!s) return null;
    this.apply(s, true);
    this.redoStack.push(s);
    this.onChange();
    return s.label;
  }

  redo(): string | null {
    const s = this.redoStack.pop();
    if (!s) return null;
    this.apply(s, false);
    this.undoStack.push(s);
    this.onChange();
    return s.label;
  }

  dropLast(): void {
    const s = this.undoStack.pop();
    if (s) this.bytes -= this.size(s);
    this.onChange();
  }
}
