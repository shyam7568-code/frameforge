import { uid } from '../util';

export type Blend =
  | 'normal'
  | 'multiply'
  | 'darken'
  | 'color-burn'
  | 'linear-burn'
  | 'darker-color'
  | 'lighten'
  | 'screen'
  | 'color-dodge'
  | 'add'
  | 'lighter-color'
  | 'overlay'
  | 'soft-light'
  | 'hard-light'
  | 'vivid-light'
  | 'linear-light'
  | 'pin-light'
  | 'hard-mix'
  | 'difference'
  | 'exclusion'
  | 'subtract'
  | 'divide'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export const BLENDS: { id: Blend; label: string; short: string; group: string }[] = [
  { id: 'normal', label: 'Normal', short: 'N', group: 'Normal' },
  { id: 'multiply', label: 'Multiply', short: 'M', group: 'Darken' },
  { id: 'darken', label: 'Darken', short: 'Da', group: 'Darken' },
  { id: 'color-burn', label: 'Color Burn', short: 'Cb', group: 'Darken' },
  { id: 'linear-burn', label: 'Linear Burn', short: 'Lb', group: 'Darken' },
  { id: 'darker-color', label: 'Darker Color', short: 'Dc', group: 'Darken' },
  { id: 'lighten', label: 'Lighten', short: 'Li', group: 'Lighten' },
  { id: 'screen', label: 'Screen', short: 'S', group: 'Lighten' },
  { id: 'color-dodge', label: 'Color Dodge', short: 'Cd', group: 'Lighten' },
  { id: 'add', label: 'Add', short: 'A', group: 'Lighten' },
  { id: 'lighter-color', label: 'Lighter Color', short: 'Lc', group: 'Lighten' },
  { id: 'overlay', label: 'Overlay', short: 'O', group: 'Contrast' },
  { id: 'soft-light', label: 'Soft Light', short: 'Sl', group: 'Contrast' },
  { id: 'hard-light', label: 'Hard Light', short: 'Hl', group: 'Contrast' },
  { id: 'vivid-light', label: 'Vivid Light', short: 'Vl', group: 'Contrast' },
  { id: 'linear-light', label: 'Linear Light', short: 'Ll', group: 'Contrast' },
  { id: 'pin-light', label: 'Pin Light', short: 'Pl', group: 'Contrast' },
  { id: 'hard-mix', label: 'Hard Mix', short: 'Hm', group: 'Contrast' },
  { id: 'difference', label: 'Difference', short: 'Di', group: 'Difference' },
  { id: 'exclusion', label: 'Exclusion', short: 'E', group: 'Difference' },
  { id: 'subtract', label: 'Subtract', short: 'Su', group: 'Difference' },
  { id: 'divide', label: 'Divide', short: 'Dv', group: 'Difference' },
  { id: 'hue', label: 'Hue', short: 'H', group: 'Color' },
  { id: 'saturation', label: 'Saturation', short: 'Sa', group: 'Color' },
  { id: 'color', label: 'Color', short: 'C', group: 'Color' },
  { id: 'luminosity', label: 'Luminosity', short: 'L', group: 'Color' },
];

const NATIVE: Partial<Record<Blend, GlobalCompositeOperation>> = {
  normal: 'source-over',
  multiply: 'multiply',
  darken: 'darken',
  'color-burn': 'color-burn',
  lighten: 'lighten',
  screen: 'screen',
  'color-dodge': 'color-dodge',
  add: 'lighter',
  overlay: 'overlay',
  'soft-light': 'soft-light',
  'hard-light': 'hard-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
};

export const nativeBlend = (b: Blend): GlobalCompositeOperation | null => NATIVE[b] ?? null;

export interface TextProps {
  content: string;
  font: string;
  size: number;
  weight: number;
  italic: boolean;
  underline: boolean;
  align: 'left' | 'center' | 'right';
  tracking: number;
  leading: number;
  color: string;
  outline: number;
  outlineColor: string;
  x: number;
  y: number;
  rotation: number;
  scale: number;
}

