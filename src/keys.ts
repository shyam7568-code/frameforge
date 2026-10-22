import type { Clip, Grade, KeyProp, Keyframe } from './types';

export const KEY_PROPS: KeyProp[] = ['x', 'y', 'scale', 'rotation', 'opacity', 'exposure', 'contrast', 'saturation', 'temperature', 'tint'];
const GRADE_PROPS = new Set<KeyProp>(['exposure', 'contrast', 'saturation', 'temperature', 'tint']);
const EPS = 1 / 120;

export function baseValue(c: Clip, prop: KeyProp): number {
  if (GRADE_PROPS.has(prop)) return c.grade[prop as keyof Pick<Grade, 'exposure' | 'contrast' | 'saturation' | 'temperature' | 'tint'>];
  if (prop === 'rotation') return c.rotation ?? 0;
  return c[prop as 'x' | 'y' | 'scale' | 'opacity'];
}

export function setBase(c: Clip, prop: KeyProp, v: number): void {
  if (GRADE_PROPS.has(prop)) (c.grade as unknown as Record<string, number>)[prop] = v;
  else if (prop === 'rotation') c.rotation = v;
  else (c as unknown as Record<string, number>)[prop] = v;
}

export const keysOf = (c: Clip, prop: KeyProp): Keyframe[] => c.keys?.[prop] ?? [];
export const hasKeys = (c: Clip, prop: KeyProp): boolean => keysOf(c, prop).length > 0;
export const localTime = (c: Clip, t: number): number => Math.min(c.duration, Math.max(0, t - c.start));

export function valueAt(c: Clip, prop: KeyProp, local: number): number {
  const keys = keysOf(c, prop);
  if (!keys.length) return baseValue(c, prop);
  if (local <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (local >= last.t) return last.v;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (local <= b.t) {
      const a = keys[i - 1];
      const u = (local - a.t) / Math.max(EPS, b.t - a.t);
      const s = u * u * (3 - 2 * u);
      return a.v + (b.v - a.v) * s;
    }
  }
  return last.v;
}

export function keyAt(c: Clip, prop: KeyProp, local: number): Keyframe | undefined {
  return keysOf(c, prop).find(k => Math.abs(k.t - local) < EPS);
}

export function setKey(c: Clip, prop: KeyProp, local: number, v: number): void {
  const keys = [...keysOf(c, prop).filter(k => Math.abs(k.t - local) >= EPS), { t: local, v }].sort((a, b) => a.t - b.t);
  c.keys = { ...(c.keys ?? {}), [prop]: keys };
}

export function removeKey(c: Clip, prop: KeyProp, local: number): void {
  const keys = keysOf(c, prop).filter(k => Math.abs(k.t - local) >= EPS);
  const next = { ...(c.keys ?? {}) };
  if (keys.length) next[prop] = keys;
  else {
    setBase(c, prop, valueAt(c, prop, local));
    delete next[prop];
  }
  c.keys = next;
}

export function allKeyTimes(c: Clip): number[] {
  const times = new Set<number>();
  for (const prop of KEY_PROPS) keysOf(c, prop).forEach(k => times.add(Math.round(k.t * 1000) / 1000));
  return [...times].sort((a, b) => a - b);
}

export function shiftKeys(c: Clip, delta: number): void {
  if (!c.keys) return;
  const next: Clip['keys'] = {};
  for (const prop of KEY_PROPS) {
    const keys = keysOf(c, prop)
      .map(k => ({ t: k.t + delta, v: k.v }))
      .filter(k => k.t >= -EPS && k.t <= c.duration + EPS);
    if (keys.length) next[prop] = keys;
  }
  c.keys = next;
}
