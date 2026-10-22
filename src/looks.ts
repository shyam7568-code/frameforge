import type { AiSettings, Cutout, StyleId, Animation, BlendMode, Clip, Crop, Effects, Secondary, Track, TrackMix } from './types';

export const LOOKS: { id: string; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'bw', label: 'Black & White' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'vintage', label: 'Vintage' },
  { id: 'vivid', label: 'Vivid' },
  { id: 'cool', label: 'Cool' },
  { id: 'warm', label: 'Warm' },
  { id: 'noir', label: 'Noir' },
  { id: 'faded', label: 'Faded' },
  { id: 'cyberpunk', label: 'Cyberpunk' },
  { id: 'invert', label: 'Invert' },
  { id: 'golden', label: 'Golden Hour' },
];

export const lookIndex = (id: string): number => Math.max(0, LOOKS.findIndex(l => l.id === id));

export const GLSL_LOOKS = `
vec3 applyLook(int look, vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  if (look == 1) return vec3(l);
  if (look == 2) return vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131)));
  if (look == 3) return (c - 0.5) * 1.1 + 0.5 + vec3(0.0, 0.08, 0.1) * (1.0 - l) + vec3(0.1, 0.04, -0.06) * l;
  if (look == 4) return mix(vec3(l), c * 0.85 + 0.08 + vec3(0.06, 0.02, -0.05), 0.75);
  if (look == 5) return mix(vec3(l), (c - 0.5) * 1.12 + 0.5, 1.45);
  if (look == 6) return c + vec3(-0.05, 0.0, 0.08);
  if (look == 7) return c + vec3(0.08, 0.03, -0.06);
  if (look == 8) return vec3(smoothstep(0.1, 0.9, l));
  if (look == 9) return mix(vec3(l), c * 0.8 + 0.12, 0.85);
  if (look == 10) return vec3(c.r * 1.1 + 0.05 * l, c.g * 0.85, c.b * 1.25 + 0.05);
  if (look == 11) return 1.0 - c;
  if (look == 12) return mix(vec3(l), c * vec3(1.08, 1.0, 0.82), 1.15);
  return c;
}`;

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function lookRGB(look: number, r: number, g: number, b: number): [number, number, number] {
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  switch (look) {
    case 1:
      return [l, l, l];
    case 2:
      return [0.393 * r + 0.769 * g + 0.189 * b, 0.349 * r + 0.686 * g + 0.168 * b, 0.272 * r + 0.534 * g + 0.131 * b];
    case 3:
      return [(r - 0.5) * 1.1 + 0.5 + 0.1 * l, (g - 0.5) * 1.1 + 0.5 + 0.08 * (1 - l) + 0.04 * l, (b - 0.5) * 1.1 + 0.5 + 0.1 * (1 - l) - 0.06 * l];
    case 4:
      return [mix(l, r * 0.85 + 0.14, 0.75), mix(l, g * 0.85 + 0.1, 0.75), mix(l, b * 0.85 + 0.03, 0.75)];
    case 5:
      return [r, g, b].map(v => mix(l, (v - 0.5) * 1.12 + 0.5, 1.45)) as [number, number, number];
    case 6:
      return [r - 0.05, g, b + 0.08];
    case 7:
      return [r + 0.08, g + 0.03, b - 0.06];
    case 8: {
      const v = smooth(0.1, 0.9, l);
      return [v, v, v];
    }
    case 9:
      return [r, g, b].map(v => mix(l, v * 0.8 + 0.12, 0.85)) as [number, number, number];
    case 10:
      return [r * 1.1 + 0.05 * l, g * 0.85, b * 1.25 + 0.05];
    case 11:
      return [1 - r, 1 - g, 1 - b];
    case 12:
      return [mix(l, r * 1.08, 1.15), mix(l, g, 1.15), mix(l, b * 0.82, 1.15)];
    default:
      return [r, g, b];
  }
}

export const ANIMS: { id: Animation['in']; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'fade', label: 'Fade' },
  { id: 'slide-left', label: 'Slide left' },
  { id: 'slide-right', label: 'Slide right' },
  { id: 'slide-up', label: 'Slide up' },
  { id: 'slide-down', label: 'Slide down' },
  { id: 'zoom-in', label: 'Zoom in' },
  { id: 'zoom-out', label: 'Zoom out' },
  { id: 'spin', label: 'Spin' },
  { id: 'pop', label: 'Pop' },
  { id: 'blur', label: 'Blur' },
];

export const MOTIONS: { id: Animation['motion']; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'kenburns', label: 'Ken Burns' },
  { id: 'pulse', label: 'Pulse' },
  { id: 'float', label: 'Float' },
  { id: 'rotate', label: 'Rotate' },
  { id: 'shake', label: 'Shake' },
];

export const defaultFx = (): Effects => ({ look: 'none', amount: 1, vignette: 0, grain: 0, blur: 0, sharpen: 0 });
export const defaultAnim = (): Animation => ({ in: 'none', inDur: 0.6, out: 'none', outDur: 0.6, motion: 'none' });
export const defaultCrop = (): Crop => ({ l: 0, r: 0, t: 0, b: 0 });

