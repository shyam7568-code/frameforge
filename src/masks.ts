export interface Frame {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / (2 * r + 1);
      sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / (2 * r + 1);
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

export function luminance(f: Frame): Float32Array {
  const out = new Float32Array(f.width * f.height);
  for (let i = 0; i < out.length; i++) out[i] = (0.299 * f.rgba[i * 4] + 0.587 * f.rgba[i * 4 + 1] + 0.114 * f.rgba[i * 4 + 2]) / 255;
  return out;
}

export function guidedFilter(guide: Float32Array, p: Float32Array, w: number, h: number, r = 4, eps = 2e-3): Float32Array {
  const n = w * h;
  const ip = new Float32Array(n);
  const ii = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    ip[i] = guide[i] * p[i];
    ii[i] = guide[i] * guide[i];
  }
  const mI = boxMean(guide, w, h, r);
  const mP = boxMean(p, w, h, r);
  const mIP = boxMean(ip, w, h, r);
  const mII = boxMean(ii, w, h, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const cov = mIP[i] - mI[i] * mP[i];
    const v = mII[i] - mI[i] * mI[i];
    a[i] = cov / (v + eps);
    b[i] = mP[i] - a[i] * mI[i];
  }
  const mA = boxMean(a, w, h, r);
  const mB = boxMean(b, w, h, r);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.min(1, Math.max(0, mA[i] * guide[i] + mB[i]));
  return out;
}

export function refine(mask: Float32Array, frame: Frame): Uint8Array {
  const { width: w, height: h } = frame;
  const soft = guidedFilter(luminance(frame), mask, w, h, Math.max(2, Math.round(w / 160)), 1e-3);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) {
    const v = soft[i];
    out[i] = Math.round(Math.min(1, Math.max(0, (v - 0.25) / 0.5)) * 255);
  }
  return out;
}

export function area(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] > 127) n++;
  return n;
}

export function overlap(a: Uint8Array, b: Uint8Array): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] > 127;
    const y = b[i] > 127;
    if (x && y) inter++;
    if (x || y) union++;
  }
  return union ? inter / union : 0;
}

export function innerPoint(mask: Uint8Array, w: number, h: number): { x: number; y: number } | null {
  const step = Math.max(1, Math.floor(Math.max(w, h) / 160));
  const sw = Math.ceil(w / step);
  const sh = Math.ceil(h / step);
  const d = new Float32Array(sw * sh);
  const INF = 1e9;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) d[y * sw + x] = mask[Math.min(h - 1, y * step) * w + Math.min(w - 1, x * step)] > 127 ? INF : 0;
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++) {
      const i = y * sw + x;
      if (!d[i]) continue;
      const up = y ? d[i - sw] : 0;
      const left = x ? d[i - 1] : 0;
      d[i] = Math.min(d[i], up + 1, left + 1);
    }
  let best = -1;
  let bx = 0;
  let by = 0;
  for (let y = sh - 1; y >= 0; y--)
    for (let x = sw - 1; x >= 0; x--) {
      const i = y * sw + x;
      if (!d[i]) continue;
      const down = y < sh - 1 ? d[i + sw] : 0;
      const right = x < sw - 1 ? d[i + 1] : 0;
      d[i] = Math.min(d[i], down + 1, right + 1);
      if (d[i] > best) {
        best = d[i];
        bx = x;
        by = y;
      }
    }
  return best > 0 ? { x: (bx * step + step / 2) / w, y: (by * step + step / 2) / h } : null;
}

export function encode(mask: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < mask.length) {
    const v = mask[i] >> 2;
    let run = 1;
    while (i + run < mask.length && run < 65535 && mask[i + run] >> 2 === v) run++;
    out.push(v, run & 255, run >> 8);
    i += run;
  }
  return Uint8Array.from(out);
}

export function decode(rle: Uint8Array, size: number, out = new Uint8Array(size)): Uint8Array {
  let o = 0;
  for (let i = 0; i + 2 < rle.length && o < size; i += 3) {
    const v = rle[i] === 63 ? 255 : rle[i] << 2;
    const run = rle[i + 1] | (rle[i + 2] << 8);
    out.fill(v, o, Math.min(size, o + run));
    o += run;
  }
  return out;
}

