import { loadObjectModel, objectAt } from './ai';
import { LOOKS, lookIndex, lookRGB } from './looks';
import { fillHoles, grow, refine, resample } from './masks';
import { shareFile } from './share';
import { button, downloadBlob, h, icons, toast } from './util';

type Tool = 'none' | 'crop' | 'draw' | 'text' | 'cutout';
type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'move';

interface Adjust {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  vignette: number;
  look: string;
  amount: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const defaultAdjust = (): Adjust => ({ brightness: 0, contrast: 0, saturation: 0, warmth: 0, vignette: 0, look: 'none', amount: 1 });

const ASPECTS: [string, number][] = [
  ['Free', 0],
  ['1:1', 1],
  ['16:9', 16 / 9],
  ['9:16', 9 / 16],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
];

function copyCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = h('canvas', { width: String(src.width), height: String(src.height) });
  c.getContext('2d')?.drawImage(src, 0, 0);
  return c;
}

function adjustPixels(img: ImageData, a: Adjust): void {
  const d = img.data;
  const { width: w, height: hgt } = img;
  const look = lookIndex(a.look);
  const sat = 1 + a.saturation;
  for (let y = 0; y < hgt; y++) {
    const vy = (y / hgt - 0.5) * 1.35;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let r = d[i] / 255 + a.brightness * 0.5;
      let g = d[i + 1] / 255 + a.brightness * 0.5;
      let b = d[i + 2] / 255 + a.brightness * 0.5;
      r = (r - 0.5) * (1 + a.contrast) + 0.5 + a.warmth * 0.1;
      g = (g - 0.5) * (1 + a.contrast) + 0.5;
      b = (b - 0.5) * (1 + a.contrast) + 0.5 - a.warmth * 0.1;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = l + (r - l) * sat;
      g = l + (g - l) * sat;
      b = l + (b - l) * sat;
      if (look) {
        const [lr, lg, lb] = lookRGB(look, Math.min(1, Math.max(0, r)), Math.min(1, Math.max(0, g)), Math.min(1, Math.max(0, b)));
        r += (lr - r) * a.amount;
        g += (lg - g) * a.amount;
        b += (lb - b) * a.amount;
      }
      if (a.vignette) {
        const vx = (x / w - 0.5) * 1.35;
        const dist = Math.sqrt(vx * vx + vy * vy);
        const t = Math.min(1, Math.max(0, (dist - 0.3) / 0.55));
        const v = 1 - a.vignette * t * t * (3 - 2 * t);
        r *= v;
        g *= v;
        b *= v;
      }
      d[i] = r * 255;
      d[i + 1] = g * 255;
      d[i + 2] = b * 255;
    }
  }
}

export class ImageEditor {
  private readonly overlay = h('div', { class: 'overlay editor-overlay' });
  private readonly stage = h('div', { class: 'ie-stage' });
  private readonly view = h('canvas', { class: 'ie-view' });
  private readonly preview = h('canvas');
  private readonly title = h('span', { class: 'ie-title' });
  private readonly cropBar = h('div', { class: 'ie-cropbar hidden' });
  private readonly toolBtns = {} as Record<Exclude<Tool, 'none'>, HTMLButtonElement>;
  private readonly lookBtns: HTMLButtonElement[] = [];
  private readonly sliders: { key: keyof Adjust; range: HTMLInputElement }[] = [];
  private base = h('canvas');
  private history: HTMLCanvasElement[] = [];
  private adjust = defaultAdjust();
  private tool: Tool = 'none';
  private aspect = 0;
  private crop: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private dragging: { handle: Handle; x: number; y: number; start: Rect } | null = null;
  private drawing = false;
  private lastPoint: [number, number] | null = null;
  private brush = { color: '#ff4d4d', size: 14 };
  private text = { value: 'Your text', color: '#ffffff', size: 96, bold: true };
  private fit = { s: 1, dx: 0, dy: 0 };
  private name = 'image.png';
  private onSave: ((file: File) => void) | null = null;
  private frame = 0;
  private selection: { mask: Uint8Array; w: number; h: number; tint: HTMLCanvasElement } | null = null;
  private readonly cutStatus = h('p', { class: 'hint' }, 'Tap or click an object in the image.');
  private readonly cutBtns: HTMLButtonElement[] = [];
  private busy = false;
  private addMode = false;
  private addToggle = h('label');

