import type { Engine } from './engine';
import { hasKeys, keyAt, localTime, removeKey, setKey, valueAt } from './keys';
import { LOOKS, defaultSecondary, fxOf, secondaryOf } from './looks';
import { Scopes } from './scopes';
import { defaultGrade, store } from './state';
import type { Clip, Grade, KeyProp, PowerWindow, Qualifier, Secondary, Wheel } from './types';
import { button, clamp, h, timecode, toast } from './util';
import type { Viewer } from './viewer';

type WheelKey = 'lift' | 'gamma' | 'gain' | 'offset';
type SliderKey = 'exposure' | 'contrast' | 'saturation' | 'temperature' | 'tint' | 'shadows' | 'highlights';

const SIZE = 128;
const R = SIZE / 2 - 7;
const ZERO: Wheel = { x: 0, y: 0, m: 0 };

let hueDisk: HTMLCanvasElement | null = null;

function disk(): HTMLCanvasElement {
  if (hueDisk) return hueDisk;
  const c = h('canvas', { width: String(SIZE), height: String(SIZE) });
  const ctx = c.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(SIZE, SIZE);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const dx = x - SIZE / 2;
        const dy = SIZE / 2 - y;
        const r = Math.hypot(dx, dy) / R;
        if (r > 1) continue;
        const a = Math.atan2(dy, dx);
        const i = (y * SIZE + x) * 4;
        const k = 0.42 * r;
        img.data[i] = 255 * (0.42 + k * Math.cos(a));
        img.data[i + 1] = 255 * (0.42 + k * Math.cos(a - 2.0944));
        img.data[i + 2] = 255 * (0.42 + k * Math.cos(a + 2.0944));
        img.data[i + 3] = 255 * Math.min(1, (1 - r) * R);
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  hueDisk = c;
  return c;
}

class WheelControl {
  readonly root: HTMLElement;
  private readonly canvas = h('canvas', { class: 'wheel', width: String(SIZE), height: String(SIZE) });
  private readonly master = h('input', { type: 'range', min: '-1', max: '1', step: '0.005', value: '0' });
  private readonly readout = h('div', { class: 'wheel-readout' });
  private value: Wheel = { ...ZERO };

  constructor(label: string, private readonly onChange: (w: Wheel) => void, onEnd: () => void) {
    const reset = button('Reset', `Reset ${label}`, () => {
      this.set({ ...ZERO });
      this.onChange(this.value);
      onEnd();
    }, 'link-btn');
    this.root = h('div', { class: 'wheel-box' }, h('div', { class: 'wheel-head' }, h('span', {}, label), reset), this.canvas, this.master, this.readout);
    const drag = (e: PointerEvent): void => {
      const r = this.canvas.getBoundingClientRect();
      const s = SIZE / r.width;
      let x = ((e.clientX - r.left) * s - SIZE / 2) / R;
      let y = (SIZE / 2 - (e.clientY - r.top) * s) / R;
      const len = Math.hypot(x, y);
      if (len > 1) [x, y] = [x / len, y / len];
      this.value = { ...this.value, x, y };
      this.draw();
      this.onChange(this.value);
    };
    this.canvas.addEventListener('pointerdown', e => {
      this.canvas.setPointerCapture(e.pointerId);
      drag(e);
    });
    this.canvas.addEventListener('pointermove', e => {
      if (this.canvas.hasPointerCapture(e.pointerId)) drag(e);
    });
    this.canvas.addEventListener('pointerup', onEnd);
    this.canvas.addEventListener('dblclick', () => {
      this.value = { ...this.value, x: 0, y: 0 };
      this.draw();
      this.onChange(this.value);
      onEnd();
    });
    this.master.addEventListener('input', () => {
      this.value = { ...this.value, m: Number(this.master.value) };
      this.draw();
      this.onChange(this.value);
    });
    this.master.addEventListener('change', onEnd);
    this.draw();
  }

  set(w: Wheel): void {
    this.value = { ...w };
    this.master.value = String(w.m);
    this.draw();
  }

  disable(off: boolean): void {
    this.root.classList.toggle('disabled', off);
    this.master.disabled = off;
  }