export function fillHoles(rgba: Uint8ClampedArray, mask: Uint8Array, w: number, h: number): void {
  interface Level {
    w: number;
    h: number;
    c: Float32Array;
    a: Float32Array;
  }
  const base: Level = { w, h, c: new Float32Array(w * h * 3), a: new Float32Array(w * h) };
  for (let i = 0; i < w * h; i++) {
    const known = mask[i] < 128 ? 1 : 0;
    base.a[i] = known;
    for (let ch = 0; ch < 3; ch++) base.c[i * 3 + ch] = rgba[i * 4 + ch] * known;
  }
  const levels = [base];
  while (levels[levels.length - 1].w > 1 || levels[levels.length - 1].h > 1) {
    const f = levels[levels.length - 1];
    const nw = Math.max(1, f.w >> 1);
    const nh = Math.max(1, f.h >> 1);
    const n: Level = { w: nw, h: nh, c: new Float32Array(nw * nh * 3), a: new Float32Array(nw * nh) };
    for (let y = 0; y < nh; y++)
      for (let x = 0; x < nw; x++) {
        let sa = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++) {
            const j = Math.min(f.h - 1, y * 2 + dy) * f.w + Math.min(f.w - 1, x * 2 + dx);
            sa += f.a[j];
            r += f.c[j * 3];
            g += f.c[j * 3 + 1];
            b += f.c[j * 3 + 2];
          }
        const k = y * nw + x;
        if (sa <= 0) continue;
        const a = Math.min(1, sa);
        n.a[k] = a;
        n.c[k * 3] = (r / sa) * a;
        n.c[k * 3 + 1] = (g / sa) * a;
        n.c[k * 3 + 2] = (b / sa) * a;
      }
    levels.push(n);
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const f = levels[l];
    const q = levels[l + 1];
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++) {
        const i = y * f.w + x;
        const missing = 1 - f.a[i];
        if (missing <= 0) continue;
        const cx = Math.min(q.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5));
        const cy = Math.min(q.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
        const x0 = Math.floor(cx);
        const y0 = Math.floor(cy);
        const x1 = Math.min(q.w - 1, x0 + 1);
        const y1 = Math.min(q.h - 1, y0 + 1);
        const tx = cx - x0;
        const ty = cy - y0;
        const w00 = (1 - tx) * (1 - ty);
        const w10 = tx * (1 - ty);
        const w01 = (1 - tx) * ty;
        const w11 = tx * ty;
        const j00 = y0 * q.w + x0;
        const j10 = y0 * q.w + x1;
        const j01 = y1 * q.w + x0;
        const j11 = y1 * q.w + x1;
        f.a[i] += missing * (q.a[j00] * w00 + q.a[j10] * w10 + q.a[j01] * w01 + q.a[j11] * w11);
        for (let ch = 0; ch < 3; ch++) {
          f.c[i * 3 + ch] += missing * (q.c[j00 * 3 + ch] * w00 + q.c[j10 * 3 + ch] * w10 + q.c[j01 * 3 + ch] * w01 + q.c[j11 * 3 + ch] * w11);
        }
      }
  }
  for (let i = 0; i < w * h; i++) {
    const m = mask[i] / 255;
    if (m <= 0 || base.a[i] <= 0) continue;
    for (let ch = 0; ch < 3; ch++) rgba[i * 4 + ch] = rgba[i * 4 + ch] * (1 - m) + (base.c[i * 3 + ch] / base.a[i]) * m;
  }
}

export function grow(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask;
  const f = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) f[i] = mask[i] > 127 ? 1 : 0;
  const m = boxMean(f, w, h, r);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < out.length; i++) out[i] = m[i] > 0.001 ? 255 : mask[i];
  return out;
}

export function shape(mask: Uint8Array, w: number, h: number, expand: number, feather: number): Uint8Array {
  const unit = Math.max(w, h) / 100;
  let m = mask;
  if (expand > 0.01) m = grow(m, w, h, Math.round(expand * unit * 3));
  else if (expand < -0.01) {
    const inv = new Uint8Array(m.length);
    for (let i = 0; i < inv.length; i++) inv[i] = 255 - m[i];
    const g = grow(inv, w, h, Math.round(-expand * unit * 3));
    m = new Uint8Array(g.length);
    for (let i = 0; i < m.length; i++) m[i] = 255 - g[i];
  }
  const r = Math.round(feather * unit * 1.5);
  if (r < 1) return m;
  const f = new Float32Array(m.length);
  for (let i = 0; i < f.length; i++) f[i] = m[i] / 255;
  const b = boxMean(boxMean(f, w, h, Math.ceil(r / 2)), w, h, Math.ceil(r / 2));
  const out = new Uint8Array(m.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(b[i] * 255);
  return out;
}

export function resample(src: Float32Array, sw: number, sh: number, w: number, h: number): Float32Array {
  if (sw === w && sh === h) return src;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / h));
    for (let x = 0; x < w; x++) out[y * w + x] = src[sy * sw + Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / w))];
  }
  return out;
}
