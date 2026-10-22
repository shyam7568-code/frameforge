import { ctx2d, makeCanvas } from './doc';

export type Tip =
  | 'round'
  | 'pencil'
  | 'ink'
  | 'charcoal'
  | 'flat'
  | 'bristle'
  | 'square'
  | 'splatter'
  | 'spray'
  | 'leaf'
  | 'star'
  | 'hatch'
  | 'cloud'
  | 'sponge'
  | 'chalk'
  | 'dots'
  | 'grass'
  | 'rough'
  | 'heart'
  | 'snow';

export type Grain = 'none' | 'paper' | 'canvas' | 'rough' | 'charcoal' | 'watercolor' | 'grit' | 'hatching' | 'halftone' | 'wood';

export interface Brush {
  id: string;
  name: string;
  cat: string;
  tip: Tip;
  hardness: number;
  roundness: number;
  angle: number;
  follow: boolean;
  spacing: number;
  scatter: number;
  count: number;
  size: number;
  maxSize: number;
  minSize: number;
  opacity: number;
  flow: number;
  sizePressure: number;
  opacityPressure: number;
  sizeJitter: number;
  opacityJitter: number;
  angleJitter: number;
  hueJitter: number;
  satJitter: number;
  briJitter: number;
  taperStart: number;
  taperEnd: number;
  grain: Grain;
  grainScale: number;
  grainDepth: number;
  tiltSize: number;
  tiltOpacity: number;
  smoothing: number;
  wet: number;
  glow: boolean;
  speedSize: number;
  custom?: boolean;
}

export const TIPS: Tip[] = ['round', 'pencil', 'ink', 'charcoal', 'flat', 'bristle', 'square', 'splatter', 'spray', 'leaf', 'star', 'hatch', 'cloud', 'sponge', 'chalk', 'dots', 'grass', 'rough', 'heart', 'snow'];
export const GRAINS: Grain[] = ['none', 'paper', 'canvas', 'rough', 'charcoal', 'watercolor', 'grit', 'hatching', 'halftone', 'wood'];

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoise(size: number, cells: number, seed: number): Float32Array {
  const r = rng(seed);
  const grid = Array.from({ length: cells * cells }, () => r());
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * cells;
      const gy = (y / size) * cells;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const tx = gx - x0;
      const ty = gy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const at = (i: number, j: number): number => grid[((j + cells) % cells) * cells + ((i + cells) % cells)];
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      out[y * size + x] = a + (b - a) * sy;
    }
  }
  return out;
}

