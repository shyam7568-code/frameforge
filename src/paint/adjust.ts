import { ctx2d, makeCanvas } from './doc';
import { curveLut, filters, gradientLut, type Uniforms } from './filters';

export type AdjustKind =
  | 'hsb'
  | 'balance'
  | 'curves'
  | 'gradmap'
  | 'gaussian'
  | 'motion'
  | 'perspective'
  | 'noise'
  | 'sharpen'
  | 'bloom'
  | 'glitch'
  | 'halftone'
  | 'chroma'
  | 'invert'
  | 'liquify'
  | 'clone';

export interface Param {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  fmt?: (v: number) => string;
}

export const ADJUSTMENTS: { id: AdjustKind; label: string; group: string; pencil: boolean }[] = [
  { id: 'hsb', label: 'Hue, Saturation, Brightness', group: 'Color', pencil: true },
  { id: 'balance', label: 'Color Balance', group: 'Color', pencil: true },
  { id: 'curves', label: 'Curves', group: 'Color', pencil: true },
  { id: 'gradmap', label: 'Gradient Map', group: 'Color', pencil: true },
  { id: 'invert', label: 'Invert Colors', group: 'Color', pencil: true },
  { id: 'gaussian', label: 'Gaussian Blur', group: 'Blur', pencil: true },
  { id: 'motion', label: 'Motion Blur', group: 'Blur', pencil: true },
  { id: 'perspective', label: 'Perspective Blur', group: 'Blur', pencil: true },
  { id: 'noise', label: 'Noise', group: 'Effects', pencil: true },
  { id: 'sharpen', label: 'Sharpen', group: 'Effects', pencil: true },
  { id: 'bloom', label: 'Bloom', group: 'Effects', pencil: true },
  { id: 'glitch', label: 'Glitch', group: 'Effects', pencil: true },
  { id: 'halftone', label: 'Halftone', group: 'Effects', pencil: true },
  { id: 'chroma', label: 'Chromatic Aberration', group: 'Effects', pencil: true },
  { id: 'liquify', label: 'Liquify', group: 'Distort', pencil: false },
  { id: 'clone', label: 'Clone', group: 'Distort', pencil: false },
];

export const GRADIENTS: { name: string; stops: { at: number; color: string }[] }[] = [
  { name: 'Mystic', stops: [{ at: 0, color: '#1b0b3a' }, { at: 0.5, color: '#b23a8a' }, { at: 1, color: '#ffd59a' }] },
  { name: 'Noir', stops: [{ at: 0, color: '#000000' }, { at: 1, color: '#f4efe6' }] },
  { name: 'Sunset', stops: [{ at: 0, color: '#2a0f3d' }, { at: 0.45, color: '#e5533d' }, { at: 1, color: '#ffe08a' }] },
  { name: 'Ocean', stops: [{ at: 0, color: '#03102b' }, { at: 0.5, color: '#1a7fa8' }, { at: 1, color: '#d8fbff' }] },
  { name: 'Forest', stops: [{ at: 0, color: '#0b1a0c' }, { at: 0.5, color: '#4f8a3b' }, { at: 1, color: '#eef5c7' }] },
  { name: 'Sepia', stops: [{ at: 0, color: '#1e120a' }, { at: 0.6, color: '#a8784a' }, { at: 1, color: '#fff3dc' }] },
  { name: 'Neon', stops: [{ at: 0, color: '#120024' }, { at: 0.4, color: '#ff2fb5' }, { at: 0.7, color: '#28e7ff' }, { at: 1, color: '#ffffff' }] },
  { name: 'Thermal', stops: [{ at: 0, color: '#000033' }, { at: 0.3, color: '#7a00a8' }, { at: 0.6, color: '#ff4c00' }, { at: 1, color: '#ffff9a' }] },
];