  constructor() {
    this.overlay.classList.add('hidden');
    this.stage.append(this.view, this.cropBar);
    this.overlay.append(h('div', { class: 'ie-window' }, this.header(), h('div', { class: 'ie-body' }, this.panel(), this.stage), this.footer()));
    document.body.append(this.overlay);
    new ResizeObserver(() => this.refresh()).observe(this.stage);
    this.view.addEventListener('pointerdown', e => this.onDown(e));
    this.view.addEventListener('pointermove', e => this.onMove(e));
    this.view.addEventListener('pointerup', () => this.onUp());
    window.addEventListener('keydown', e => {
      if (this.overlay.classList.contains('hidden')) return;
      if (e.key === 'Escape') this.close();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.undo();
      }
      e.stopPropagation();
    }, true);
  }

  async open(source: Blob, name: string, onSave: (file: File) => void): Promise<void> {
    const bitmap = await createImageBitmap(source);
    this.base = h('canvas', { width: String(bitmap.width), height: String(bitmap.height) });
    this.base.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close();
    this.history = [];
    this.selection = null;
    this.syncCutout();
    this.adjust = defaultAdjust();
    this.name = name;
    this.onSave = onSave;
    this.title.textContent = name;
    this.setTool('none');
    this.syncControls();
    this.overlay.classList.remove('hidden');
    requestAnimationFrame(() => this.refresh());
  }

  private close(): void {
    this.overlay.classList.add('hidden');
  }

  private header(): HTMLElement {
    return h('div', { class: 'ie-header' }, h('span', { class: 'ie-brand' }, h('span', { class: 'logo small' }), 'Image Editor'), this.title, button(icons.close, 'Close (Esc)', () => this.close(), 'icon-btn'));
  }

  private group(title: string, ...children: HTMLElement[]): HTMLElement {
    return h('section', { class: 'insp-section' }, h('h4', {}, title), ...children);
  }

  private panel(): HTMLElement {
    const transform = h(
      'div',
      { class: 'btn-row' },
      button(`${icons.rotL}`, 'Rotate left', () => this.rotate(-1), 'icon-btn boxed'),
      button(`${icons.rotR}`, 'Rotate right', () => this.rotate(1), 'icon-btn boxed'),
      button('Flip H', 'Flip horizontally', () => this.flip(true), 'btn small'),
      button('Flip V', 'Flip vertically', () => this.flip(false), 'btn small'),
    );
    this.toolBtns.crop = button('Crop', 'Crop the image', () => this.setTool(this.tool === 'crop' ? 'none' : 'crop'), 'btn small');
    this.toolBtns.draw = button(`${icons.pencil}<span>Draw</span>`, 'Draw with a brush', () => this.setTool(this.tool === 'draw' ? 'none' : 'draw'), 'btn small');
    this.toolBtns.text = button(`${icons.text}<span>Text</span>`, 'Click on the image to add text', () => this.setTool(this.tool === 'text' ? 'none' : 'text'), 'btn small');
    this.toolBtns.cutout = button(`${icons.wand}<span>Select object</span>`, 'Click an object to select it with AI', () => this.setTool(this.tool === 'cutout' ? 'none' : 'cutout'), 'btn small');
    const addBox = h('input', { type: 'checkbox' });
    addBox.addEventListener('change', () => (this.addMode = addBox.checked));
    this.addToggle = h('label', { class: 'inline check-row' }, addBox, ' Add to selection (or Shift-click)');
    this.cutBtns.push(
      button('Keep object', 'Remove everything except the selected object (transparent background)', () => this.keepObject(), 'btn small primary'),
      button('Erase object', 'Remove the selected object and fill the gap', () => this.eraseObject(), 'btn small'),
      button('Clear', 'Clear the selection', () => this.clearSelection(), 'btn small'),
    );

    const adjustRows = ([
      ['brightness', 'Brightness', -1, 1],
      ['contrast', 'Contrast', -1, 1],
      ['saturation', 'Saturation', -1, 1],
      ['warmth', 'Warmth', -1, 1],
      ['vignette', 'Vignette', 0, 1],
      ['amount', 'Filter amount', 0, 1],
    ] as [keyof Adjust, string, number, number][]).map(([key, label, min, max]) => {
      const range = h('input', { type: 'range', min: String(min), max: String(max), step: '0.01' });
      range.addEventListener('input', () => {
        (this.adjust[key] as number) = Number(range.value);
        this.refresh();
      });
      range.addEventListener('dblclick', () => {
        (this.adjust[key] as number) = defaultAdjust()[key] as number;
        this.syncControls();
        this.refresh();
      });
      this.sliders.push({ key, range });
      return h('label', { class: 'field two', title: 'Double-click to reset' }, h('span', {}, label), range);
    });

    const looks = h('div', { class: 'look-grid' });
    for (const look of LOOKS) {
      const b = button(look.label, `${look.label} filter`, () => {
        this.adjust.look = look.id;
        this.syncControls();
        this.refresh();
      }, `look-chip look-${look.id}`);
      b.dataset.look = look.id;
      this.lookBtns.push(b);
      looks.append(b);
    }

    const brushColor = h('input', { type: 'color', value: this.brush.color });
    brushColor.addEventListener('input', () => (this.brush.color = brushColor.value));
    const brushSize = h('input', { type: 'range', min: '2', max: '80', value: String(this.brush.size) });
    brushSize.addEventListener('input', () => (this.brush.size = Number(brushSize.value)));

    const textValue = h('input', { type: 'text', class: 'text-input', value: this.text.value });
    textValue.addEventListener('input', () => (this.text.value = textValue.value));
    const textColor = h('input', { type: 'color', value: this.text.color });
    textColor.addEventListener('input', () => (this.text.color = textColor.value));
    const textSize = h('input', { type: 'range', min: '16', max: '320', value: String(this.text.size) });
    textSize.addEventListener('input', () => (this.text.size = Number(textSize.value)));

    return h(
      'aside',
      { class: 'ie-panel' },
      this.group('Transform', transform, h('div', { class: 'btn-row' }, this.toolBtns.crop)),
      this.group('AI Cutout', h('div', { class: 'btn-row' }, this.toolBtns.cutout), this.addToggle, h('div', { class: 'btn-row' }, ...this.cutBtns), this.cutStatus),
      this.group('Adjust', ...adjustRows),
      this.group('Filters', looks),
      this.group('Draw', h('div', { class: 'btn-row' }, this.toolBtns.draw, brushColor), h('label', { class: 'field two' }, h('span', {}, 'Brush size'), brushSize)),
      this.group('Text', h('div', { class: 'btn-row' }, this.toolBtns.text, textColor), textValue, h('label', { class: 'field two' }, h('span', {}, 'Text size'), textSize)),
    );
  }

  private footer(): HTMLElement {
    for (const [label, ratio] of ASPECTS) {
      const b = button(label, `Crop to ${label}`, () => {
        this.aspect = ratio;
        this.cropBar.querySelectorAll('.btn').forEach(el => el.classList.toggle('active', el === b));
        this.resetCrop();
      }, `btn small${ratio === 0 ? ' active' : ''}`);
      this.cropBar.append(b);
    }
    this.cropBar.append(h('span', { class: 'grow' }), button('Cancel', 'Cancel crop', () => this.setTool('none'), 'btn small'), button('Apply crop', 'Apply crop', () => this.applyCrop(), 'btn small primary'));
    return h(
      'div',
      { class: 'ie-footer' },
      button('Undo', 'Undo (Ctrl+Z)', () => this.undo(), 'btn small'),
      button('Reset', 'Undo every change', () => this.resetAll(), 'btn small'),
      h('span', { class: 'grow' }),
      button(`${icons.share}<span>Share</span>`, 'Share the edited image', () => void this.export('image/png').then(f => shareFile(f)), 'btn small'),
      button('Export JPG', 'Download as JPG', () => void this.export('image/jpeg').then(f => downloadBlob(f, f.name)), 'btn small'),
      button('Export PNG', 'Download as PNG', () => void this.export('image/png').then(f => downloadBlob(f, f.name)), 'btn small'),
      button('Save to Media Pool', 'Add the edited image to the project', () => void this.saveToPool(), 'btn small primary'),
    );
  }

  private syncControls(): void {
    this.sliders.forEach(s => (s.range.value = String(this.adjust[s.key])));
    this.lookBtns.forEach(b => b.classList.toggle('on', b.dataset.look === this.adjust.look));
  }

  private syncCutout(): void {
    this.cutBtns.forEach(b => (b.disabled = !this.selection || this.busy));
  }

  private clearSelection(): void {
    this.selection = null;
    this.syncCutout();
    this.refresh();
  }

  private async pickObject(x: number, y: number, add: boolean): Promise<void> {
    if (this.busy) return;
    const { width: W, height: H } = this.base;
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    this.busy = true;
    this.syncCutout();
    this.cutStatus.textContent = 'Finding the object… (the first time downloads a small AI model)';
    try {
      const s = Math.min(1, 1024 / Math.max(W, H));
      const w = Math.max(2, Math.round(W * s));
      const hh = Math.max(2, Math.round(H * s));
      const small = h('canvas', { width: String(w), height: String(hh) });
      const ctx = small.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(this.base, 0, 0, w, hh);
      const frame = { rgba: ctx.getImageData(0, 0, w, hh).data, width: w, height: hh };
      const model = await loadObjectModel();
      const raw = objectAt(model, small, x / W, y / H);
      if (!raw) throw new Error('nothing was found there');
      let mask = refine(resample(raw.data, raw.width, raw.height, w, hh), frame);
      if (add && this.selection?.w === w && this.selection.h === hh) {
        const prev = this.selection.mask;
        mask = mask.map((v, i) => Math.max(v, prev[i]));
      }
      const tint = h('canvas', { width: String(w), height: String(hh) });
      const tctx = tint.getContext('2d');
      const img = new ImageData(w, hh);
      for (let i = 0; i < mask.length; i++) {
        img.data[i * 4] = 255;
        img.data[i * 4 + 1] = 45;
        img.data[i * 4 + 2] = 85;
        img.data[i * 4 + 3] = mask[i] * 0.5;
      }
      tctx?.putImageData(img, 0, 0);
      this.selection = { mask, w, h: hh, tint };
      this.cutStatus.textContent = 'Object selected. Keep it or erase it, or turn on Add to selection and tap another object.';
    } catch (e) {
      this.cutStatus.textContent = `Could not select: ${(e as Error).message}. The first use needs internet.`;
    } finally {
      this.busy = false;
      this.syncCutout();
      this.refresh();
    }
  }

  private maskCanvas(mask: Uint8Array, w: number, hh: number): HTMLCanvasElement {
    const c = h('canvas', { width: String(w), height: String(hh) });
    const img = new ImageData(w, hh);
    for (let i = 0; i < mask.length; i++) img.data[i * 4 + 3] = mask[i];
    c.getContext('2d')?.putImageData(img, 0, 0);
    return c;
  }

  private keepObject(): void {
    const sel = this.selection;
    if (!sel) return;
    this.push();
    const ctx = this.base.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.maskCanvas(sel.mask, sel.w, sel.h), 0, 0, this.base.width, this.base.height);
    ctx.restore();
    toast('Background removed. Export as PNG to keep the transparency.');
    this.clearSelection();
  }

  private eraseObject(): void {
    const sel = this.selection;
    if (!sel) return;
    this.push();
    const { width: W, height: H } = this.base;
    const s = Math.min(1, 2048 / Math.max(W, H));
    const w = Math.max(2, Math.round(W * s));
    const hh = Math.max(2, Math.round(H * s));
    const work = h('canvas', { width: String(w), height: String(hh) });
    const wctx = work.getContext('2d', { willReadFrequently: true });
    if (!wctx) return;
    wctx.drawImage(this.maskCanvas(sel.mask, sel.w, sel.h), 0, 0, w, hh);
    const alpha = wctx.getImageData(0, 0, w, hh).data;
    let mask = new Uint8Array(w * hh);
    for (let i = 0; i < mask.length; i++) mask[i] = alpha[i * 4 + 3] > 60 ? 255 : 0;
    mask = grow(mask, w, hh, Math.max(2, Math.round(Math.max(w, hh) / 150)));
    wctx.clearRect(0, 0, w, hh);
    wctx.drawImage(this.base, 0, 0, w, hh);
    const img = wctx.getImageData(0, 0, w, hh);
    fillHoles(img.data, mask, w, hh);
    wctx.putImageData(img, 0, 0);
    const patch = h('canvas', { width: String(W), height: String(H) });
    const pctx = patch.getContext('2d');
    if (!pctx) return;
    pctx.drawImage(work, 0, 0, W, H);
    pctx.globalCompositeOperation = 'destination-in';
    pctx.filter = `blur(${Math.max(1, Math.round(1.5 / s))}px)`;
    pctx.drawImage(this.maskCanvas(mask, w, hh), 0, 0, W, H);
    this.base.getContext('2d')?.drawImage(patch, 0, 0);
    toast('Object erased');
    this.clearSelection();
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    (Object.keys(this.toolBtns) as Exclude<Tool, 'none'>[]).forEach(k => this.toolBtns[k].classList.toggle('active', k === tool));
    this.cropBar.classList.toggle('hidden', tool !== 'crop');
    this.view.dataset.tool = tool;
    if (tool === 'crop') this.resetCrop();
    this.drawOverlay();
  }

  private push(): void {
    this.history.push(copyCanvas(this.base));
    if (this.history.length > 25) this.history.shift();
  }

  private undo(): void {
    const prev = this.history.pop();
    if (!prev) return;
    this.base = prev;
    this.selection = null;
    this.syncCutout();
    if (this.tool === 'crop') this.resetCrop();
    this.refresh();
  }

  private resetAll(): void {
    if (this.history.length) this.base = this.history[0];
    this.history = [];
    this.adjust = defaultAdjust();
    this.syncControls();
    this.setTool('none');
    this.refresh();
  }

  private rotate(dir: 1 | -1): void {
    this.push();
    const src = this.base;
    const out = h('canvas', { width: String(src.height), height: String(src.width) });
    const ctx = out.getContext('2d');
    if (ctx) {
      ctx.translate(out.width / 2, out.height / 2);
      ctx.rotate((dir * Math.PI) / 2);
      ctx.drawImage(src, -src.width / 2, -src.height / 2);
    }
    this.base = out;
    if (this.tool === 'crop') this.resetCrop();
    this.refresh();
  }

  private flip(horizontal: boolean): void {
    this.push();
    const src = copyCanvas(this.base);
    const ctx = this.base.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.clearRect(0, 0, src.width, src.height);
    ctx.translate(horizontal ? src.width : 0, horizontal ? 0 : src.height);
    ctx.scale(horizontal ? -1 : 1, horizontal ? 1 : -1);
    ctx.drawImage(src, 0, 0);
    ctx.restore();
    this.refresh();
  }

  private resetCrop(): void {
    const { width: w, height: hgt } = this.base;
    if (!this.aspect) {
      this.crop = { x: w * 0.05, y: hgt * 0.05, w: w * 0.9, h: hgt * 0.9 };
    } else {
      const cw = Math.min(w, hgt * this.aspect) * 0.9;
      const ch = cw / this.aspect;
      this.crop = { x: (w - cw) / 2, y: (hgt - ch) / 2, w: cw, h: ch };
    }
    this.drawOverlay();
  }

  private applyCrop(): void {
    const r = this.crop;
    if (r.w < 4 || r.h < 4) return;
    this.push();
    const out = h('canvas', { width: String(Math.round(r.w)), height: String(Math.round(r.h)) });
    out.getContext('2d')?.drawImage(this.base, r.x, r.y, r.w, r.h, 0, 0, out.width, out.height);
    this.base = out;
    this.setTool('none');
    this.refresh();
  }

  private refresh(): void {
    if (this.overlay.classList.contains('hidden')) return;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.renderPreview());
  }

  private renderPreview(): void {
    const dpr = window.devicePixelRatio || 1;
    const cw = this.stage.clientWidth;
    const ch = this.stage.clientHeight;
    if (!cw || !ch) return;
    this.view.width = Math.round(cw * dpr);
    this.view.height = Math.round(ch * dpr);
    this.view.style.width = `${cw}px`;
    this.view.style.height = `${ch}px`;
    const pad = 24 * dpr;
    const { width: bw, height: bh } = this.base;
    const s = Math.min((this.view.width - pad * 2) / bw, (this.view.height - pad * 2) / bh, 4 * dpr);
    const pw = Math.max(1, Math.round(bw * s));
    const ph = Math.max(1, Math.round(bh * s));
    this.fit = { s, dx: Math.round((this.view.width - pw) / 2), dy: Math.round((this.view.height - ph) / 2) };
    this.preview.width = pw;
    this.preview.height = ph;
    const pctx = this.preview.getContext('2d', { willReadFrequently: true });
    if (!pctx) return;
    pctx.drawImage(this.base, 0, 0, pw, ph);
    const img = pctx.getImageData(0, 0, pw, ph);
    adjustPixels(img, this.adjust);
    pctx.putImageData(img, 0, 0);
    this.drawOverlay();
  }

  private drawOverlay(): void {
    const ctx = this.view.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#0b0b0c';
    ctx.fillRect(0, 0, this.view.width, this.view.height);
    const { s, dx, dy } = this.fit;
    const cell = 12;
    for (let y = 0; y < this.preview.height; y += cell) {
      for (let x = 0; x < this.preview.width; x += cell) {
        ctx.fillStyle = ((x + y) / cell) % 2 ? '#3a3a40' : '#2a2a2f';
        ctx.fillRect(dx + x, dy + y, Math.min(cell, this.preview.width - x), Math.min(cell, this.preview.height - y));
      }
    }
    ctx.drawImage(this.preview, dx, dy);
    if (this.selection) ctx.drawImage(this.selection.tint, dx, dy, this.preview.width, this.preview.height);
    if (this.tool !== 'crop') return;
    const r = { x: dx + this.crop.x * s, y: dy + this.crop.y * s, w: this.crop.w * s, h: this.crop.h * s };
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.rect(dx, dy, this.preview.width, this.preview.height);
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    for (const f of [1 / 3, 2 / 3]) {
      ctx.beginPath();
      ctx.moveTo(r.x + r.w * f, r.y);
      ctx.lineTo(r.x + r.w * f, r.y + r.h);
      ctx.moveTo(r.x, r.y + r.h * f);
      ctx.lineTo(r.x + r.w, r.y + r.h * f);
      ctx.stroke();
    }
    ctx.fillStyle = '#ffb347';
    for (const [hx, hy] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) ctx.fillRect(hx - 6, hy - 6, 12, 12);
  }

  private toBase(e: PointerEvent): [number, number] {
    const rect = this.view.getBoundingClientRect();
    const dpr = this.view.width / rect.width;
    return [((e.clientX - rect.left) * dpr - this.fit.dx) / this.fit.s, ((e.clientY - rect.top) * dpr - this.fit.dy) / this.fit.s];
  }

  private onDown(e: PointerEvent): void {
    const [x, y] = this.toBase(e);
    if (this.tool === 'crop') {
      const r = this.crop;
      const tol = 14 / this.fit.s;
      const near = (px: number, py: number): boolean => Math.abs(x - px) < tol && Math.abs(y - py) < tol;
      let handle: Handle | null = null;
      if (near(r.x, r.y)) handle = 'nw';
      else if (near(r.x + r.w, r.y)) handle = 'ne';
      else if (near(r.x, r.y + r.h)) handle = 'sw';
      else if (near(r.x + r.w, r.y + r.h)) handle = 'se';
      else if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) handle = 'move';
      if (!handle) return;
      this.view.setPointerCapture(e.pointerId);
      this.dragging = { handle, x, y, start: { ...r } };
    } else if (this.tool === 'draw') {
      this.push();
      this.view.setPointerCapture(e.pointerId);
      this.drawing = true;
      this.lastPoint = [x, y];
      this.stroke(x, y);
    } else if (this.tool === 'cutout') {
      void this.pickObject(x, y, e.shiftKey || this.addMode);
    } else if (this.tool === 'text') {
      if (!this.text.value.trim()) return;
      this.push();
      const ctx = this.base.getContext('2d');
      if (!ctx) return;
      const size = this.text.size * (this.base.height / 1080);
      ctx.font = `${this.text.bold ? 700 : 500} ${size}px "Inter", "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.text.color;
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = size * 0.1;
      ctx.fillText(this.text.value, x, y);
      ctx.shadowBlur = 0;
      this.refresh();
    }
  }

  private onMove(e: PointerEvent): void {
    const [x, y] = this.toBase(e);
    if (this.drawing) {
      this.stroke(x, y);
      return;
    }
    const d = this.dragging;
    if (!d) return;
    const { width: bw, height: bh } = this.base;
    const s = d.start;
    const dx = x - d.x;
    const dy = y - d.y;
    let r: Rect;
    if (d.handle === 'move') {
      r = { ...s, x: Math.min(Math.max(0, s.x + dx), bw - s.w), y: Math.min(Math.max(0, s.y + dy), bh - s.h) };
    } else {
      const left = d.handle === 'nw' || d.handle === 'sw';
      const top = d.handle === 'nw' || d.handle === 'ne';
      const ax = left ? s.x + s.w : s.x;
      const ay = top ? s.y + s.h : s.y;
      let w = Math.max(16, left ? ax - Math.max(0, s.x + dx) : Math.min(bw, s.x + s.w + dx) - ax);
      let hh = Math.max(16, top ? ay - Math.max(0, s.y + dy) : Math.min(bh, s.y + s.h + dy) - ay);
      if (this.aspect) {
        hh = w / this.aspect;
        const maxH = top ? ay : bh - ay;
        if (hh > maxH) {
          hh = maxH;
          w = hh * this.aspect;
        }
      }
      r = { x: left ? ax - w : ax, y: top ? ay - hh : ay, w, h: hh };
    }
    this.crop = r;
    this.drawOverlay();
  }

  private onUp(): void {
    this.dragging = null;
    if (this.drawing) {
      this.drawing = false;
      this.lastPoint = null;
      this.refresh();
    }
  }

  private stroke(x: number, y: number): void {
    const ctx = this.base.getContext('2d');
    if (!ctx || !this.lastPoint) return;
    const size = this.brush.size * (Math.max(this.base.width, this.base.height) / 1200);
    ctx.strokeStyle = this.brush.color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(this.lastPoint[0], this.lastPoint[1]);
    ctx.lineTo(x + 0.01, y);
    ctx.stroke();
    this.lastPoint = [x, y];
    this.refresh();
  }

  private async export(type: 'image/png' | 'image/jpeg'): Promise<File> {
    const out = copyCanvas(this.base);
    const ctx = out.getContext('2d', { willReadFrequently: true });
    if (ctx && type === 'image/jpeg') {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (ctx) {
      const img = ctx.getImageData(0, 0, out.width, out.height);
      adjustPixels(img, this.adjust);
      ctx.putImageData(img, 0, 0);
    }
    const blob = await new Promise<Blob>((resolve, reject) => out.toBlob(b => (b ? resolve(b) : reject(new Error('Export failed'))), type, 0.92));
    const stem = this.name.replace(/\.[^.]+$/, '');
    return new File([blob], `${stem}-edited.${type === 'image/png' ? 'png' : 'jpg'}`, { type });
  }

  private async saveToPool(): Promise<void> {
    const file = await this.export('image/png');
    this.onSave?.(file);
    this.close();
  }
}
