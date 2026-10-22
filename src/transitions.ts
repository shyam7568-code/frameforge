import { store } from './state';
import type { Clip, TransitionKind } from './types';

export const TRANSITIONS: { id: TransitionKind; label: string }[] = [
  { id: 'dissolve', label: 'Cross Dissolve' },
  { id: 'dip', label: 'Dip to Black' },
  { id: 'push', label: 'Push' },
  { id: 'slide-left', label: 'Slide Left' },
  { id: 'slide-right', label: 'Slide Right' },
  { id: 'slide-up', label: 'Slide Up' },
  { id: 'slide-down', label: 'Slide Down' },
  { id: 'wipe-left', label: 'Wipe Left' },
  { id: 'wipe-right', label: 'Wipe Right' },
  { id: 'wipe-up', label: 'Wipe Up' },
  { id: 'wipe-down', label: 'Wipe Down' },
  { id: 'iris', label: 'Iris (Circle)' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'spin', label: 'Spin' },
  { id: 'blur', label: 'Blur Dissolve' },
];

export interface TransitionMods {
  dx: number;
  dy: number;
  scale: number;
  rot: number;
  opacity: number;
  blur: number;
  wipe: [number, number];
  audio: number;
}

export const neutralMods = (): TransitionMods => ({ dx: 0, dy: 0, scale: 1, rot: 0, opacity: 1, blur: 0, wipe: [0, 0], audio: 1 });

const WIPE: Partial<Record<TransitionKind, number>> = { 'wipe-left': 1, 'wipe-right': 2, 'wipe-up': 3, 'wipe-down': 4, iris: 5 };

export function previousOf(c: Clip): Clip | undefined {
  const tol = 1.5 / store.project.fps;
  return store.project.clips.find(p => p !== c && p.trackId === c.trackId && Math.abs(p.start + p.duration - c.start) < tol);
}

export function nextOf(c: Clip): Clip | undefined {
  const tol = 1.5 / store.project.fps;
  const end = c.start + c.duration;
  return store.project.clips.find(n => n !== c && n.trackId === c.trackId && Math.abs(n.start - end) < tol);
}

function window(c: Clip): { from: number; to: number; prev?: Clip } | null {
  const tr = c.transIn;
  if (!tr || tr.duration <= 0) return null;
  const prev = previousOf(c);
  if (prev) return { from: c.start - tr.duration / 2, to: c.start + tr.duration / 2, prev };
  return { from: c.start, to: c.start + tr.duration };
}

export function span(c: Clip): [number, number] {
  let from = c.start;
  let to = c.start + c.duration;
  const w = window(c);
  if (w) from = Math.min(from, w.from);
  const next = nextOf(c);
  const nw = next ? window(next) : null;
  if (nw?.prev === c) to = Math.max(to, nw.to);
  return [from, to];
}

export function isActive(c: Clip, t: number): boolean {
  const [from, to] = span(c);
  return t >= from && t < to;
}

const ease = (q: number): number => q * q * (3 - 2 * q);

function incoming(kind: TransitionKind, e: number, q: number, m: TransitionMods): void {
  switch (kind) {
    case 'dissolve':
      m.opacity *= e;
      break;
    case 'dip':
      m.opacity *= Math.max(0, 2 * q - 1);
      break;
    case 'push':
    case 'slide-left':
      m.dx += (1 - e) * 2;
      break;
    case 'slide-right':
      m.dx -= (1 - e) * 2;
      break;
    case 'slide-up':
      m.dy -= (1 - e) * 2;
      break;
    case 'slide-down':
      m.dy += (1 - e) * 2;
      break;
    case 'zoom':
      m.scale *= 0.5 + 0.5 * e;
      m.opacity *= e;
      break;
    case 'spin':
      m.rot += (1 - e) * Math.PI;
      m.scale *= Math.max(0.01, e);
      m.opacity *= e;
      break;
    case 'blur':
      m.blur += 1 - e;
      m.opacity *= e;
      break;
    default:
      m.wipe = [WIPE[kind] ?? 0, e];
  }
  m.audio *= e;
}

function outgoing(kind: TransitionKind, e: number, q: number, m: TransitionMods): void {
  switch (kind) {
    case 'dip':
      m.opacity *= Math.max(0, 1 - 2 * q);
      break;
    case 'push':
      m.dx -= e * 2;
      break;
    case 'zoom':
      m.scale *= 1 + 0.3 * e;
      break;
    case 'blur':
      m.blur += e;
      break;
  }
  m.audio *= 1 - e;
}

export interface Role {
  mods: TransitionMods;
  order: number;
}

export function roleAt(c: Clip, t: number): Role {
  const mods = neutralMods();
  let order = 1;
  const w = window(c);
  if (w && t >= w.from && t < w.to && c.transIn) {
    const q = (t - w.from) / (w.to - w.from);
    incoming(c.transIn.kind, ease(q), q, mods);
    order = 2;
  }
  const next = nextOf(c);
  const nw = next ? window(next) : null;
  if (next?.transIn && nw?.prev === c && t >= nw.from && t < nw.to) {
    const q = (t - nw.from) / (nw.to - nw.from);
    outgoing(next.transIn.kind, ease(q), q, mods);
    order = 0;
  }
  return { mods, order };
}