function fbm(size: number, base: number, octaves: number, seed: number): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(size, base << o, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

const TIP_SIZE = 128;
const tipCache = new Map<string, HTMLCanvasElement>();

function alphaCanvas(size: number, fn: (x: number, y: number) => number): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.max(0, Math.min(255, fn(x, y) * 255));
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function tipCanvas(tip: Tip, hardness: number): HTMLCanvasElement {
  const key = `${tip}:${hardness.toFixed(2)}`;
  const hit = tipCache.get(key);
  if (hit) return hit;
  const S = TIP_SIZE;
  const c0 = S / 2;
  const r = rng(tip.length * 977 + Math.round(hardness * 100));
  const noise = fbm(S, 8, 3, 7 + tip.length);
  const radial = (x: number, y: number): number => Math.hypot(x + 0.5 - c0, y + 0.5 - c0) / (S / 2);
  const soft = (d: number, h: number): number => {
    if (d >= 1) return 0;
    if (d <= h) return 1;
    const t = (d - h) / (1 - h);
    return 1 - t * t * (3 - 2 * t);
  };
  let c: HTMLCanvasElement;
  const draw = (fn: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement => {
    const cv = makeCanvas(S, S);
    const g = ctx2d(cv);
    g.fillStyle = '#fff';
    g.strokeStyle = '#fff';
    fn(g);
    return cv;
  };
  switch (tip) {
    case 'pencil':
      c = alphaCanvas(S, (x, y) => soft(radial(x, y), Math.min(0.85, hardness)) * (0.35 + 0.65 * (noise[y * S + x] > 0.42 ? 1 : noise[y * S + x])));
      break;
    case 'ink':
      c = alphaCanvas(S, (x, y) => soft(radial(x, y), 0.92));
      break;
    case 'charcoal':
      c = alphaCanvas(S, (x, y) => {
        const a = Math.atan2(y - c0, x - c0);
        const edge = 0.78 + 0.22 * noise[Math.floor(((a + Math.PI) / (2 * Math.PI)) * (S - 1))];
        return soft(radial(x, y) / edge, 0.5) * (0.3 + 0.7 * noise[y * S + x] ** 0.7);
      });
      break;
    case 'flat':
      c = alphaCanvas(S, (x, y) => soft(Math.hypot((x - c0) / (S / 2), (y - c0) / (S * 0.14)), hardness));
      break;
    case 'bristle':
      c = draw(g => {
        for (let i = 0; i < 26; i++) {
          const t = i / 25;
          const rr = 2 + r() * 4;
          g.globalAlpha = 0.45 + r() * 0.55;
          g.beginPath();
          g.arc(10 + t * (S - 20), c0 + (r() - 0.5) * 18, rr, 0, Math.PI * 2);
          g.fill();
        }
      });
      break;
    case 'square':
      c = alphaCanvas(S, (x, y) => Math.min(soft(Math.abs(x - c0) / (S / 2), Math.max(hardness, 0.6)), soft(Math.abs(y - c0) / (S / 2), Math.max(hardness, 0.6))));
      break;
    case 'splatter':
      c = draw(g => {
        for (let i = 0; i < 60; i++) {
          const a = r() * Math.PI * 2;
          const d = Math.sqrt(r()) * S * 0.45;
          g.globalAlpha = 0.6 + r() * 0.4;
          g.beginPath();
          g.arc(c0 + Math.cos(a) * d, c0 + Math.sin(a) * d, 0.8 + r() ** 3 * 9, 0, Math.PI * 2);
          g.fill();
        }
      });
      break;
    case 'spray':
      c = draw(g => {
        for (let i = 0; i < 900; i++) {
          const a = r() * Math.PI * 2;
          const d = Math.abs((r() + r() + r()) / 3 - 0.5) * 2 * S * 0.48;
          g.globalAlpha = 0.5 + r() * 0.5;
          g.fillRect(c0 + Math.cos(a) * d, c0 + Math.sin(a) * d, 1.3, 1.3);
        }
      });
      break;
    case 'leaf':
      c = draw(g => {
        g.beginPath();
        g.moveTo(c0, 6);
        g.quadraticCurveTo(S - 22, c0, c0, S - 6);
        g.quadraticCurveTo(22, c0, c0, 6);
        g.fill();
      });
      break;
    case 'star':
      c = draw(g => {
        g.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = (i * Math.PI) / 5 - Math.PI / 2;
          const d = i % 2 ? S * 0.2 : S * 0.48;
          g.lineTo(c0 + Math.cos(a) * d, c0 + Math.sin(a) * d);
        }
        g.closePath();
        g.fill();
      });
      break;
    case 'heart':
      c = draw(g => {
        g.beginPath();
        g.moveTo(c0, S * 0.86);
        g.bezierCurveTo(S * 0.04, S * 0.5, S * 0.2, S * 0.08, c0, S * 0.3);
        g.bezierCurveTo(S * 0.8, S * 0.08, S * 0.96, S * 0.5, c0, S * 0.86);
        g.fill();
      });
      break;
    case 'snow':
      c = draw(g => {
        g.lineWidth = 5;
        g.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3;
          g.beginPath();
          g.moveTo(c0, c0);
          g.lineTo(c0 + Math.cos(a) * S * 0.45, c0 + Math.sin(a) * S * 0.45);
          g.stroke();
        }
      });
      break;
    case 'hatch':
      c = draw(g => {
        g.lineWidth = 5;
        for (let i = -2; i <= 2; i++) {
          g.globalAlpha = 0.7 + r() * 0.3;
          g.beginPath();
          g.moveTo(10, c0 + i * 20 - 30);
          g.lineTo(S - 10, c0 + i * 20 + 30);
          g.stroke();
        }
      });
      break;
    case 'cloud':
      c = draw(g => {
        for (let i = 0; i < 9; i++) {
          const x = c0 + (r() - 0.5) * S * 0.5;
          const y = c0 + (r() - 0.5) * S * 0.4;
          const rr = S * (0.12 + r() * 0.16);
          const grad = g.createRadialGradient(x, y, 0, x, y, rr);
          grad.addColorStop(0, 'rgba(255,255,255,0.55)');
          grad.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = grad;
          g.fillRect(0, 0, S, S);
        }
      });
      break;
    case 'sponge':
      c = alphaCanvas(S, (x, y) => soft(radial(x, y), 0.55) * (noise[y * S + x] > 0.48 ? 1 : 0.1));
      break;
    case 'chalk':
      c = alphaCanvas(S, (x, y) => soft(radial(x, y), 0.6) * Math.min(1, Math.max(0, (noise[y * S + x] - 0.3) * 2.4)));
      break;
    case 'dots':
      c = alphaCanvas(S, (x, y) => {
        const cell = 16;
        const dx = (x % cell) - cell / 2;
        const dy = (y % cell) - cell / 2;
        return radial(x, y) < 1 ? (Math.hypot(dx, dy) < 5 ? 1 : 0) : 0;
      });
      break;
    case 'grass':
      c = draw(g => {
        g.lineCap = 'round';
        for (let i = 0; i < 14; i++) {
          const x = 14 + r() * (S - 28);
          g.lineWidth = 2 + r() * 3;
          g.globalAlpha = 0.6 + r() * 0.4;
          g.beginPath();
          g.moveTo(x, S - 6);
          g.quadraticCurveTo(x + (r() - 0.5) * 30, c0, x + (r() - 0.5) * 40, 8 + r() * 40);
          g.stroke();
        }
      });
      break;
    case 'rough':
      c = alphaCanvas(S, (x, y) => {
        const a = Math.atan2(y - c0, x - c0);
        const edge = 0.7 + 0.3 * noise[Math.floor(((a + Math.PI) / (2 * Math.PI)) * (S - 1)) * 7 % (S * S)];
        return soft(radial(x, y) / edge, 0.85);
      });
      break;
    default:
      c = alphaCanvas(S, (x, y) => soft(radial(x, y), hardness));
  }
  tipCache.set(key, c);
  return c;
}