export const fxOf = (c: Clip): Effects => c.fx ?? defaultFx();
export const animOf = (c: Clip): Animation => c.anim ?? defaultAnim();
export const cropOf = (c: Clip): Crop => c.crop ?? defaultCrop();
export const speedOf = (c: Clip): number => c.speed ?? 1;

export interface Pose {
  dx: number;
  dy: number;
  scale: number;
  rot: number;
  opacity: number;
  blur: number;
}

const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);
const backOut = (t: number): number => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);

function phase(kind: Animation['in'], p: number, exit: boolean, pose: Pose): void {
  if (kind === 'none' || p >= 1) return;
  const e = easeOut(Math.max(0, p));
  const k = 1 - e;
  const dir = exit ? -1 : 1;
  switch (kind) {
    case 'fade':
      pose.opacity *= e;
      break;
    case 'slide-left':
      pose.dx += k * 2 * dir;
      break;
    case 'slide-right':
      pose.dx -= k * 2 * dir;
      break;
    case 'slide-up':
      pose.dy -= k * 2 * dir;
      break;
    case 'slide-down':
      pose.dy += k * 2 * dir;
      break;
    case 'zoom-in':
      pose.scale *= mix(0.3, 1, e);
      pose.opacity *= e;
      break;
    case 'zoom-out':
      pose.scale *= mix(1.8, 1, e);
      pose.opacity *= e;
      break;
    case 'spin':
      pose.rot += k * Math.PI * 2 * dir;
      pose.scale *= e;
      break;
    case 'pop':
      pose.scale *= Math.max(0, backOut(Math.max(0, p)));
      break;
    case 'blur':
      pose.blur += k;
      pose.opacity *= Math.min(1, e * 1.5);
      break;
  }
}

export function poseAt(c: Clip, t: number): Pose {
  const a = animOf(c);
  const local = t - c.start;
  const pose: Pose = { dx: 0, dy: 0, scale: 1, rot: 0, opacity: 1, blur: 0 };
  if (a.inDur > 0) phase(a.in, local / a.inDur, false, pose);
  if (a.outDur > 0) phase(a.out, (c.duration - local) / a.outDur, true, pose);
  const u = c.duration > 0 ? local / c.duration : 0;
  switch (a.motion) {
    case 'kenburns':
      pose.scale *= 1 + 0.18 * u;
      pose.dx += 0.06 * u;
      pose.dy += 0.03 * u;
      break;
    case 'pulse':
      pose.scale *= 1 + 0.04 * Math.sin(local * Math.PI * 2);
      break;
    case 'float':
      pose.dy += 0.025 * Math.sin(local * 2);
      break;
    case 'rotate':
      pose.rot += (local * Math.PI) / 9;
      break;
    case 'shake':
      pose.dx += 0.012 * Math.sin(local * 47) * Math.cos(local * 13);
      pose.dy += 0.012 * Math.cos(local * 41) * Math.sin(local * 17);
      break;
  }
  return pose;
}

export const BLEND_MODES: { id: BlendMode; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'add', label: 'Add' },
  { id: 'screen', label: 'Screen' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'softlight', label: 'Soft Light' },
  { id: 'lighten', label: 'Lighten' },
  { id: 'darken', label: 'Darken' },
  { id: 'difference', label: 'Difference' },
];

export const blendIndex = (id?: BlendMode): number => Math.max(0, BLEND_MODES.findIndex(b => b.id === (id ?? 'normal')));

export const defaultSecondary = (): Secondary => ({
  enabled: false,
  showMask: false,
  qual: { on: false, hue: 30, hueWidth: 0.08, satLow: 0.1, satHigh: 1, lumLow: 0.05, lumHigh: 0.95, soft: 0.05 },
  win: { shape: 'none', x: 0.5, y: 0.5, w: 0.3, h: 0.3, rot: 0, soft: 0.25, invert: false },
  exposure: 0,
  saturation: 1,
  hue: 0,
  temperature: 0,
});

export const secondaryOf = (c: Clip): Secondary => c.secondary ?? defaultSecondary();
export const defaultAi = (): AiSettings => ({ mode: 'none', amount: 0.7 });
export const aiOf = (c: Clip): AiSettings => c.ai ?? defaultAi();
export const defaultMix = (): TrackMix => ({ volume: 0, pan: 0, low: 0, mid: 0, high: 0, solo: false });
export const mixOf = (t: Track): TrackMix => t.mix ?? defaultMix();
export const defaultCutout = (): Cutout => ({ mode: 'off', maskId: '', points: [], at: 0, feather: 0.2, expand: 0, plate: true, show: false });
export const cutoutOf = (c: Clip): Cutout => c.cutout ?? defaultCutout();

export const STYLES: { id: StyleId; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'cartoon', label: 'Cartoon' },
  { id: 'anime', label: 'Anime' },
  { id: 'sketch', label: 'Pencil sketch' },
  { id: 'colorpencil', label: 'Color pencil' },
  { id: 'oil', label: 'Oil painting' },
  { id: 'watercolor', label: 'Watercolor' },
  { id: 'comic', label: 'Comic book' },
  { id: 'pixel', label: 'Pixel art' },
  { id: 'neon', label: 'Neon edges' },
];