  private draw(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(disk(), 0, 0);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.moveTo(SIZE / 2 - 6, SIZE / 2);
    ctx.lineTo(SIZE / 2 + 6, SIZE / 2);
    ctx.moveTo(SIZE / 2, SIZE / 2 - 6);
    ctx.lineTo(SIZE / 2, SIZE / 2 + 6);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.arc(SIZE / 2 + this.value.x * R, SIZE / 2 - this.value.y * R, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    const a = Math.atan2(this.value.y, this.value.x);
    const r = Math.hypot(this.value.x, this.value.y);
    const ch = [Math.cos(a), Math.cos(a - 2.0944), Math.cos(a + 2.0944)].map(v => (v * r + this.value.m).toFixed(2));
    this.readout.textContent = `R ${ch[0]}  G ${ch[1]}  B ${ch[2]}`;
  }
}

interface Row {
  range: HTMLInputElement;
  num: HTMLInputElement;
  kf?: HTMLButtonElement;
}

let clipboard: Grade | null = null;

export class ColorPage {
  readonly root = h('div', { class: 'page page-color' });
  readonly viewerSlot = h('div', { class: 'slot slot-viewer' });
  readonly scopes = new Scopes();
  private readonly strip = h('div', { class: 'strip' });
  private readonly target = h('div', { class: 'grade-target' });
  private readonly wheels: Record<WheelKey, WheelControl>;
  private readonly sliders = {} as Record<SliderKey, Row>;
  private readonly secRows = new Map<string, Row & { get: (s: Secondary) => number }>();
  private readonly secToggles = new Map<string, { el: HTMLInputElement; get: (s: Secondary) => boolean }>();
  private readonly look = h('select', { class: 'select small' });
  private readonly shape = h('select', { class: 'select small' });
  private readonly overlay = h('canvas', { class: 'window-overlay' });
  private picking = false;
  private editing = false;
  private active = false;
  private dragMode: 'move' | 'size' | null = null;

  constructor(private readonly engine: Engine, private readonly viewer: Viewer) {
    const end = (): void => {
      this.editing = false;
    };
    this.wheels = {
      lift: new WheelControl('Lift', w => this.setWheel('lift', w), end),
      gamma: new WheelControl('Gamma', w => this.setWheel('gamma', w), end),
      gain: new WheelControl('Gain', w => this.setWheel('gain', w), end),
      offset: new WheelControl('Offset', w => this.setWheel('offset', w), end),
    };
    LOOKS.forEach(l => this.look.append(h('option', { value: l.id }, l.label)));
    this.look.addEventListener('change', () => this.editClip(c => (c.fx = { ...fxOf(c), look: this.look.value }), true));

    const sliderDefs: [SliderKey, string, number, number, boolean][] = [
      ['exposure', 'Exposure', -3, 3, true],
      ['contrast', 'Contrast', -1, 1, true],
      ['saturation', 'Saturation', 0, 2, true],
      ['temperature', 'Temperature', -1, 1, true],
      ['tint', 'Tint', -1, 1, true],
      ['shadows', 'Shadows', -1, 1, false],
      ['highlights', 'Highlights', -1, 1, false],
    ];
    const sliderRows = sliderDefs.map(([key, label, min, max, keyable]) => this.gradeSlider(key, label, min, max, keyable, end));
    const actions = h(
      'div',
      { class: 'grade-actions' },
      button('Copy grade', 'Copy this grade', () => {
        const c = this.clip();
        if (c) clipboard = structuredClone(c.grade);
      }, 'btn small'),
      button('Paste grade', 'Paste the copied grade', () => {
        if (!clipboard) return;
        const grade = structuredClone(clipboard);
        this.editClip(c => (c.grade = grade), true);
      }, 'btn small'),
      button('Reset all', 'Reset every correction on this clip', () => this.editClip(c => {
        c.grade = defaultGrade();
        c.secondary = undefined;
      }, true), 'btn small danger'),
    );
    const primaries = h('div', { class: 'panel primaries' }, h('div', { class: 'panel-head' }, h('span', {}, 'Primaries – Color Wheels'), this.target), h('div', { class: 'wheels' }, ...Object.values(this.wheels).map(w => w.root)));
    const adjust = h('div', { class: 'panel adjust' }, h('div', { class: 'panel-head' }, 'Adjustments'), h('div', { class: 'adjust-body' }, h('label', { class: 'field two' }, h('span', {}, 'Look (filter)'), this.look), ...sliderRows, actions));
    this.root.append(this.viewerSlot, h('div', { class: 'slot slot-scopes' }, this.scopes.root), h('div', { class: 'panel strip-panel' }, this.strip), h('div', { class: 'grade-panels' }, primaries, adjust, this.secondaryPanel(end)));

    this.overlay.addEventListener('pointerdown', e => this.onOverlayDown(e));
    this.overlay.addEventListener('pointermove', e => this.onOverlayMove(e));
    this.overlay.addEventListener('pointerup', () => {
      this.dragMode = null;
      end();
    });
    new ResizeObserver(() => this.drawOverlay()).observe(viewer.stage);

    store.on(c => {
      if (c === 'selection' || c === 'media' || (c === 'project' && !this.editing)) {
        this.renderStrip();
        this.sync();
      }
      if (c === 'playhead' && !store.ui.playing && !this.editing) this.sync();
      if (c === 'project' && this.editing) this.drawOverlay();
    });
    this.renderStrip();
    this.sync();
  }

