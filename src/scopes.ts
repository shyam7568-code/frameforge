import { h } from './util';

type Mode = 'waveform' | 'parade' | 'histogram' | 'vectorscope';

const W = 384;
const H = 216;
const SRC_W = 192;
const SRC_H = 108;

export class Scopes {
  readonly root = h('div', { class: 'panel scopes' });
  private readonly canvas = h('canvas', { class: 'scope-canvas', width: String(W), height: String(H) });
  private readonly mode = h('select', { class: 'select small' });
  private readonly work = h('canvas', { width: String(SRC_W), height: String(SRC_H) });
  private readonly workCtx = this.work.getContext('2d', { willReadFrequently: true });
  private readonly ctx = this.canvas.getContext('2d');
  private readonly image = new ImageData(W, H);
  private last = 0;

  constructor() {
    for (const [value, label] of [['waveform', 'Waveform'], ['parade', 'RGB Parade'], ['vectorscope', 'Vectorscope'], ['histogram', 'Histogram']]) this.mode.append(h('option', { value }, label));
    this.root.append(h('div', { class: 'panel-head' }, h('span', {}, 'Scopes'), this.mode), h('div', { class: 'scope-wrap' }, this.canvas));
  }

  update(source: HTMLCanvasElement, force = false): void {
    const now = performance.now();
    if (!force && now - this.last < 80) return;
    this.last = now;
    if (!this.workCtx || !this.ctx) return;
    this.workCtx.drawImage(source, 0, 0, SRC_W, SRC_H);
    const px = this.workCtx.getImageData(0, 0, SRC_W, SRC_H).data;
    const mode = this.mode.value as Mode;
    if (mode === 'histogram') this.histogram(px);
    else if (mode === 'vectorscope') this.vectorscope(px);
    else this.waveform(px, mode === 'parade');
  }

  private waveform(px: Uint8ClampedArray, parade: boolean): void {
    const acc = new Float32Array(W * H * 3);
    const lanes = parade ? 3 : 1;
    const laneW = W / lanes;
    for (let y = 0; y < SRC_H; y++) {
      for (let x = 0; x < SRC_W; x++) {
        const i = (y * SRC_W + x) * 4;
        const rgb = [px[i] / 255, px[i + 1] / 255, px[i + 2] / 255];
        if (parade) {
          for (let ch = 0; ch < 3; ch++) {
            const ox = Math.floor(ch * laneW + (x / SRC_W) * laneW);
            const oy = Math.floor((1 - rgb[ch]) * (H - 1));
            acc[(oy * W + ox) * 3 + ch] += 1;
          }
        } else {
          const l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
          const ox = Math.floor((x / SRC_W) * W);
          const oy = Math.floor((1 - l) * (H - 1));
          const k = (oy * W + ox) * 3;
          acc[k] += 0.7;
          acc[k + 1] += 1;
          acc[k + 2] += 0.75;
        }
      }
    }
    const d = this.image.data;
    for (let p = 0; p < W * H; p++) {
      d[p * 4] = Math.min(255, 14 + acc[p * 3] * 120);
      d[p * 4 + 1] = Math.min(255, 14 + acc[p * 3 + 1] * 120);
      d[p * 4 + 2] = Math.min(255, 16 + acc[p * 3 + 2] * 120);
      d[p * 4 + 3] = 255;
    }
    this.ctx!.putImageData(this.image, 0, 0);
    this.graticule(parade);
  }

  private vectorscope(px: Uint8ClampedArray): void {
    const ctx = this.ctx!;
    const cx = W / 2;
    const cy = H / 2;
    const radius = H / 2 - 8;
    const acc = new Float32Array(W * H * 3);
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i] / 255;
      const g = px[i + 1] / 255;
      const b = px[i + 2] / 255;
      const cb = -0.1146 * r - 0.3854 * g + 0.5 * b;
      const cr = 0.5 * r - 0.4542 * g - 0.0458 * b;
      const x = Math.round(cx + cb * 2 * radius);
      const y = Math.round(cy - cr * 2 * radius);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const k = (y * W + x) * 3;
      acc[k] += r;
      acc[k + 1] += g;
      acc[k + 2] += b;
    }
    const d = this.image.data;
    for (let p = 0; p < W * H; p++) {
      const n = acc[p * 3] + acc[p * 3 + 1] + acc[p * 3 + 2];
      const boost = n ? Math.min(255, 60 + n * 90) / Math.max(acc[p * 3], acc[p * 3 + 1], acc[p * 3 + 2], 0.001) : 0;
      d[p * 4] = n ? Math.min(255, acc[p * 3] * boost) : 12;
      d[p * 4 + 1] = n ? Math.min(255, acc[p * 3 + 1] * boost) : 12;
      d[p * 4 + 2] = n ? Math.min(255, acc[p * 3 + 2] * boost) : 14;
      d[p * 4 + 3] = 255;
    }
    ctx.putImageData(this.image, 0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.moveTo(cx - radius, cy);
    ctx.lineTo(cx + radius, cy);
    ctx.moveTo(cx, cy - radius);
    ctx.lineTo(cx, cy + radius);
    ctx.stroke();
    ctx.font = '9px system-ui, sans-serif';
    const targets: [string, number, number, number][] = [['R', 1, 0, 0], ['Mg', 1, 0, 1], ['B', 0, 0, 1], ['Cy', 0, 1, 1], ['G', 0, 1, 0], ['Yl', 1, 1, 0]];
    for (const [label, r, g, b] of targets) {
      const cb = (-0.1146 * r - 0.3854 * g + 0.5 * b) * 0.75;
      const cr = (0.5 * r - 0.4542 * g - 0.0458 * b) * 0.75;
      const x = cx + cb * 2 * radius;
      const y = cy - cr * 2 * radius;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.strokeRect(x - 5, y - 5, 10, 10);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText(label, x + 7, y + 3);
    }
    ctx.strokeStyle = 'rgba(255,200,150,0.35)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    const skin = (123 * Math.PI) / 180;
    ctx.lineTo(cx + Math.cos(skin) * radius, cy - Math.sin(skin) * radius);
    ctx.stroke();
  }

  private histogram(px: Uint8ClampedArray): void {
    const bins = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    for (let i = 0; i < px.length; i += 4) {
      bins[0][px[i]]++;
      bins[1][px[i + 1]]++;
      bins[2][px[i + 2]]++;
    }
    const ctx = this.ctx!;
    ctx.fillStyle = '#0e0e10';
    ctx.fillRect(0, 0, W, H);
    const max = Math.max(1, ...bins.flatMap(b => [...b].slice(2, 254)));
    ctx.globalCompositeOperation = 'lighter';
    ['rgba(255,70,70,0.75)', 'rgba(70,255,110,0.75)', 'rgba(80,140,255,0.75)'].forEach((color, ch) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let b = 0; b < 256; b++) ctx.lineTo((b / 255) * W, H - Math.min(1, bins[ch][b] / max) * (H - 6));
      ctx.lineTo(W, H);
      ctx.fill();
    });
    ctx.globalCompositeOperation = 'source-over';
  }

  private graticule(parade: boolean): void {
    const ctx = this.ctx!;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '9px system-ui, sans-serif';
    for (const level of [0, 25, 50, 75, 100]) {
      const y = Math.round((1 - level / 100) * (H - 1)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
      ctx.fillText(String(level), 3, Math.min(H - 3, Math.max(9, y - 2)));
    }
    if (parade) {
      for (const x of [W / 3, (2 * W) / 3]) {
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, H);
        ctx.stroke();
      }
    }
  }
}
