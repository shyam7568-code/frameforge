export interface P {
  x: number;
  y: number;
}

export type ShapeKind = 'line' | 'arc' | 'ellipse' | 'polygon' | 'polyline';

export interface Shape {
  kind: ShapeKind;
  pts: P[];
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rot: number;
  closed: boolean;
}

const dist = (a: P, b: P): number => Math.hypot(a.x - b.x, a.y - b.y);

function segDist(p: P, a: P, b: P): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = dx * dx + dy * dy;
  if (!L) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function rdp(pts: P[], eps: number): P[] {
  if (pts.length < 3) return pts.slice();
  let max = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  const a = rdp(pts.slice(0, idx + 1), eps);
  const b = rdp(pts.slice(idx), eps);
  return [...a.slice(0, -1), ...b];
}

function length(pts: P[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i], pts[i - 1]);
  return L;
}

function fitEllipse(pts: P[]): { cx: number; cy: number; rx: number; ry: number; rot: number; err: number } {
  const n = pts.length;
  const cx = pts.reduce((s, p) => s + p.x, 0) / n;
  const cy = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    sxx += (p.x - cx) ** 2;
    syy += (p.y - cy) ** 2;
    sxy += (p.x - cx) * (p.y - cy);
  }
  const rot = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const c = Math.cos(-rot);
  const s = Math.sin(-rot);
  let ax = 0;
  let ay = 0;
  for (const p of pts) {
    const x = (p.x - cx) * c - (p.y - cy) * s;
    const y = (p.x - cx) * s + (p.y - cy) * c;
    ax = Math.max(ax, Math.abs(x));
    ay = Math.max(ay, Math.abs(y));
  }
  const rx = Math.max(1, ax * 0.97);
  const ry = Math.max(1, ay * 0.97);
  let err = 0;
  for (const p of pts) {
    const x = (p.x - cx) * c - (p.y - cy) * s;
    const y = (p.x - cx) * s + (p.y - cy) * c;
    err += Math.abs(Math.hypot(x / rx, y / ry) - 1);
  }
  return { cx, cy, rx, ry, rot, err: err / n };
}

function circleFrom3(a: P, b: P, c: P): { cx: number; cy: number; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-6) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { cx, cy, r: Math.hypot(a.x - cx, a.y - cy) };
}