const grainCache = new Map<string, HTMLCanvasElement>();

export function grainCanvas(grain: Grain): HTMLCanvasElement | null {
  if (grain === 'none') return null;
  const hit = grainCache.get(grain);
  if (hit) return hit;
  const S = 256;
  const r = rng(grain.length * 31);
  let field: Float32Array;
  switch (grain) {
    case 'paper':
      field = fbm(S, 32, 3, 11);
      break;
    case 'rough':
      field = fbm(S, 8, 4, 13);
      break;
    case 'charcoal': {
      field = new Float32Array(S * S);
      const n = fbm(S, 16, 3, 17);
      for (let y = 0; y < S; y++) {
        const row = r();
        for (let x = 0; x < S; x++) field[y * S + x] = n[y * S + x] * 0.6 + row * 0.4;
      }
      break;
    }
    case 'watercolor':
      field = fbm(S, 4, 5, 19);
      break;
    case 'grit': {
      field = new Float32Array(S * S);
      for (let i = 0; i < field.length; i++) field[i] = r() > 0.35 ? 1 : r() * 0.4;
      break;
    }
    case 'canvas': {
      field = new Float32Array(S * S);
      const n = fbm(S, 64, 2, 23);
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
          const wx = 0.5 + 0.5 * Math.sin((x / S) * Math.PI * 2 * 32);
          const wy = 0.5 + 0.5 * Math.sin((y / S) * Math.PI * 2 * 32);
          field[y * S + x] = Math.max(wx, wy) * 0.7 + n[y * S + x] * 0.3;
        }
      break;
    }
    case 'hatching': {
      field = new Float32Array(S * S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) field[y * S + x] = ((x + y) % 16) < 6 ? 1 : 0.15;
      break;
    }
    case 'halftone': {
      field = new Float32Array(S * S);
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
          const dx = (x % 16) - 8;
          const dy = (y % 16) - 8;
          field[y * S + x] = Math.hypot(dx, dy) < 6 ? 1 : 0.1;
        }
      break;
    }
    default: {
      field = new Float32Array(S * S);
      const n = fbm(S, 8, 3, 29);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) field[y * S + x] = 0.5 + 0.5 * Math.sin(y * 0.35 + n[y * S + x] * 12);
    }
  }
  let min = Infinity;
  let max = -Infinity;
  for (const v of field) {
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  const c = alphaCanvas(S, (x, y) => (field[y * S + x] - min) / (max - min || 1));
  grainCache.set(grain, c);
  return c;
}