export interface Layer {
  id: string;
  name: string;
  kind: 'paint' | 'text' | 'group';
  canvas: HTMLCanvasElement;
  visible: boolean;
  opacity: number;
  blend: Blend;
  locked: boolean;
  alphaLock: boolean;
  clip: boolean;
  reference: boolean;
  assist: boolean;
  mask: HTMLCanvasElement | null;
  maskOn: boolean;
  text?: TextProps;
  children?: Layer[];
  collapsed?: boolean;
  hold?: number;
}

export interface GuideSettings {
  type: 'none' | 'grid' | 'isometric' | 'perspective' | 'symmetry';
  size: number;
  color: string;
  opacity: number;
  thickness: number;
  cx: number;
  cy: number;
  rotation: number;
  symmetry: 'vertical' | 'horizontal' | 'quadrant' | 'radial';
  radial: number;
  rotational: boolean;
  points: { x: number; y: number }[];
}

export interface AnimSettings {
  on: boolean;
  fps: number;
  mode: 'loop' | 'pingpong' | 'once';
  onion: number;
  onionOpacity: number;
  blendPrimary: boolean;
  colorSecondary: boolean;
  background: boolean;
  foreground: boolean;
  current: number;
}

export interface ModelMeta {
  name: string;
  light: { az: number; el: number; intensity: number; ambient: number; wire: boolean };
}

export interface Doc {
  id: string;
  name: string;
  width: number;
  height: number;
  dpi: number;
  background: string;
  bgVisible: boolean;
  layers: Layer[];
  activeId: string;
  maskTarget: boolean;
  guides: GuideSettings;
  anim: AnimSettings;
  created: number;
  updated: number;
  strokes: number;
  seconds: number;
  model?: ModelMeta;
  mesh?: import('./mesh').Mesh;
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d');
  if (!g) throw new Error('Canvas 2D is not available.');
  return g;
}

export const defaultGuides = (w: number, h: number): GuideSettings => ({
  type: 'none',
  size: Math.round(Math.min(w, h) / 16),
  color: '#3d8bf0',
  opacity: 0.6,
  thickness: 1,
  cx: w / 2,
  cy: h / 2,
  rotation: 0,
  symmetry: 'vertical',
  radial: 6,
  rotational: false,
  points: [
    { x: w * 0.1, y: h * 0.45 },
    { x: w * 0.9, y: h * 0.45 },
    { x: w * 0.5, y: h * 1.6 },
  ],
});

export const defaultAnim = (): AnimSettings => ({
  on: false,
  fps: 12,
  mode: 'loop',
  onion: 2,
  onionOpacity: 0.35,
  blendPrimary: false,
  colorSecondary: true,
  background: false,
  foreground: false,
  current: 0,
});

export function newLayer(doc: { width: number; height: number }, name: string, kind: Layer['kind'] = 'paint'): Layer {
  return {
    id: uid(),
    name,
    kind,
    canvas: makeCanvas(kind === 'group' ? 1 : doc.width, kind === 'group' ? 1 : doc.height),
    visible: true,
    opacity: 1,
    blend: 'normal',
    locked: false,
    alphaLock: false,
    clip: false,
    reference: false,
    assist: false,
    mask: null,
    maskOn: true,
    children: kind === 'group' ? [] : undefined,
    collapsed: kind === 'group' ? false : undefined,
  };
}

export function newDoc(name: string, width: number, height: number, dpi = 132): Doc {
  const base = { width, height };
  const first = newLayer(base, 'Layer 1');
  return {
    id: uid(),
    name,
    width,
    height,
    dpi,
    background: '#ffffff',
    bgVisible: true,
    layers: [first],
    activeId: first.id,
    maskTarget: false,
    guides: defaultGuides(width, height),
    anim: defaultAnim(),
    created: Date.now(),
    updated: Date.now(),
    strokes: 0,
    seconds: 0,
  };
}