  activate(active: boolean): void {
    this.active = active;
    this.engine.onFrame = active ? canvas => this.scopes.update(canvas) : null;
    this.viewer.setOverlay(active ? this.overlay : null);
    if (active) {
      this.renderStrip();
      this.sync();
      this.engine.requestRender();
    }
  }

  private gradeSlider(key: SliderKey, label: string, min: number, max: number, keyable: boolean, end: () => void): HTMLElement {
    const range = h('input', { type: 'range', min: String(min), max: String(max), step: '0.01' });
    const num = h('input', { type: 'number', min: String(min), max: String(max), step: '0.01' });
    const apply = (v: number): void => {
      if (!Number.isFinite(v)) return;
      const next = clamp(v, min, max);
      this.editClip(c => {
        const prop = key as KeyProp;
        if (keyable && hasKeys(c, prop)) setKey(c, prop, localTime(c, store.ui.playhead), next);
        else (c.grade as unknown as Record<string, number>)[key] = next;
      });
      range.value = num.value = String(next);
    };
    range.addEventListener('input', () => apply(Number(range.value)));
    num.addEventListener('input', () => apply(Number(num.value)));
    range.addEventListener('change', end);
    num.addEventListener('change', end);
    range.addEventListener('dblclick', () => {
      apply((defaultGrade() as unknown as Record<string, number>)[key] ?? 0);
      end();
    });
    const row: Row = { range, num };
    const el = h('label', { class: `field${keyable ? ' keyed' : ''}`, title: 'Double-click the slider to reset' }, h('span', {}, label), range, num);
    if (keyable) {
      row.kf = button('', 'Keyframe this value at the playhead', () => {
        this.editClip(c => {
          const prop = key as KeyProp;
          const t = localTime(c, store.ui.playhead);
          if (keyAt(c, prop, t)) removeKey(c, prop, t);
          else setKey(c, prop, t, valueAt(c, prop, t));
        }, true);
      }, 'kf');
      el.append(row.kf);
    }
    this.sliders[key] = row;
    return el;
  }