const DEFAULT: Omit<Brush, 'id' | 'name' | 'cat' | 'tip'> = {
  hardness: 0.85,
  roundness: 1,
  angle: 0,
  follow: false,
  spacing: 0.12,
  scatter: 0,
  count: 1,
  size: 14,
  maxSize: 400,
  minSize: 0.15,
  opacity: 1,
  flow: 1,
  sizePressure: 0.8,
  opacityPressure: 0.2,
  sizeJitter: 0,
  opacityJitter: 0,
  angleJitter: 0,
  hueJitter: 0,
  satJitter: 0,
  briJitter: 0,
  taperStart: 0,
  taperEnd: 0,
  grain: 'none',
  grainScale: 1,
  grainDepth: 0.6,
  tiltSize: 0,
  tiltOpacity: 0,
  smoothing: 0.35,
  wet: 0,
  glow: false,
  speedSize: 0,
};

const make = (cat: string, name: string, tip: Tip, o: Partial<Brush> = {}): Brush => ({ ...DEFAULT, id: `${cat}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, cat, tip, ...o });

export const BRUSH_CATEGORIES = ['Sketch', 'Ink', 'Draw', 'Paint', 'Art', 'Airbrush', 'Texture', 'Charcoal', 'Nature', 'Calligraphy', 'Glow', 'Industrial', 'Water', 'Retouch', 'Spray'];

export const LIBRARY: Brush[] = [
  make('Sketch', 'HB Graphite', 'pencil', { size: 5, grain: 'paper', grainDepth: 0.5, opacityPressure: 0.7, sizePressure: 0.4, tiltSize: 0.8, tiltOpacity: 0.5, spacing: 0.08 }),
  make('Sketch', '6B Graphite', 'pencil', { size: 10, grain: 'paper', grainDepth: 0.65, opacityPressure: 0.8, sizePressure: 0.5, tiltSize: 1, tiltOpacity: 0.6, spacing: 0.08 }),
  make('Sketch', 'Fine Liner Sketch', 'round', { size: 3, hardness: 0.9, opacityPressure: 0.6, sizePressure: 0.3 }),
  make('Sketch', 'Soft Sketch', 'pencil', { size: 16, grain: 'rough', grainDepth: 0.55, opacity: 0.8, opacityPressure: 0.9, tiltSize: 1 }),
  make('Sketch', 'Blue Line', 'round', { size: 6, hardness: 0.6, opacity: 0.7, opacityPressure: 0.8 }),
  make('Sketch', 'Mechanical', 'pencil', { size: 3, grain: 'paper', grainDepth: 0.3, sizePressure: 0.1, opacityPressure: 0.6 }),
  make('Sketch', 'Shading Pencil', 'pencil', { size: 28, grain: 'paper', grainDepth: 0.75, opacity: 0.6, sizePressure: 0.2, opacityPressure: 1, tiltSize: 1.4, tiltOpacity: 0.8 }),
  make('Ink', 'Studio Pen', 'ink', { size: 8, sizePressure: 0.95, opacityPressure: 0, taperStart: 0.15, taperEnd: 0.2, smoothing: 0.5, spacing: 0.06 }),
  make('Ink', 'Technical Pen', 'ink', { size: 5, sizePressure: 0.1, opacityPressure: 0, smoothing: 0.5, spacing: 0.06 }),
  make('Ink', 'Brush Pen', 'ink', { size: 14, sizePressure: 1, minSize: 0.05, taperStart: 0.25, taperEnd: 0.35, smoothing: 0.55, spacing: 0.05 }),
  make('Ink', 'Dry Ink', 'rough', { size: 12, grain: 'grit', grainDepth: 0.45, sizePressure: 0.8, taperEnd: 0.2 }),
  make('Ink', 'Marker', 'square', { size: 18, hardness: 0.9, opacity: 0.75, sizePressure: 0.1, roundness: 0.55, angle: 35, spacing: 0.05 }),
  make('Ink', 'Gel Pen', 'ink', { size: 4, sizePressure: 0.3, smoothing: 0.4 }),
  make('Ink', 'Felt Tip', 'round', { size: 10, hardness: 0.7, opacity: 0.9, sizePressure: 0.25, grain: 'paper', grainDepth: 0.25 }),
  make('Ink', 'Inking Nib', 'flat', { size: 16, hardness: 0.95, follow: true, sizePressure: 0.9, taperStart: 0.2, taperEnd: 0.2, spacing: 0.04 }),
  make('Draw', 'Crayon', 'chalk', { size: 18, grain: 'rough', grainDepth: 0.7, opacityPressure: 0.6, tiltSize: 0.6 }),
  make('Draw', 'Oil Pastel', 'chalk', { size: 30, grain: 'canvas', grainDepth: 0.55, opacityPressure: 0.4, wet: 0.15 }),
  make('Draw', 'Colored Pencil', 'pencil', { size: 7, grain: 'paper', grainDepth: 0.6, opacityPressure: 0.8, tiltSize: 0.8 }),
  make('Draw', 'Conté', 'square', { size: 16, grain: 'paper', grainDepth: 0.65, roundness: 0.5, follow: true, opacityPressure: 0.7 }),
  make('Draw', 'Monoline', 'ink', { size: 10, sizePressure: 0, opacityPressure: 0, smoothing: 0.6, spacing: 0.05 }),
  make('Draw', 'Bonobo Chalk', 'chalk', { size: 40, grain: 'rough', grainDepth: 0.8, opacity: 0.85 }),
  make('Paint', 'Round Brush', 'round', { size: 30, hardness: 0.8, wet: 0.35, opacityPressure: 0.6 }),
  make('Paint', 'Flat Brush', 'bristle', { size: 40, follow: true, wet: 0.4, spacing: 0.06, opacityPressure: 0.5 }),
  make('Paint', 'Gouache', 'round', { size: 36, hardness: 0.6, grain: 'paper', grainDepth: 0.35, wet: 0.25, opacity: 0.9 }),
  make('Paint', 'Oil Paint', 'bristle', { size: 50, follow: true, grain: 'canvas', grainDepth: 0.4, wet: 0.6, spacing: 0.05 }),
  make('Paint', 'Acrylic', 'rough', { size: 34, wet: 0.3, grain: 'canvas', grainDepth: 0.3 }),
  make('Paint', 'Wet Blend', 'round', { size: 44, hardness: 0.3, wet: 0.85, opacity: 0.8, flow: 0.7 }),
  make('Paint', 'Impasto', 'bristle', { size: 46, follow: true, wet: 0.5, briJitter: 0.05, spacing: 0.05 }),
  make('Paint', 'Dry Brush', 'bristle', { size: 40, follow: true, grain: 'rough', grainDepth: 0.7, opacityPressure: 0.8 }),
  make('Paint', 'Palette Knife', 'flat', { size: 50, follow: true, hardness: 0.95, wet: 0.7, spacing: 0.04 }),
  make('Art', 'Watercolor Wash', 'cloud', { size: 80, opacity: 0.5, flow: 0.4, grain: 'watercolor', grainDepth: 0.5, wet: 0.4, spacing: 0.1 }),
  make('Art', 'Stippling', 'dots', { size: 40, spacing: 0.6, scatter: 0.4, sizeJitter: 0.4 }),
  make('Art', 'Hatching', 'hatch', { size: 40, spacing: 0.35, follow: false, angle: 0 }),
  make('Art', 'Halftone', 'round', { size: 60, grain: 'halftone', grainDepth: 1, hardness: 0.5 }),
  make('Art', 'Sumi', 'ink', { size: 24, grain: 'rough', grainDepth: 0.35, sizePressure: 1, taperStart: 0.3, taperEnd: 0.5, wet: 0.1 }),
  make('Art', 'Pointillism', 'round', { size: 14, spacing: 1.4, scatter: 1.2, count: 2, sizeJitter: 0.5, hueJitter: 0.06, briJitter: 0.1 }),
  make('Art', 'Scribble', 'pencil', { size: 6, scatter: 0.6, spacing: 0.2, angleJitter: 1 }),
  make('Airbrush', 'Soft Airbrush', 'round', { size: 90, hardness: 0, opacity: 0.6, flow: 0.25, sizePressure: 0.2, opacityPressure: 0.8, spacing: 0.06 }),
  make('Airbrush', 'Medium Airbrush', 'round', { size: 60, hardness: 0.35, flow: 0.4, opacityPressure: 0.8, spacing: 0.06 }),
  make('Airbrush', 'Hard Airbrush', 'round', { size: 40, hardness: 0.85, flow: 0.6, opacityPressure: 0.5 }),
  make('Airbrush', 'Spray Can', 'spray', { size: 70, flow: 0.5, opacityPressure: 0.6, spacing: 0.08 }),
  make('Airbrush', 'Gradient Blender', 'round', { size: 120, hardness: 0, opacity: 0.4, flow: 0.15, wet: 0.6, spacing: 0.05 }),
  make('Texture', 'Grid Paper', 'square', { size: 60, grain: 'hatching', grainDepth: 0.9, sizePressure: 0 }),
  make('Texture', 'Sponge', 'sponge', { size: 60, spacing: 0.35, scatter: 0.3, angleJitter: 1, sizeJitter: 0.2 }),
  make('Texture', 'Canvas Weave', 'round', { size: 70, hardness: 0.4, grain: 'canvas', grainDepth: 0.85 }),
  make('Texture', 'Grit', 'round', { size: 60, hardness: 0.5, grain: 'grit', grainDepth: 0.9 }),
  make('Texture', 'Wood Grain', 'round', { size: 80, hardness: 0.5, grain: 'wood', grainDepth: 0.8 }),
  make('Texture', 'Concrete', 'rough', { size: 70, grain: 'rough', grainDepth: 0.85, sizeJitter: 0.2 }),
  make('Charcoal', 'Vine Charcoal', 'charcoal', { size: 22, grain: 'charcoal', grainDepth: 0.6, opacityPressure: 0.7, tiltSize: 1 }),
  make('Charcoal', 'Compressed', 'charcoal', { size: 30, grain: 'charcoal', grainDepth: 0.45, opacityPressure: 0.5 }),
  make('Charcoal', 'Willow', 'charcoal', { size: 16, grain: 'paper', grainDepth: 0.7, opacity: 0.8, opacityPressure: 0.9 }),
  make('Charcoal', 'Burnt Stick', 'rough', { size: 26, grain: 'charcoal', grainDepth: 0.75, angleJitter: 0.3 }),
  make('Charcoal', 'Smudged Charcoal', 'charcoal', { size: 40, grain: 'charcoal', grainDepth: 0.5, wet: 0.5, opacity: 0.7 }),
  make('Nature', 'Foliage', 'leaf', { size: 40, spacing: 0.45, scatter: 0.7, angleJitter: 1, sizeJitter: 0.4, hueJitter: 0.04, briJitter: 0.15, count: 2 }),
  make('Nature', 'Grass', 'grass', { size: 60, spacing: 0.3, scatter: 0.3, sizeJitter: 0.4, briJitter: 0.1, sizePressure: 0.4 }),
  make('Nature', 'Clouds', 'cloud', { size: 140, spacing: 0.25, scatter: 0.3, opacity: 0.8, flow: 0.6, angleJitter: 1, sizeJitter: 0.3 }),
  make('Nature', 'Stars', 'star', { size: 22, spacing: 1.6, scatter: 2, sizeJitter: 0.8, angleJitter: 1, opacityJitter: 0.5 }),
  make('Nature', 'Snowflakes', 'snow', { size: 26, spacing: 1.5, scatter: 2, sizeJitter: 0.7, angleJitter: 1, opacityJitter: 0.4 }),
  make('Nature', 'Rain', 'flat', { size: 30, roundness: 0.08, angle: 75, spacing: 1.2, scatter: 2.5, sizeJitter: 0.5, opacityJitter: 0.6, count: 3 }),
  make('Nature', 'Bark', 'rough', { size: 40, grain: 'wood', grainDepth: 0.7, follow: true, roundness: 0.5 }),
  make('Nature', 'Petals', 'heart', { size: 26, spacing: 1.2, scatter: 1.6, angleJitter: 1, sizeJitter: 0.5, hueJitter: 0.05 }),
  make('Calligraphy', 'Chisel', 'flat', { size: 24, angle: 45, roundness: 0.18, hardness: 0.95, sizePressure: 0.4, spacing: 0.03, smoothing: 0.55 }),
  make('Calligraphy', 'Brush Script', 'ink', { size: 22, sizePressure: 1, minSize: 0.08, taperStart: 0.2, taperEnd: 0.3, smoothing: 0.65, spacing: 0.04 }),
  make('Calligraphy', 'Monoline Script', 'ink', { size: 12, sizePressure: 0, opacityPressure: 0, smoothing: 0.7, spacing: 0.04 }),
  make('Calligraphy', 'Italic Nib', 'flat', { size: 20, angle: 30, roundness: 0.15, hardness: 1, sizePressure: 0.3, spacing: 0.03, smoothing: 0.6 }),
  make('Calligraphy', 'Chalk Lettering', 'chalk', { size: 20, grain: 'rough', grainDepth: 0.6, sizePressure: 0.6, smoothing: 0.6 }),
  make('Glow', 'Light Pen', 'ink', { size: 8, glow: true, sizePressure: 0.5, smoothing: 0.5 }),
  make('Glow', 'Neon', 'round', { size: 14, hardness: 0.9, glow: true, sizePressure: 0.2 }),
  make('Glow', 'Bokeh', 'round', { size: 60, hardness: 0.75, glow: true, spacing: 1.5, scatter: 1.5, sizeJitter: 0.7, opacity: 0.6, opacityJitter: 0.5 }),
  make('Glow', 'Flare', 'round', { size: 120, hardness: 0, glow: true, opacity: 0.5, flow: 0.3, spacing: 0.1 }),
  make('Glow', 'Sparkle', 'star', { size: 30, glow: true, spacing: 1.5, scatter: 1.8, sizeJitter: 0.8, angleJitter: 1 }),
  make('Industrial', 'Rusted Metal', 'sponge', { size: 70, grain: 'rough', grainDepth: 0.8, spacing: 0.3, angleJitter: 1, briJitter: 0.15 }),
  make('Industrial', 'Scratches', 'hatch', { size: 50, spacing: 0.8, scatter: 0.8, angleJitter: 0.3, opacityJitter: 0.6 }),
  make('Industrial', 'Spatter', 'splatter', { size: 60, spacing: 0.9, scatter: 0.8, angleJitter: 1, sizeJitter: 0.4 }),
  make('Industrial', 'Stencil', 'square', { size: 40, hardness: 1, sizePressure: 0, grain: 'grit', grainDepth: 0.3 }),
  make('Water', 'Wet Edges', 'round', { size: 70, hardness: 0.15, wet: 0.7, opacity: 0.55, flow: 0.5, grain: 'watercolor', grainDepth: 0.4 }),
  make('Water', 'Bleed', 'cloud', { size: 100, wet: 0.8, opacity: 0.4, flow: 0.35, grain: 'watercolor', grainDepth: 0.6 }),
  make('Water', 'Water Pen', 'round', { size: 18, hardness: 0.4, wet: 0.9, opacity: 0.6 }),
  make('Water', 'Salt', 'splatter', { size: 50, spacing: 0.7, scatter: 0.6, opacity: 0.4, angleJitter: 1 }),
  make('Retouch', 'Soft Blender', 'round', { size: 50, hardness: 0.1, wet: 1, opacity: 0.6, flow: 0.4 }),
  make('Retouch', 'Hard Blender', 'round', { size: 30, hardness: 0.8, wet: 1, opacity: 0.8 }),
  make('Retouch', 'Noise Fix', 'round', { size: 40, hardness: 0.2, grain: 'paper', grainDepth: 0.3, opacity: 0.5 }),
  make('Retouch', 'Smooth Skin', 'round', { size: 60, hardness: 0, wet: 0.9, opacity: 0.4, flow: 0.3 }),
  make('Spray', 'Fine Mist', 'spray', { size: 50, flow: 0.25, opacity: 0.7 }),
  make('Spray', 'Drips', 'splatter', { size: 30, spacing: 1, scatter: 0.4, sizeJitter: 0.6 }),
  make('Spray', 'Fat Cap', 'spray', { size: 110, flow: 0.6 }),
  make('Spray', 'Skinny Cap', 'spray', { size: 26, flow: 0.7 }),
];

export const ERASER_DEFAULT = 'airbrush-hard-airbrush';
export const SMUDGE_DEFAULT = 'paint-wet-blend';

const STORE_KEY = 'frameforge-paint:brushes';

export function loadCustomBrushes(): Brush[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Brush[]) : [];
  } catch {
    return [];
  }
}

export function saveCustomBrushes(list: Brush[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

export function previewBrush(b: Brush, w: number, h: number, color = '#ffffff'): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const g = ctx2d(c);
  const tip = tipCanvas(b.tip, b.hardness);
  const base = Math.min(h * 0.38, Math.max(3, b.size * 0.6));
  const steps = Math.max(60, Math.round(w / Math.max(0.6, base * Math.min(b.spacing, 0.5))));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = 8 + t * (w - 16);
    const y = h / 2 + Math.sin(t * Math.PI * 2) * h * 0.18;
    const p = Math.sin(t * Math.PI);
    const size = base * (1 - b.sizePressure + b.sizePressure * p);
    g.globalAlpha = Math.min(1, b.opacity * (1 - b.opacityPressure + b.opacityPressure * p) * b.flow + 0.15);
    g.save();
    g.translate(x, y);
    g.rotate(((b.angle + (b.follow ? Math.cos(t * Math.PI * 2) * 40 : 0)) * Math.PI) / 180);
    g.scale(1, b.roundness);
    g.drawImage(tip, -size / 2, -size / 2, size, size);
    g.restore();
  }
  g.globalCompositeOperation = 'source-in';
  g.globalAlpha = 1;
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  return c;
}