export function detect(raw: P[]): Shape | null {
  if (raw.length < 4) return null;
  const L = length(raw);
  if (L < 12) return null;
  const a = raw[0];
  const b = raw[raw.length - 1];
  const chord = dist(a, b);
  const box = raw.reduce((r, p) => ({ x0: Math.min(r.x0, p.x), y0: Math.min(r.y0, p.y), x1: Math.max(r.x1, p.x), y1: Math.max(r.y1, p.y) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const diag = Math.hypot(box.x1 - box.x0, box.y1 - box.y0);
  const maxDev = Math.max(...raw.map(p => segDist(p, a, b)));
  const base = { cx: 0, cy: 0, rx: 0, ry: 0, rot: 0 };
  if (maxDev < Math.max(4, chord * 0.07)) return { kind: 'line', pts: [a, b], closed: false, ...base };
  const closed = chord < Math.max(16, L * 0.18);
  const simple = rdp(raw, diag * 0.06);
  if (closed) {
    const corners = simple.slice(0, -1);
    const e = fitEllipse(raw);
    if (corners.length >= 3 && corners.length <= 6) {
      const polyErr = raw.reduce((s, p) => {
        let m = Infinity;
        for (let i = 0; i < corners.length; i++) m = Math.min(m, segDist(p, corners[i], corners[(i + 1) % corners.length]));
        return s + m;
      }, 0) / raw.length;
      const ellErr = e.err * Math.max(e.rx, e.ry);
      if (polyErr < ellErr * 0.8) return { kind: 'polygon', pts: corners, closed: true, ...base };
    }
    return { kind: 'ellipse', pts: [], closed: true, cx: e.cx, cy: e.cy, rx: e.rx, ry: e.ry, rot: e.rot };
  }
  if (simple.length >= 3 && simple.length <= 6) {
    const err = raw.reduce((s, p) => {
      let m = Infinity;
      for (let i = 1; i < simple.length; i++) m = Math.min(m, segDist(p, simple[i - 1], simple[i]));
      return s + m;
    }, 0) / raw.length;
    const mid = raw[Math.floor(raw.length / 2)];
    const circ = circleFrom3(a, mid, b);
    if (circ) {
      const arcErr = raw.reduce((s, p) => s + Math.abs(Math.hypot(p.x - circ.cx, p.y - circ.cy) - circ.r), 0) / raw.length;
      if (arcErr < err && arcErr < diag * 0.05) return { kind: 'arc', pts: [a, mid, b], closed: false, ...base };
    }
    return { kind: 'polyline', pts: simple, closed: false, ...base };
  }
  const mid = raw[Math.floor(raw.length / 2)];
  const circ = circleFrom3(a, mid, b);
  if (circ && circ.r < diag * 4) return { kind: 'arc', pts: [a, mid, b], closed: false, ...base };
  return null;
}

export function perfect(s: Shape): Shape {
  if (s.kind === 'ellipse') {
    const r = (s.rx + s.ry) / 2;
    return { ...s, rx: r, ry: r };
  }
  if (s.kind === 'line') {
    const [a, b] = s.pts;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const snap = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
    const L = dist(a, b);
    return { ...s, pts: [a, { x: a.x + Math.cos(snap) * L, y: a.y + Math.sin(snap) * L }] };
  }
  if (s.kind === 'polygon') {
    const n = s.pts.length;
    const cx = s.pts.reduce((t, p) => t + p.x, 0) / n;
    const cy = s.pts.reduce((t, p) => t + p.y, 0) / n;
    const r = s.pts.reduce((t, p) => t + Math.hypot(p.x - cx, p.y - cy), 0) / n;
    const a0 = Math.atan2(s.pts[0].y - cy, s.pts[0].x - cx);
    const step = n === 4 ? Math.PI / 2 : (2 * Math.PI) / n;
    const start = n === 4 ? Math.round(a0 / (Math.PI / 4) - 0.5) * (Math.PI / 4) + Math.PI / 4 : a0;
    return { ...s, pts: Array.from({ length: n }, (_, i) => ({ x: cx + Math.cos(start + i * step) * r, y: cy + Math.sin(start + i * step) * r })) };
  }
  return s;
}

export function transformShape(s: Shape, from: P, to: P): Shape {
  if (s.kind === 'line') return { ...s, pts: [s.pts[0], to] };
  const cx = s.kind === 'ellipse' ? s.cx : s.pts.reduce((t, p) => t + p.x, 0) / s.pts.length;
  const cy = s.kind === 'ellipse' ? s.cy : s.pts.reduce((t, p) => t + p.y, 0) / s.pts.length;
  const v0 = { x: from.x - cx, y: from.y - cy };
  const v1 = { x: to.x - cx, y: to.y - cy };
  const l0 = Math.hypot(v0.x, v0.y) || 1;
  const k = Math.max(0.05, Math.hypot(v1.x, v1.y) / l0);
  const rot = Math.atan2(v1.y, v1.x) - Math.atan2(v0.y, v0.x);
  if (s.kind === 'ellipse') return { ...s, rx: s.rx * k, ry: s.ry * k, rot: s.rot + rot };
  const c = Math.cos(rot);
  const sn = Math.sin(rot);
  return { ...s, pts: s.pts.map(p => ({ x: cx + ((p.x - cx) * c - (p.y - cy) * sn) * k, y: cy + ((p.x - cx) * sn + (p.y - cy) * c) * k })) };
}

export function shapePath(s: Shape, step = 2): P[] {
  const out: P[] = [];
  const seg = (a: P, b: P): void => {
    const n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let i = out.length ? 1 : 0; i <= n; i++) out.push({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n });
  };
  if (s.kind === 'line') seg(s.pts[0], s.pts[1]);
  else if (s.kind === 'polyline') for (let i = 1; i < s.pts.length; i++) seg(s.pts[i - 1], s.pts[i]);
  else if (s.kind === 'polygon') {
    for (let i = 1; i <= s.pts.length; i++) seg(s.pts[i - 1], s.pts[i % s.pts.length]);
  } else if (s.kind === 'ellipse') {
    const n = Math.max(24, Math.ceil((Math.PI * 2 * Math.max(s.rx, s.ry)) / step));
    for (let i = 0; i <= n + 1; i++) {
      const t = (i / n) * Math.PI * 2;
      const x = Math.cos(t) * s.rx;
      const y = Math.sin(t) * s.ry;
      out.push({ x: s.cx + x * Math.cos(s.rot) - y * Math.sin(s.rot), y: s.cy + x * Math.sin(s.rot) + y * Math.cos(s.rot) });
    }
  } else if (s.kind === 'arc') {
    const [a, m, b] = s.pts;
    const c = circleFrom3(a, m, b);
    if (!c) seg(a, b);
    else {
      const a0 = Math.atan2(a.y - c.cy, a.x - c.cx);
      const a1 = Math.atan2(b.y - c.cy, b.x - c.cx);
      const am = Math.atan2(m.y - c.cy, m.x - c.cx);
      const norm = (v: number): number => ((v % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const ccw = norm(am - a0) < norm(a1 - a0);
      let sweep = norm(a1 - a0);
      if (!ccw) sweep = sweep - 2 * Math.PI;
      const n = Math.max(8, Math.ceil((Math.abs(sweep) * c.r) / step));
      for (let i = 0; i <= n; i++) {
        const t = a0 + (sweep * i) / n;
        out.push({ x: c.cx + Math.cos(t) * c.r, y: c.cy + Math.sin(t) * c.r });
      }
    }
  }
  return out;
}

export function shapeHandles(s: Shape): P[] {
  if (s.kind === 'ellipse') {
    const pts: P[] = [];
    for (const [x, y] of [
      [s.rx, 0],
      [0, s.ry],
      [-s.rx, 0],
      [0, -s.ry],
    ]) pts.push({ x: s.cx + x * Math.cos(s.rot) - y * Math.sin(s.rot), y: s.cy + x * Math.sin(s.rot) + y * Math.cos(s.rot) });
    return pts;
  }
  return s.pts;
}

export function moveHandle(s: Shape, index: number, to: P): Shape {
  if (s.kind === 'ellipse') {
    const dx = to.x - s.cx;
    const dy = to.y - s.cy;
    const c = Math.cos(-s.rot);
    const sn = Math.sin(-s.rot);
    const lx = dx * c - dy * sn;
    const ly = dx * sn + dy * c;
    if (index % 2 === 0) return { ...s, rx: Math.max(2, Math.abs(lx)) };
    return { ...s, ry: Math.max(2, Math.abs(ly)) };
  }
  const pts = s.pts.slice();
  pts[index] = to;
  return { ...s, pts };
}