  private secondaryPanel(end: () => void): HTMLElement {
    const toggle = (label: string, get: (s: Secondary) => boolean, set: (s: Secondary, v: boolean) => void): HTMLElement => {
      const el = h('input', { type: 'checkbox' });
      el.addEventListener('change', () => this.editSec(s => set(s, el.checked), true));
      this.secToggles.set(label, { el, get });
      return h('label', { class: 'inline check' }, el, ` ${label}`);
    };
    const slider = (id: string, label: string, min: number, max: number, get: (s: Secondary) => number, set: (s: Secondary, v: number) => void): HTMLElement => {
      const range = h('input', { type: 'range', min: String(min), max: String(max), step: String((max - min) / 400) });
      const num = h('input', { type: 'number', min: String(min), max: String(max), step: String((max - min) / 100) });
      const apply = (v: number): void => {
        if (!Number.isFinite(v)) return;
        const next = clamp(v, min, max);
        this.editSec(s => set(s, next));
        range.value = num.value = String(Number(next.toFixed(3)));
      };
      range.addEventListener('input', () => apply(Number(range.value)));
      num.addEventListener('input', () => apply(Number(num.value)));
      range.addEventListener('change', end);
      num.addEventListener('change', end);
      this.secRows.set(id, { range, num, get });
      return h('label', { class: 'field' }, h('span', {}, label), range, num);
    };
    const q = (k: keyof Qualifier) => (s: Secondary): number => s.qual[k] as number;
    const qs = (k: keyof Qualifier) => (s: Secondary, v: number): void => void ((s.qual[k] as number) = v);
    const w = (k: keyof PowerWindow) => (s: Secondary): number => s.win[k] as number;
    const ws = (k: keyof PowerWindow) => (s: Secondary, v: number): void => void ((s.win[k] as number) = v);

    [['none', 'None'], ['circle', 'Circle'], ['rect', 'Rectangle'], ['linear', 'Gradient']].forEach(([v, l]) => this.shape.append(h('option', { value: v }, l)));
    this.shape.addEventListener('change', () => this.editSec(s => {
      s.win.shape = this.shape.value as PowerWindow['shape'];
      s.enabled = true;
    }, true));
    const picker = button('Pick color', 'Click a color in the viewer to select it', () => {
      this.picking = !this.picking;
      picker.classList.toggle('active', this.picking);
      this.overlay.classList.toggle('picking', this.picking);
      if (this.picking) toast('Click the color you want to select in the viewer');
    }, 'btn small');

    return h(
      'div',
      { class: 'panel secondary' },
      h('div', { class: 'panel-head' }, h('span', {}, 'Qualifier & Power Window'), h('span', { class: 'head-tools' }, toggle('On', s => s.enabled, (s, v) => (s.enabled = v)), toggle('Show mask', s => s.showMask, (s, v) => (s.showMask = v)))),
      h(
        'div',
        { class: 'adjust-body' },
        h('h4', { class: 'sub' }, 'HSL Qualifier'),
        h('div', { class: 'btn-row' }, toggle('Use qualifier', s => s.qual.on, (s, v) => {
          s.qual.on = v;
          if (v) s.enabled = true;
        }), picker),
        slider('hue', 'Hue', 0, 360, q('hue'), qs('hue')),
        slider('hueWidth', 'Hue width', 0.01, 0.5, q('hueWidth'), qs('hueWidth')),
        slider('satLow', 'Sat low', 0, 1, q('satLow'), qs('satLow')),
        slider('satHigh', 'Sat high', 0, 1, q('satHigh'), qs('satHigh')),
        slider('lumLow', 'Lum low', 0, 1, q('lumLow'), qs('lumLow')),
        slider('lumHigh', 'Lum high', 0, 1, q('lumHigh'), qs('lumHigh')),
        slider('qsoft', 'Softness', 0.005, 0.3, q('soft'), qs('soft')),
        h('h4', { class: 'sub' }, 'Power Window'),
        h('label', { class: 'field two' }, h('span', {}, 'Shape'), this.shape),
        slider('wx', 'Center X', 0, 1, w('x'), ws('x')),
        slider('wy', 'Center Y', 0, 1, w('y'), ws('y')),
        slider('ww', 'Width', 0.02, 1, w('w'), ws('w')),
        slider('wh', 'Height', 0.02, 1, w('h'), ws('h')),
        slider('wrot', 'Rotation', -180, 180, w('rot'), ws('rot')),
        slider('wsoft', 'Softness', 0.005, 0.8, w('soft'), ws('soft')),
        h('div', { class: 'btn-row' }, toggle('Invert window', s => s.win.invert, (s, v) => (s.win.invert = v))),
        h('h4', { class: 'sub' }, 'Correction inside the selection'),
        slider('sexp', 'Exposure', -3, 3, s => s.exposure, (s, v) => (s.exposure = v)),
        slider('ssat', 'Saturation', 0, 2, s => s.saturation, (s, v) => (s.saturation = v)),
        slider('shue', 'Hue shift °', -180, 180, s => s.hue, (s, v) => (s.hue = v)),
        slider('stemp', 'Temperature', -1, 1, s => s.temperature, (s, v) => (s.temperature = v)),
        h('div', { class: 'grade-actions' }, button('Reset secondary', 'Remove the qualifier, window and inside correction', () => this.editClip(c => (c.secondary = undefined), true), 'btn small danger')),
      ),
    );
  }