export function adjustParams(kind: AdjustKind, w: number, h: number): Param[] {
  const pct = (v: number): string => `${Math.round(v)}%`;
  switch (kind) {
    case 'hsb':
      return [
        { key: 'hue', label: 'Hue', min: -180, max: 180, step: 1, value: 0, fmt: v => `${Math.round(v)}°` },
        { key: 'sat', label: 'Saturation', min: -100, max: 100, step: 1, value: 0, fmt: pct },
        { key: 'bri', label: 'Brightness', min: -100, max: 100, step: 1, value: 0, fmt: pct },
      ];
    case 'balance':
      return ['Shadows', 'Midtones', 'Highlights'].flatMap(t => [
        { key: `${t[0]}cr`, label: `${t} · Cyan ↔ Red`, min: -100, max: 100, step: 1, value: 0 },
        { key: `${t[0]}mg`, label: `${t} · Magenta ↔ Green`, min: -100, max: 100, step: 1, value: 0 },
        { key: `${t[0]}yb`, label: `${t} · Yellow ↔ Blue`, min: -100, max: 100, step: 1, value: 0 },
      ]);
    case 'gradmap':
      return [
        { key: 'preset', label: 'Gradient', min: 0, max: GRADIENTS.length - 1, step: 1, value: 0, fmt: v => GRADIENTS[Math.round(v)].name },
        { key: 'amount', label: 'Strength', min: 0, max: 100, step: 1, value: 100, fmt: pct },
      ];
    case 'gaussian':
      return [{ key: 'radius', label: 'Radius', min: 0, max: Math.round(Math.max(w, h) / 20), step: 0.5, value: 8, fmt: v => `${v.toFixed(1)} px` }];
    case 'motion':
      return [
        { key: 'distance', label: 'Distance', min: 0, max: Math.round(Math.max(w, h) / 10), step: 1, value: 30, fmt: v => `${Math.round(v)} px` },
        { key: 'angle', label: 'Angle', min: 0, max: 180, step: 1, value: 0, fmt: v => `${Math.round(v)}°` },
      ];
    case 'perspective':
      return [
        { key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, value: 25, fmt: pct },
        { key: 'cx', label: 'Center X', min: 0, max: 100, step: 1, value: 50, fmt: pct },
        { key: 'cy', label: 'Center Y', min: 0, max: 100, step: 1, value: 50, fmt: pct },
      ];
    case 'noise':
      return [
        { key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, value: 25, fmt: pct },
        { key: 'scale', label: 'Grain size', min: 1, max: 40, step: 0.5, value: 2 },
        { key: 'color', label: 'Colored noise', min: 0, max: 1, step: 1, value: 0, fmt: v => (v ? 'On' : 'Off') },
      ];
    case 'sharpen':
      return [{ key: 'amount', label: 'Amount', min: 0, max: 200, step: 1, value: 60, fmt: pct }];
    case 'bloom':
      return [
        { key: 'threshold', label: 'Transition', min: 0, max: 100, step: 1, value: 60, fmt: pct },
        { key: 'size', label: 'Size', min: 1, max: Math.round(Math.max(w, h) / 25), step: 1, value: 24, fmt: v => `${Math.round(v)} px` },
        { key: 'burn', label: 'Burn', min: 0, max: 300, step: 1, value: 120, fmt: pct },
      ];
    case 'glitch':
      return [
        { key: 'mode', label: 'Style', min: 0, max: 3, step: 1, value: 0, fmt: v => ['Artifact', 'Wave', 'Signal', 'Diverge'][Math.round(v)] },
        { key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, value: 40, fmt: pct },
        { key: 'block', label: 'Block size', min: 2, max: 200, step: 1, value: 32 },
        { key: 'seed', label: 'Variation', min: 0, max: 100, step: 1, value: 1 },
      ];
    case 'halftone':
      return [
        { key: 'mode', label: 'Style', min: 0, max: 2, step: 1, value: 0, fmt: v => ['Full color', 'Screen print', 'Newspaper'][Math.round(v)] },
        { key: 'size', label: 'Dot size', min: 3, max: 80, step: 1, value: 12, fmt: v => `${Math.round(v)} px` },
      ];
    case 'chroma':
      return [
        { key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, value: 30, fmt: pct },
        { key: 'cx', label: 'Center X', min: 0, max: 100, step: 1, value: 50, fmt: pct },
        { key: 'cy', label: 'Center Y', min: 0, max: 100, step: 1, value: 50, fmt: pct },
      ];
    case 'liquify':
      return [
        { key: 'mode', label: 'Mode', min: 0, max: 6, step: 1, value: 0, fmt: v => LIQUIFY_MODES[Math.round(v)] },
        { key: 'size', label: 'Size', min: 4, max: Math.round(Math.max(w, h) / 4), step: 1, value: Math.round(Math.max(w, h) / 16), fmt: v => `${Math.round(v)} px` },
        { key: 'pressure', label: 'Pressure', min: 1, max: 100, step: 1, value: 50, fmt: pct },
        { key: 'distortion', label: 'Distortion', min: 0, max: 100, step: 1, value: 0, fmt: pct },
        { key: 'momentum', label: 'Momentum', min: 0, max: 100, step: 1, value: 0, fmt: pct },
      ];
    default:
      return [];
  }
}