export function walk(layers: Layer[], fn: (l: Layer, parent: Layer[] | null, index: number) => void, parent: Layer[] | null = null): void {
  layers.forEach((l, i) => {
    fn(l, parent ?? layers, i);
    if (l.children) walk(l.children, fn, l.children);
  });
}

export function findLayer(layers: Layer[], id: string): { layer: Layer; list: Layer[]; index: number } | null {
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (l.id === id) return { layer: l, list: layers, index: i };
    if (l.children) {
      const r = findLayer(l.children, id);
      if (r) return r;
    }
  }
  return null;
}

export function allLayers(layers: Layer[]): Layer[] {
  const out: Layer[] = [];
  walk(layers, l => out.push(l));
  return out;
}

export function cloneTree(layers: Layer[]): Layer[] {
  return layers.map(l => ({ ...l, text: l.text && { ...l.text }, children: l.children && cloneTree(l.children) }));
}

export function renderText(layer: Layer, w: number, h: number): void {
  const t = layer.text;
  if (!t) return;
  if (layer.canvas.width !== w || layer.canvas.height !== h) {
    layer.canvas.width = w;
    layer.canvas.height = h;
  }
  const g = ctx2d(layer.canvas);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, w, h);
  g.translate(t.x, t.y);
  g.rotate((t.rotation * Math.PI) / 180);
  g.scale(t.scale, t.scale);
  g.font = `${t.italic ? 'italic ' : ''}${t.weight} ${t.size}px ${t.font}`;
  g.textAlign = t.align;
  g.textBaseline = 'top';
  const lines = t.content.split('\n');
  const lh = t.size * t.leading;
  const draw = (fn: (s: string, x: number, y: number) => void): void => {
    lines.forEach((line, i) => {
      const y = i * lh;
      if (!t.tracking) {
        fn(line, 0, y);
        return;
      }
      const chars = [...line];
      const widths = chars.map(ch => g.measureText(ch).width + t.tracking);
      const total = widths.reduce((a, b) => a + b, 0) - t.tracking;
      let x = t.align === 'left' ? 0 : t.align === 'center' ? -total / 2 : -total;
      const saved = g.textAlign;
      g.textAlign = 'left';
      chars.forEach((ch, k) => {
        fn(ch, x, y);
        x += widths[k];
      });
      g.textAlign = saved;
    });
  };
  if (t.outline > 0) {
    g.lineJoin = 'round';
    g.lineWidth = t.outline * 2;
    g.strokeStyle = t.outlineColor;
    draw((s, x, y) => g.strokeText(s, x, y));
  }
  g.fillStyle = t.color;
  draw((s, x, y) => g.fillText(s, x, y));
  if (t.underline) {
    lines.forEach((line, i) => {
      const w2 = g.measureText(line).width + t.tracking * Math.max(0, [...line].length - 1);
      const x = t.align === 'left' ? 0 : t.align === 'center' ? -w2 / 2 : -w2;
      g.fillRect(x, i * lh + t.size * 1.02, w2, Math.max(1, t.size / 16));
    });
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
}

export function textBounds(layer: Layer): { x: number; y: number; w: number; h: number } | null {
  const t = layer.text;
  if (!t) return null;
  const g = ctx2d(makeCanvas(1, 1));
  g.font = `${t.italic ? 'italic ' : ''}${t.weight} ${t.size}px ${t.font}`;
  const lines = t.content.split('\n');
  const w = Math.max(...lines.map(l => g.measureText(l).width + t.tracking * Math.max(0, [...l].length - 1)), t.size * 0.5);
  const hgt = lines.length * t.size * t.leading;
  const x = t.align === 'left' ? 0 : t.align === 'center' ? -w / 2 : -w;
  return { x: t.x + x * t.scale, y: t.y, w: w * t.scale, h: hgt * t.scale };
}