  private clip(): Clip | undefined {
    const selected = store.ui.selected.map(id => store.clip(id)).find(c => c && c.kind !== 'audio');
    if (selected) return selected;
    const t = store.ui.playhead;
    const order = store.project.tracks.filter(tr => tr.kind === 'video' && !tr.hidden).map(tr => tr.id);
    for (const id of order) {
      const c = store.project.clips.find(x => x.trackId === id && t >= x.start && t < x.start + x.duration);
      if (c) return c;
    }
    return undefined;
  }

  private editClip(fn: (c: Clip) => void, once = false): void {
    const c = this.clip();
    if (!c) return;
    if (!this.editing) {
      store.checkpoint();
      this.editing = true;
    }
    const live = store.clip(c.id);
    if (!live) return;
    fn(live);
    store.emit('project');
    if (once) {
      this.editing = false;
      this.sync();
    }
  }

  private editSec(fn: (s: Secondary) => void, once = false): void {
    this.editClip(c => {
      const s = structuredClone(secondaryOf(c));
      fn(s);
      c.secondary = s;
    }, once);
    this.drawOverlay();
  }

  private setWheel(key: WheelKey, w: Wheel): void {
    this.editClip(c => (c.grade[key] = { ...w }));
  }

  private sync(): void {
    const c = this.clip();
    const off = !c;
    this.target.textContent = c ? `Grading: ${c.kind === 'text' ? 'Title' : c.name}` : 'No clip under the playhead';
    const g = c?.grade ?? defaultGrade();
    (Object.keys(this.wheels) as WheelKey[]).forEach(k => {
      this.wheels[k].set(g[k] ?? ZERO);
      this.wheels[k].disable(off);
    });
    this.look.value = c ? fxOf(c).look : 'none';
    this.look.disabled = off;
    const local = c ? localTime(c, store.ui.playhead) : 0;
    (Object.keys(this.sliders) as SliderKey[]).forEach(k => {
      const row = this.sliders[k];
      const keyed = !!c && !!row.kf && hasKeys(c, k as KeyProp);
      const v = c ? (keyed ? valueAt(c, k as KeyProp, local) : ((g as unknown as Record<string, number>)[k] ?? 0)) : (k === 'saturation' ? 1 : 0);
      row.range.value = row.num.value = String(Number(v.toFixed(3)));
      row.range.disabled = row.num.disabled = off;
      if (row.kf) {
        row.kf.classList.toggle('has', keyed);
        row.kf.classList.toggle('on', !!c && !!keyAt(c, k as KeyProp, local));
        row.kf.disabled = off;
      }
    });
    const sec = c ? secondaryOf(c) : defaultSecondary();
    this.secRows.forEach(r => {
      r.range.value = r.num.value = String(Number(r.get(sec).toFixed(3)));
      r.range.disabled = r.num.disabled = off;
    });
    this.secToggles.forEach(t => {
      t.el.checked = t.get(sec);
      t.el.disabled = off;
    });
    this.shape.value = sec.win.shape;
    this.shape.disabled = off;
    this.drawOverlay();
  }

  private overlayRect(): DOMRect {
    const stage = this.viewer.stage.getBoundingClientRect();
    const content = this.viewer.contentRect();
    return new DOMRect(content.left - stage.left, content.top - stage.top, content.width, content.height);
  }

  private drawOverlay(): void {
    if (!this.active) return;
    const stage = this.viewer.stage;
    const dpr = window.devicePixelRatio || 1;
    this.overlay.width = Math.round(stage.clientWidth * dpr);
    this.overlay.height = Math.round(stage.clientHeight * dpr);
    const ctx = this.overlay.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, stage.clientWidth, stage.clientHeight);
    const c = this.clip();
    if (!c) return;
    const s = secondaryOf(c);
    if (!s.enabled || s.win.shape === 'none') return;
    const r = this.overlayRect();
    const cx = r.x + s.win.x * r.width;
    const cy = r.y + s.win.y * r.height;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((-s.win.rot * Math.PI) / 180);
    ctx.strokeStyle = '#ffb347';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    const w = s.win.w * r.width;
    const hh = s.win.h * r.height;
    ctx.beginPath();
    if (s.win.shape === 'circle') ctx.ellipse(0, 0, w, hh, 0, 0, Math.PI * 2);
    else if (s.win.shape === 'rect') ctx.rect(-w, -hh, w * 2, hh * 2);
    else {
      ctx.moveTo(-r.width, 0);
      ctx.lineTo(r.width, 0);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffb347';
    ctx.fillRect(-4, -4, 8, 8);
    if (s.win.shape !== 'linear') ctx.fillRect(w - 5, hh - 5, 10, 10);
    ctx.restore();
  }