export const LIQUIFY_MODES = ['Push', 'Twirl right', 'Twirl left', 'Pinch', 'Expand', 'Crystals', 'Reconstruct'];

export interface CurveState {
  m: [number, number][];
  r: [number, number][];
  g: [number, number][];
  b: [number, number][];
}

export const defaultCurves = (): CurveState => ({
  m: [
    [0, 0],
    [1, 1],
  ],
  r: [
    [0, 0],
    [1, 1],
  ],
  g: [
    [0, 0],
    [1, 1],
  ],
  b: [
    [0, 0],
    [1, 1],
  ],
});

let lutTex: WebGLTexture | null = null;

export function runAdjust(kind: AdjustKind, src: HTMLCanvasElement, v: Record<string, number>, curves: CurveState): HTMLCanvasElement {
  const f = filters();
  const passes: { prog: string; uniforms?: Uniforms; input?: 'src' | 'prev' | number }[] = [];
  switch (kind) {
    case 'hsb':
      passes.push({ prog: 'hsb', uniforms: { uP: [v.hue / 360, 1 + v.sat / 100, v.bri / 100] } });
      break;
    case 'balance':
      passes.push({
        prog: 'balance',
        uniforms: {
          uS: [v.Scr / 100, v.Smg / 100, v.Syb / 100],
          uM: [v.Mcr / 100, v.Mmg / 100, v.Myb / 100],
          uH: [v.Hcr / 100, v.Hmg / 100, v.Hyb / 100],
        },
      });
      break;
    case 'curves':
      if (lutTex) f.release(lutTex);
      lutTex = f.lutTexture(curveLut(curves));
      passes.push({ prog: 'lut', uniforms: { uLut: lutTex } });
      break;
    case 'gradmap':
      if (lutTex) f.release(lutTex);
      lutTex = f.lutTexture(gradientLut(GRADIENTS[Math.round(v.preset)].stops));
      passes.push({ prog: 'gradmap', uniforms: { uLut: lutTex, uAmt: v.amount / 100 } });
      break;
    case 'invert':
      passes.push({ prog: 'invert' });
      break;
    case 'gaussian':
      passes.push(...f.blurPasses(v.radius));
      break;
    case 'motion': {
      const a = (v.angle * Math.PI) / 180;
      const sigma = v.distance / 2.5;
      let rem = sigma;
      while (rem > 0.3) {
        const s = Math.min(rem, 40);
        passes.push({ prog: 'blur', uniforms: { uDir: [Math.cos(a), Math.sin(a)], uSigma: s } });
        rem = Math.sqrt(Math.max(0, rem * rem - s * s));
      }
      if (!passes.length) passes.push({ prog: 'copy' });
      break;
    }
    case 'perspective':
      passes.push({ prog: 'zoomblur', uniforms: { uCenter: [v.cx / 100, 1 - v.cy / 100], uAmt: v.amount / 250 } });
      break;
    case 'noise':
      passes.push({ prog: 'noise', uniforms: { uP: [v.amount / 100, v.scale, v.color] } });
      break;
    case 'sharpen':
      passes.push({ prog: 'sharpen', uniforms: { uAmt: v.amount / 100 } });
      break;
    case 'bloom':
      passes.push({ prog: 'threshold', uniforms: { uT: v.threshold / 100 } }, ...f.blurPasses(v.size), { prog: 'add', uniforms: { uB: 'src', uAmt: v.burn / 100 } });
      break;
    case 'glitch':
      passes.push({ prog: 'glitch', uniforms: { uP: [v.mode, v.amount / 100, v.block, v.seed] } });
      break;
    case 'halftone':
      passes.push({ prog: 'halftone', uniforms: { uP: [v.mode, v.size] } });
      break;
    case 'chroma':
      passes.push({ prog: 'chroma', uniforms: { uP: [v.cx / 100, 1 - v.cy / 100, v.amount / 100] } });
      break;
    default:
      passes.push({ prog: 'copy' });
  }
  return f.run(src, passes);
}

export class Liquify {
  readonly gw: number;
  readonly gh: number;
  readonly field: Float32Array;
  private tex: WebGLTexture | null = null;
  private vel = { x: 0, y: 0 };
  private rand = 1;

  constructor(
    readonly src: HTMLCanvasElement,
    readonly target: HTMLCanvasElement,
  ) {
    const s = Math.min(1, 384 / Math.max(src.width, src.height));
    this.gw = Math.max(8, Math.round(src.width * s));
    this.gh = Math.max(8, Math.round(src.height * s));
    this.field = new Float32Array(this.gw * this.gh * 2);
  }

