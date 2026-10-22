export type MediaKind = 'video' | 'audio' | 'image';
export type ClipKind = MediaKind | 'text';
export type TrackKind = 'video' | 'audio';
export type Page = 'media' | 'edit' | 'color' | 'deliver';
export type Tool = 'select' | 'razor';

export interface MediaMeta {
  id: string;
  name: string;
  kind: MediaKind;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  size: number;
}

export interface MediaRuntime {
  url: string;
  thumb: string;
  peaks: string;
  blob: Blob;
}

export interface Wheel {
  x: number;
  y: number;
  m: number;
}

export interface Grade {
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  lift: Wheel;
  gamma: Wheel;
  gain: Wheel;
  offset?: Wheel;
  shadows?: number;
  highlights?: number;
}

export interface TextStyle {
  content: string;
  size: number;
  color: string;
  bold: boolean;
  box?: boolean;
}

export type TransitionKind =
  | 'dissolve' | 'dip' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down' | 'push'
  | 'zoom' | 'wipe-left' | 'wipe-right' | 'wipe-up' | 'wipe-down' | 'iris' | 'spin' | 'blur';

export interface TransitionSpec {
  kind: TransitionKind;
  duration: number;
}

export type KeyProp = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'exposure' | 'contrast' | 'saturation' | 'temperature' | 'tint';

export interface Keyframe {
  t: number;
  v: number;
}

export type BlendMode = 'normal' | 'add' | 'screen' | 'multiply' | 'overlay' | 'lighten' | 'darken' | 'difference' | 'softlight';

export interface Qualifier {
  on: boolean;
  hue: number;
  hueWidth: number;
  satLow: number;
  satHigh: number;
  lumLow: number;
  lumHigh: number;
  soft: number;
}

export interface PowerWindow {
  shape: 'none' | 'circle' | 'rect' | 'linear';
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  soft: number;
  invert: boolean;
}

export interface Secondary {
  enabled: boolean;
  showMask: boolean;
  qual: Qualifier;
  win: PowerWindow;
  exposure: number;
  saturation: number;
  hue: number;
  temperature: number;
}

export type AiMode = 'none' | 'remove' | 'defocus' | 'mono';

export interface AiSettings {
  mode: AiMode;
  amount: number;
}

export type CutoutMode = 'off' | 'keep' | 'erase';

export interface Cutout {
  mode: CutoutMode;
  maskId: string;
  points: { x: number; y: number }[];
  at: number;
  feather: number;
  expand: number;
  plate: boolean;
  show: boolean;
}

export type StyleId = 'none' | 'cartoon' | 'anime' | 'sketch' | 'colorpencil' | 'oil' | 'watercolor' | 'comic' | 'pixel' | 'neon';

export interface TrackMix {
  volume: number;
  pan: number;
  low: number;
  mid: number;
  high: number;
  solo: boolean;
}

export type Anim = 'none' | 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down' | 'zoom-in' | 'zoom-out' | 'spin' | 'pop' | 'blur';
export type Motion = 'none' | 'kenburns' | 'pulse' | 'float' | 'rotate' | 'shake';

export interface Crop {
  l: number;
  r: number;
  t: number;
  b: number;
}

export interface Effects {
  look: string;
  amount: number;
  vignette: number;
  grain: number;
  blur: number;
  sharpen: number;
  lens?: number;
  denoise?: number;
  flare?: number;
  flareX?: number;
  flareY?: number;
  style?: StyleId;
  styleAmt?: number;
}

export interface Animation {
  in: Anim;
  inDur: number;
  out: Anim;
  outDur: number;
  motion: Motion;
}

export interface Clip {
  id: string;
  trackId: string;
  kind: ClipKind;
  mediaId?: string;
  linkId?: string;
  name: string;
  start: number;
  duration: number;
  offset: number;
  opacity: number;
  volume: number;
  scale: number;
  x: number;
  y: number;
  fadeIn: number;
  fadeOut: number;
  grade: Grade;
  text?: TextStyle;
  speed?: number;
  crop?: Crop;
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
  fx?: Effects;
  anim?: Animation;
  transIn?: TransitionSpec;
  keys?: Partial<Record<KeyProp, Keyframe[]>>;
  blend?: BlendMode;
  secondary?: Secondary;
  ai?: AiSettings;
  cutout?: Cutout;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
  mix?: TrackMix;
}

export interface Project {
  version: 1;
  name: string;
  width: number;
  height: number;
  fps: number;
  tracks: Track[];
  clips: Clip[];
  media: MediaMeta[];
  masterVolume?: number;
}