  private toUv(e: PointerEvent): [number, number] {
    const stage = this.viewer.stage.getBoundingClientRect();
    const r = this.overlayRect();
    return [(e.clientX - stage.left - r.x) / r.width, (e.clientY - stage.top - r.y) / r.height];
  }

  private onOverlayDown(e: PointerEvent): void {
    const c = this.clip();
    if (!c) return;
    const [u, v] = this.toUv(e);
    if (this.picking) {
      this.pickColor(u, v);
      return;
    }
    const s = secondaryOf(c);
    if (!s.enabled || s.win.shape === 'none') return;
    const r = this.overlayRect();
    const dxPx = (u - s.win.x) * r.width;
    const dyPx = (v - s.win.y) * r.height;
    const nearHandle = Math.abs(dxPx - s.win.w * r.width) < 12 && Math.abs(dyPx - s.win.h * r.height) < 12;
    this.dragMode = nearHandle && s.win.shape !== 'linear' ? 'size' : 'move';
    this.overlay.setPointerCapture(e.pointerId);
  }

  private onOverlayMove(e: PointerEvent): void {
    if (!this.dragMode) return;
    const [u, v] = this.toUv(e);
    if (this.dragMode === 'move') this.editSec(s => Object.assign(s.win, { x: clamp(u, 0, 1), y: clamp(v, 0, 1) }));
    else this.editSec(s => Object.assign(s.win, { w: clamp(Math.abs(u - s.win.x), 0.02, 1), h: clamp(Math.abs(v - s.win.y), 0.02, 1) }));
  }

  private pickColor(u: number, v: number): void {
    this.picking = false;
    this.overlay.classList.remove('picking');
    this.root.querySelectorAll('.secondary .btn.active').forEach(b => b.classList.remove('active'));
    const src = this.engine.canvas;
    const probe = h('canvas', { width: '1', height: '1' });
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    if (!ctx || u < 0 || u > 1 || v < 0 || v > 1) return;
    ctx.drawImage(src, Math.floor(u * src.width), Math.floor(v * src.height), 1, 1, 0, 0, 1, 1);
    const [r, g, b] = [...ctx.getImageData(0, 0, 1, 1).data].map(x => x / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let hue = 0;
    if (d > 0) hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue = ((hue * 60) + 360) % 360;
    const sat = max ? d / max : 0;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    this.editSec(s => {
      s.enabled = true;
      s.qual = { ...s.qual, on: true, hue, hueWidth: 0.06, satLow: Math.max(0, sat - 0.25), satHigh: Math.min(1, sat + 0.25), lumLow: Math.max(0, lum - 0.3), lumHigh: Math.min(1, lum + 0.3) };
    }, true);
    toast(`Selected hue ${Math.round(hue)}°. Adjust the correction below.`);
  }

  private renderStrip(): void {
    const videoTracks = new Set(store.project.tracks.filter(t => t.kind === 'video').map(t => t.id));
    const clips = store.project.clips.filter(c => videoTracks.has(c.trackId)).sort((a, b) => a.start - b.start);
    if (!clips.length) {
      this.strip.replaceChildren(h('div', { class: 'empty inline' }, 'Add video, image or title clips on the Edit page to grade them here.'));
      return;
    }
    const current = this.clip()?.id;
    this.strip.replaceChildren(
      ...clips.map((c, i) => {
        const rt = c.mediaId ? store.runtime.get(c.mediaId) : undefined;
        const thumb = h('div', { class: `strip-thumb ${c.kind}` });
        if (rt?.thumb) thumb.style.backgroundImage = `url(${rt.thumb})`;
        else if (c.kind === 'text') thumb.textContent = 'T';
        const node = h('button', { class: `strip-item${c.id === current ? ' sel' : ''}`, type: 'button', title: c.kind === 'text' ? 'Title' : c.name }, thumb, h('span', {}, `${String(i + 1).padStart(2, '0')}  ${timecode(c.start, store.project.fps)}`));
        node.addEventListener('click', () => {
          store.select([c.id]);
          store.setPlayhead(c.start + Math.min(c.duration / 2, 1));
        });
        return node;
      }),
    );
  }
}