  apply(mode: number, x: number, y: number, dx: number, dy: number, size: number, pressure: number, distortion: number, momentum: number): void {
    const W = this.src.width;
    const H = this.src.height;
    const gx = (x / W) * this.gw;
    const gy = (y / H) * this.gh;
    const r = (size / W) * this.gw;
    const strength = (pressure / 100) * 0.35;
    if (momentum > 0) {
      this.vel.x = this.vel.x * (momentum / 110) + dx * (1 - momentum / 110);
      this.vel.y = this.vel.y * (momentum / 110) + dy * (1 - momentum / 110);
    } else this.vel = { x: dx, y: dy };
    const x0 = Math.max(0, Math.floor(gx - r));
    const x1 = Math.min(this.gw - 1, Math.ceil(gx + r));
    const y0 = Math.max(0, Math.floor(gy - r));
    const y1 = Math.min(this.gh - 1, Math.ceil(gy + r));
    const f = this.field;
    if (mode === 0) {
      const gw = this.gw;
      const src = new Float32Array(f);
      const sample = (x: number, y: number, c: number): number => {
        const cx = Math.min(gw - 1, Math.max(0, x));
        const cy = Math.min(this.gh - 1, Math.max(0, y));
        const ix = Math.floor(cx);
        const iy = Math.floor(cy);
        const tx = cx - ix;
        const ty = cy - iy;
        const at = (i: number, j: number): number => src[(Math.min(this.gh - 1, j) * gw + Math.min(gw - 1, i)) * 2 + c];
        return (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty;
      };
      const vx = this.vel.x / W;
      const vy = this.vel.y / H;
      const gx2 = vx * gw;
      const gy2 = vy * this.gh;
      for (let j = y0; j <= y1; j++)
        for (let i = x0; i <= x1; i++) {
          const d = Math.hypot(i - gx, j - gy) / r;
          if (d >= 1) continue;
          const w = Math.min(1, (1 - d * d) ** 2 * (pressure / 45));
          const k = (j * gw + i) * 2;
          const nx = sample(i - gx2, j - gy2, 0) - vx;
          const ny = sample(i - gx2, j - gy2, 1) - vy;
          f[k] += (nx - f[k]) * w;
          f[k + 1] += (ny - f[k + 1]) * w;
        }
      return;
    }
    for (let j = y0; j <= y1; j++)
      for (let i = x0; i <= x1; i++) {
        const ox = i - gx;
        const oy = j - gy;
        const d = Math.hypot(ox, oy) / r;
        if (d >= 1) continue;
        let w = (1 - d * d) ** 2 * strength;
        if (distortion > 0) {
          this.rand = (this.rand * 16807) % 2147483647;
          w *= 1 + ((this.rand / 2147483647) - 0.5) * (distortion / 50);
        }
        const k = (j * this.gw + i) * 2;
        const ux = 1 / this.gw;
        const uy = 1 / this.gh;
        switch (mode) {
          case 1:
          case 2: {
            const a = (mode === 1 ? 1 : -1) * w * 0.25;
            f[k] += -oy * a * ux;
            f[k + 1] += ox * a * uy;
            break;
          }
          case 3:
            f[k] += ox * w * 0.08 * ux;
            f[k + 1] += oy * w * 0.08 * uy;
            break;
          case 4:
            f[k] -= ox * w * 0.08 * ux;
            f[k + 1] -= oy * w * 0.08 * uy;
            break;
          case 5: {
            this.rand = (this.rand * 16807) % 2147483647;
            const a = (this.rand / 2147483647) * Math.PI * 2;
            f[k] += Math.cos(a) * w * 0.6 * r * ux * 0.2;
            f[k + 1] += Math.sin(a) * w * 0.6 * r * uy * 0.2;
            break;
          }
          default:
            f[k] *= 1 - w * 1.5;
            f[k + 1] *= 1 - w * 1.5;
        }
      }
  }

  render(): void {
    const fl = filters();
    this.tex = fl.dispTexture(this.field, this.gw, this.gh, this.tex ?? undefined);
    const out = fl.run(this.src, [{ prog: 'displace', uniforms: { uDisp: this.tex } }]);
    const g = ctx2d(this.target);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'copy';
    g.drawImage(out, 0, 0);
    g.restore();
  }

  reset(): void {
    this.field.fill(0);
  }

  dispose(): void {
    if (this.tex) filters().release(this.tex);
    this.tex = null;
  }
}

export function canvasCopy(c: HTMLCanvasElement): HTMLCanvasElement {
  const out = makeCanvas(c.width, c.height);
  ctx2d(out).drawImage(c, 0, 0);
  return out;
}
