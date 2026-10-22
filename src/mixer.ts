import type { Engine } from './engine';
import { mixOf } from './looks';
import { store } from './state';
import type { Track, TrackMix } from './types';
import { button, h } from './util';

interface Strip {
  id: string;
  meter: HTMLCanvasElement;
  peak: number;
  hold: number;
}

const MIN_DB = -60;

export class Mixer {
  readonly root = h('div', { class: 'panel mixer hidden' });
  private readonly body = h('div', { class: 'mixer-body' });
  private strips: Strip[] = [];
  private editing = false;
  private raf = 0;

  constructor(private readonly engine: Engine) {
    this.root.append(h('div', { class: 'panel-head' }, h('span', {}, 'Mixer'), h('span', { class: 'hint' }, 'Faders, pan and EQ per audio track')), this.body);
    store.on(c => {
      if (c === 'project' && !this.editing && this.open) this.render();
    });
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  toggle(): boolean {
    this.root.classList.toggle('hidden');
    if (this.open) {
      this.render();
      this.loop();
    } else {
      cancelAnimationFrame(this.raf);
    }
    return this.open;
  }

  private begin(): void {
    if (this.editing) return;
    store.checkpoint();
    this.editing = true;
  }

  private end = (): void => {
    this.editing = false;
  };

  private setMix(track: Track, patch: Partial<TrackMix>): void {
    this.begin();
    const live = store.track(track.id);
    if (!live) return;
    live.mix = { ...mixOf(live), ...patch };
    this.engine.applyMix();
    store.emit('project');
  }

  private render(): void {
    const tracks = store.project.tracks.filter(t => t.kind === 'audio');
    this.strips = [];
    this.body.replaceChildren(...tracks.map(t => this.strip(t)), this.masterStrip());
  }

  private knob(label: string, min: number, max: number, value: number, onInput: (v: number) => void, fmt: (v: number) => string): HTMLElement {
    const range = h('input', { type: 'range', min: String(min), max: String(max), step: '0.1', value: String(value) });
    const out = h('span', { class: 'knob-val' }, fmt(value));
    range.addEventListener('input', () => {
      onInput(Number(range.value));
      out.textContent = fmt(Number(range.value));
    });
    range.addEventListener('change', this.end);
    range.addEventListener('dblclick', () => {
      range.value = '0';
      onInput(0);
      out.textContent = fmt(0);
      this.end();
    });
    return h('label', { class: 'knob', title: `${label} (double-click to reset)` }, h('span', {}, label), range, out);
  }

  private fader(value: number, onInput: (v: number) => void): HTMLElement {
    const range = h('input', { type: 'range', class: 'fader', min: String(MIN_DB), max: '12', step: '0.5', value: String(value) });
    const out = h('span', { class: 'db' }, `${value.toFixed(1)} dB`);
    range.addEventListener('input', () => {
      onInput(Number(range.value));
      out.textContent = `${Number(range.value).toFixed(1)} dB`;
    });
    range.addEventListener('change', this.end);
    range.addEventListener('dblclick', () => {
      range.value = '0';
      onInput(0);
      out.textContent = '0.0 dB';
      this.end();
    });
    return h('div', { class: 'fader-wrap', title: 'Volume (double-click for 0 dB)' }, range, out);
  }

  private meter(id: string): HTMLCanvasElement {
    const meter = h('canvas', { class: 'meter', width: '14', height: '160' });
    this.strips.push({ id, meter, peak: MIN_DB, hold: MIN_DB });
    return meter;
  }

  private strip(track: Track): HTMLElement {
    const m = mixOf(track);
    const toggle = (label: string, on: boolean, cls: string, fn: () => void): HTMLButtonElement => button(label, label === 'M' ? 'Mute' : 'Solo', fn, `ms ${cls}${on ? ' on' : ''}`);
    return h(
      'div',
      { class: 'strip-ch' },
      h('div', { class: 'ch-name' }, track.name),
      h(
        'div',
        { class: 'eq' },
        this.knob('High', -12, 12, m.high, v => this.setMix(track, { high: v }), v => `${v > 0 ? '+' : ''}${v.toFixed(0)}`),
        this.knob('Mid', -12, 12, m.mid, v => this.setMix(track, { mid: v }), v => `${v > 0 ? '+' : ''}${v.toFixed(0)}`),
        this.knob('Low', -12, 12, m.low, v => this.setMix(track, { low: v }), v => `${v > 0 ? '+' : ''}${v.toFixed(0)}`),
        this.knob('Pan', -1, 1, m.pan, v => this.setMix(track, { pan: v }), v => (Math.abs(v) < 0.05 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)),
      ),
      h(
        'div',
        { class: 'ms-row' },
        toggle('M', track.muted, 'mute', () => {
          store.checkpoint();
          track.muted = !track.muted;
          this.engine.applyMix();
          store.emit('project');
          this.render();
        }),
        toggle('S', m.solo, 'solo', () => {
          this.setMix(track, { solo: !m.solo });
          this.end();
          this.render();
        }),
      ),
      h('div', { class: 'fader-row' }, this.meter(track.id), this.fader(m.volume, v => this.setMix(track, { volume: v }))),
    );
  }

  private masterStrip(): HTMLElement {
    const value = store.project.masterVolume ?? 0;
    return h(
      'div',
      { class: 'strip-ch master' },
      h('div', { class: 'ch-name' }, 'Master'),
      h('div', { class: 'eq master-note' }, 'Everything you hear and render passes through the master.'),
      h(
        'div',
        { class: 'fader-row' },
        this.meter('master'),
        this.fader(value, v => {
          this.begin();
          store.project.masterVolume = v;
          this.engine.applyMix();
          store.emit('project');
        }),
      ),
    );
  }

  private loop = (): void => {
    const levels = this.engine.levels();
    const now = performance.now();
    for (const s of this.strips) {
      const level = Math.max(MIN_DB, levels[s.id] ?? MIN_DB);
      s.peak = level > s.peak ? level : Math.max(MIN_DB, s.peak - 1.2);
      if (level > s.hold || now % 1500 < 20) s.hold = level;
      this.drawMeter(s);
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private drawMeter(s: Strip): void {
    const ctx = s.meter.getContext('2d');
    if (!ctx) return;
    const { width: w, height: hgt } = s.meter;
    ctx.fillStyle = '#0d0d0f';
    ctx.fillRect(0, 0, w, hgt);
    const frac = (db: number): number => (db - MIN_DB) / -MIN_DB;
    const top = hgt * (1 - Math.min(1, frac(s.peak)));
    const grad = ctx.createLinearGradient(0, hgt, 0, 0);
    grad.addColorStop(0, '#2fbf71');
    grad.addColorStop(0.7, '#2fbf71');
    grad.addColorStop(0.85, '#f0c43a');
    grad.addColorStop(1, '#ef4f45');
    ctx.fillStyle = grad;
    ctx.fillRect(2, top, w - 4, hgt - top);
    const holdY = hgt * (1 - Math.min(1, frac(s.hold)));
    ctx.fillStyle = s.hold > -1 ? '#ef4f45' : '#e6e6ea';
    ctx.fillRect(2, holdY, w - 4, 2);
  }
}
