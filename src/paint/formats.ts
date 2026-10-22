import { composeLayers } from './compose';
import { ctx2d, makeCanvas, newLayer, type Blend, type Doc, type Layer } from './doc';
import { uid } from '../util';

const PSD_KEYS: Record<Blend, string> = {
  normal: 'norm',
  multiply: 'mul ',
  darken: 'dark',
  'color-burn': 'idiv',
  'linear-burn': 'lbrn',
  'darker-color': 'dkCl',
  lighten: 'lite',
  screen: 'scrn',
  'color-dodge': 'div ',
  add: 'lddg',
  'lighter-color': 'lgCl',
  overlay: 'over',
  'soft-light': 'sLit',
  'hard-light': 'hLit',
  'vivid-light': 'vLit',
  'linear-light': 'lLit',
  'pin-light': 'pLit',
  'hard-mix': 'hMix',
  difference: 'diff',
  exclusion: 'smud',
  subtract: 'fsub',
  divide: 'fdiv',
  hue: 'hue ',
  saturation: 'sat ',
  color: 'colr',
  luminosity: 'lum ',
};

class Writer {
  private chunks: Uint8Array[] = [];
  private cur = new Uint8Array(1 << 16);
  private pos = 0;
  length = 0;

  private need(n: number): void {
    if (this.pos + n <= this.cur.length) return;
    this.chunks.push(this.cur.subarray(0, this.pos));
    this.cur = new Uint8Array(Math.max(1 << 16, n));
    this.pos = 0;
  }

  u8(v: number): void {
    this.need(1);
    this.cur[this.pos++] = v & 255;
    this.length++;
  }

  u16(v: number): void {
    this.u8(v >> 8);
    this.u8(v);
  }

  u32(v: number): void {
    this.u16((v >>> 16) & 0xffff);
    this.u16(v & 0xffff);
  }

  str(s: string): void {
    for (const ch of s) this.u8(ch.charCodeAt(0));
  }

  bytes(b: Uint8Array): void {
    if (b.length > 4096) {
      this.chunks.push(this.cur.subarray(0, this.pos));
      this.chunks.push(b);
      this.cur = new Uint8Array(1 << 16);
      this.pos = 0;
      this.length += b.length;
      return;
    }
    this.need(b.length);
    this.cur.set(b, this.pos);
    this.pos += b.length;
    this.length += b.length;
  }

  blob(type: string): Blob {
    return new Blob([...this.chunks, this.cur.subarray(0, this.pos)] as BlobPart[], { type });
  }
}

function packBits(row: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < row.length) {
    let run = 1;
    while (i + run < row.length && run < 128 && row[i + run] === row[i]) run++;
    if (run > 1) {
      out.push(257 - run, row[i]);
      i += run;
      continue;
    }
    const start = i;
    let lit = 0;
    while (i < row.length && lit < 128 && !(i + 1 < row.length && row[i + 1] === row[i] && i + 2 < row.length && row[i + 2] === row[i])) {
      i++;
      lit++;
    }
    out.push(lit - 1);
    for (let k = start; k < start + lit; k++) out.push(row[k]);
  }
  return Uint8Array.from(out);
}

function channelRle(data: Uint8ClampedArray, w: number, h: number, ch: number): { counts: number[]; rows: Uint8Array[] } {
  const counts: number[] = [];
  const rows: Uint8Array[] = [];
  const row = new Uint8Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) row[x] = data[(y * w + x) * 4 + ch];
    const packed = packBits(row);
    counts.push(packed.length);
    rows.push(packed);
  }
  return { counts, rows };
}

function bounds(img: ImageData): { x: number; y: number; w: number; h: number } | null {
  const { width: w, height: h, data } = img;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

interface FlatLayer {
  name: string;
  canvas: HTMLCanvasElement;
  blend: Blend;
  opacity: number;
  visible: boolean;
  clip: boolean;
}

function flatList(doc: Doc): FlatLayer[] {
  const out: FlatLayer[] = [];
  for (const l of doc.layers) {
    let canvas = l.canvas;
    if (l.kind === 'group' || l.mask) {
      canvas = l.kind === 'group' ? composeLayers(l.children ?? [], doc.width, doc.height) : copyCanvas(l.canvas);
      if (l.mask && l.maskOn) {
        const g = ctx2d(canvas);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(l.mask, 0, 0);
      }
    }
    out.push({ name: l.name, canvas, blend: l.blend, opacity: l.opacity, visible: l.visible, clip: l.clip });
  }
  return out;
}

function copyCanvas(c: HTMLCanvasElement): HTMLCanvasElement {
  const out = makeCanvas(c.width, c.height);
  ctx2d(out).drawImage(c, 0, 0);
  return out;
}

export function writePsd(doc: Doc, flat: HTMLCanvasElement): Blob {
  const W = doc.width;
  const H = doc.height;
  const layers = flatList(doc);
  const w = new Writer();
  w.str('8BPS');
  w.u16(1);
  for (let i = 0; i < 6; i++) w.u8(0);
  w.u16(4);
  w.u32(H);
  w.u32(W);
  w.u16(8);
  w.u16(3);
  w.u32(0);
  w.u32(0);
  const records = new Writer();
  const channelData = new Writer();
  records.u16(layers.length);
  for (const l of layers) {
    const img = ctx2d(l.canvas).getImageData(0, 0, W, H);
    const b = bounds(img) ?? { x: 0, y: 0, w: 0, h: 0 };
    let sub = img;
    if (b.w && (b.w !== W || b.h !== H)) sub = ctx2d(l.canvas).getImageData(b.x, b.y, b.w, b.h);
    records.u32(b.y);
    records.u32(b.x);
    records.u32(b.y + b.h);
    records.u32(b.x + b.w);
    records.u16(4);
    const chans = [3, 0, 1, 2].map(ch => (b.w ? channelRle(sub.data, b.w, b.h, ch) : { counts: [], rows: [] }));
    const ids = [-1, 0, 1, 2];
    chans.forEach((c, i) => {
      records.u16(ids[i] & 0xffff);
      records.u32(2 + c.counts.length * 2 + c.rows.reduce((n, r) => n + r.length, 0));
    });
    records.str('8BIM');
    records.str(PSD_KEYS[l.blend]);
    records.u8(Math.round(l.opacity * 255));
    records.u8(l.clip ? 1 : 0);
    records.u8(l.visible ? 0 : 2);
    records.u8(0);
    const name = l.name.slice(0, 255).replace(/[^\x20-\x7e]/g, '?');
    const nameLen = 1 + name.length;
    const pad = (4 - (nameLen % 4)) % 4;
    records.u32(4 + 4 + nameLen + pad);
    records.u32(0);
    records.u32(0);
    records.u8(name.length);
    records.str(name);
    for (let i = 0; i < pad; i++) records.u8(0);
    for (const c of chans) {
      channelData.u16(1);
      for (const n of c.counts) channelData.u16(n);
      for (const r of c.rows) channelData.bytes(r);
    }
  }
  const infoLen = records.length + channelData.length;
  const infoPadded = infoLen + (infoLen % 2);
  w.u32(4 + infoPadded + 4);
  w.u32(infoPadded);
  w.bytes(new Uint8Array(0));
  const rb = records.blob('');
  const cb = channelData.blob('');
  const merged = ctx2d(flat).getImageData(0, 0, W, H);
  const mc = [0, 1, 2, 3].map(ch => channelRle(merged.data, W, H, ch));
  const tail = new Writer();
  if (infoLen % 2) tail.u8(0);
  tail.u32(0);
  tail.u16(1);
  for (const c of mc) for (const n of c.counts) tail.u16(n);
  for (const c of mc) for (const r of c.rows) tail.bytes(r);
  return new Blob([w.blob(''), rb, cb, tail.blob('')], { type: 'image/vnd.adobe.photoshop' });
}

class Reader {
  o = 0;
  constructor(readonly b: Uint8Array, readonly v: DataView) {}
  u8(): number {
    return this.b[this.o++];
  }
  u16(): number {
    const x = this.v.getUint16(this.o);
    this.o += 2;
    return x;
  }
  i16(): number {
    const x = this.v.getInt16(this.o);
    this.o += 2;
    return x;
  }
  u32(): number {
    const x = this.v.getUint32(this.o);
    this.o += 4;
    return x;
  }
  i32(): number {
    const x = this.v.getInt32(this.o);
    this.o += 4;
    return x;
  }
  skip(): void {
    const n = this.u32();
    this.o += n;
  }
  str(n: number): string {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8());
    return s;
  }
}

function unpackBits(r: Reader, out: Uint8Array, len: number): void {
  let o = 0;
  const end = r.o + len;
  while (r.o < end && o < out.length) {
    const n = r.v.getInt8(r.o++);
    if (n >= 0) {
      for (let i = 0; i <= n && o < out.length; i++) out[o++] = r.u8();
    } else if (n !== -128) {
      const v = r.u8();
      for (let i = 0; i <= -n && o < out.length; i++) out[o++] = v;
    }
  }
  r.o = end;
}

function readChannel(r: Reader, w: number, h: number, len: number): Uint8Array | null {
  const start = r.o;
  const comp = r.u16();
  const out = new Uint8Array(w * h);
  if (comp === 0) {
    out.set(r.b.subarray(r.o, r.o + w * h));
  } else if (comp === 1) {
    const counts: number[] = [];
    for (let y = 0; y < h; y++) counts.push(r.u16());
    const row = new Uint8Array(w);
    for (let y = 0; y < h; y++) {
      unpackBits(r, row, counts[y]);
      out.set(row, y * w);
    }
  } else {
    r.o = start + len;
    return null;
  }
  r.o = start + len;
  return out;
}

export async function readPsd(file: Blob): Promise<{ width: number; height: number; layers: Layer[]; warning: string }> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const r = new Reader(buf, new DataView(buf.buffer));
  if (r.str(4) !== '8BPS') throw new Error('This is not a PSD file.');
  const version = r.u16();
  if (version !== 1) throw new Error('Large-document PSB files are not supported.');
  r.o += 6;
  const channels = r.u16();
  const H = r.u32();
  const W = r.u32();
  const depth = r.u16();
  const mode = r.u16();
  if (depth !== 8 || mode !== 3) throw new Error('Only 8-bit RGB PSD files can be opened.');
  r.skip();
  r.skip();
  const lmEnd = r.u32() + r.o;
  const doc = { width: W, height: H };
  const flat: { layer: Layer; divider: number }[] = [];
  let warning = '';
  if (lmEnd > r.o + 4) {
    const liLen = r.u32();
    const liEnd = r.o + liLen;
    if (liLen > 0) {
      const count = Math.abs(r.i16());
      const recs: { top: number; left: number; bottom: number; right: number; chans: { id: number; len: number }[]; key: string; opacity: number; clip: number; flags: number; name: string; divider: number }[] = [];
      for (let i = 0; i < count; i++) {
        const top = r.i32();
        const left = r.i32();
        const bottom = r.i32();
        const right = r.i32();
        const n = r.u16();
        const chans = Array.from({ length: n }, () => ({ id: r.i16(), len: r.u32() }));
        r.str(4);
        const key = r.str(4);
        const opacity = r.u8();
        const clip = r.u8();
        const flags = r.u8();
        r.u8();
        const extraEnd = r.u32() + r.o;
        r.skip();
        r.skip();
        const nlen = r.u8();
        let name = r.str(nlen);
        r.o += (4 - ((nlen + 1) % 4)) % 4;
        let divider = 0;
        while (r.o + 12 <= extraEnd) {
          const sig = r.str(4);
          if (sig !== '8BIM' && sig !== '8B64') break;
          const k = r.str(4);
          const len = r.u32();
          const end = r.o + len;
          if (k === 'luni') {
            const chars = r.u32();
            let s = '';
            for (let c = 0; c < chars; c++) s += String.fromCharCode(r.u16());
            name = s || name;
          } else if (k === 'lsct') divider = r.u32();
          r.o = end + (len % 2);
        }
        r.o = extraEnd;
        recs.push({ top, left, bottom, right, chans, key, opacity, clip, flags, name, divider });
      }
      for (const rec of recs) {
        const w = rec.right - rec.left;
        const h = rec.bottom - rec.top;
        const layer = newLayer(doc, rec.name || 'Layer', rec.divider === 1 || rec.divider === 2 ? 'group' : 'paint');
        layer.opacity = rec.opacity / 255;
        layer.clip = rec.clip === 1;
        layer.visible = !(rec.flags & 2);
        layer.blend = (Object.entries(PSD_KEYS).find(([, v]) => v === rec.key)?.[0] as Blend) ?? 'normal';
        const data: Record<number, Uint8Array | null> = {};
        for (const c of rec.chans) {
          const isMask = c.id === -2 || c.id === -3;
          data[c.id] = w > 0 && h > 0 && !isMask ? readChannel(r, w, h, c.len) : (r.o += c.len, null);
        }
        if (w > 0 && h > 0 && layer.kind === 'paint') {
          if ([0, 1, 2].some(id => data[id] === null)) warning = 'Some layers use compression this app cannot read and were left empty.';
          else {
            const img = new ImageData(w, h);
            for (let i = 0; i < w * h; i++) {
              img.data[i * 4] = data[0]![i];
              img.data[i * 4 + 1] = data[1]![i];
              img.data[i * 4 + 2] = data[2]![i];
              img.data[i * 4 + 3] = data[-1] ? data[-1]![i] : 255;
            }
            ctx2d(layer.canvas).putImageData(img, rec.left, rec.top);
          }
        }
        flat.push({ layer, divider: rec.divider });
      }
      r.o = liEnd;
    }
  }
  const root: Layer[] = [];
  const stack: Layer[][] = [root];
  for (const { layer, divider } of flat) {
    if (divider === 3) {
      stack.push([]);
      continue;
    }
    if (layer.kind === 'group') {
      const kids = stack.length > 1 ? (stack.pop() as Layer[]) : [];
      layer.children = kids;
    }
    stack[stack.length - 1].push(layer);
  }
  if (!root.length) {
    r.o = lmEnd;
    const comp = r.u16();
    const layer = newLayer(doc, 'Background');
    const img = new ImageData(W, H);
    const n = W * H;
    const planes: Uint8Array[] = [];
    if (comp === 1) {
      const counts: number[] = [];
      for (let i = 0; i < H * channels; i++) counts.push(r.u16());
      for (let ch = 0; ch < channels; ch++) {
        const plane = new Uint8Array(n);
        const row = new Uint8Array(W);
        for (let y = 0; y < H; y++) {
          unpackBits(r, row, counts[ch * H + y]);
          plane.set(row, y * W);
        }
        planes.push(plane);
      }
    } else {
      for (let ch = 0; ch < channels; ch++) {
        planes.push(buf.slice(r.o, r.o + n));
        r.o += n;
      }
    }
    for (let i = 0; i < n; i++) {
      img.data[i * 4] = planes[0][i];
      img.data[i * 4 + 1] = planes[1][i];
      img.data[i * 4 + 2] = planes[2][i];
      img.data[i * 4 + 3] = planes[3] ? planes[3][i] : 255;
    }
    ctx2d(layer.canvas).putImageData(img, 0, 0);
    root.push(layer);
  }
  return { width: W, height: H, layers: root, warning };
}

export async function writePdf(flat: HTMLCanvasElement, dpi: number): Promise<Blob> {
  const jpeg = await new Promise<Blob>((res, rej) => {
    const c = makeCanvas(flat.width, flat.height);
    const g = ctx2d(c);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(flat, 0, 0);
    c.toBlob(b => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', 0.92);
  });
  const img = new Uint8Array(await jpeg.arrayBuffer());
  const pw = (flat.width / dpi) * 72;
  const ph = (flat.height / dpi) * 72;
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let len = 0;
  const add = (b: Uint8Array | string): void => {
    const u = typeof b === 'string' ? enc.encode(b) : b;
    parts.push(u);
    len += u.length;
  };
  add('%PDF-1.4\n%\xff\xff\xff\xff\n');
  const obj = (n: number, body: string | (() => void)): void => {
    offsets[n] = len;
    add(`${n} 0 obj\n`);
    if (typeof body === 'string') add(body);
    else body();
    add('\nendobj\n');
  };
  const content = `q ${pw.toFixed(2)} 0 0 ${ph.toFixed(2)} 0 0 cm /Im0 Do Q`;
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, () => {
    add(`<< /Type /XObject /Subtype /Image /Width ${flat.width} /Height ${flat.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`);
    add(img);
    add('\nendstream');
  });
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = len;
  add(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
  add(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}

function quantize(data: Uint8ClampedArray, maxColors: number): number[][] {
  const pts: number[][] = [];
  const step = Math.max(1, Math.floor(data.length / 4 / 40000));
  for (let i = 0; i < data.length; i += 4 * step) if (data[i + 3] >= 128) pts.push([data[i], data[i + 1], data[i + 2]]);
  if (!pts.length) return [[0, 0, 0]];
  const boxes: number[][][] = [pts];
  while (boxes.length < maxColors) {
    let bi = -1;
    let bestRange = -1;
    let bestCh = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let mn = 255;
        let mx = 0;
        for (const p of b) {
          mn = Math.min(mn, p[ch]);
          mx = Math.max(mx, p[ch]);
        }
        if (mx - mn > bestRange) {
          bestRange = mx - mn;
          bi = i;
          bestCh = ch;
        }
      }
    });
    if (bi < 0 || bestRange <= 0) break;
    const b = boxes[bi].sort((p, q) => p[bestCh] - q[bestCh]);
    const mid = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
  }
  return boxes.map(b => [0, 1, 2].map(ch => Math.round(b.reduce((s, p) => s + p[ch], 0) / b.length)));
}

function lzw(indices: Uint8Array, minCode: number): Uint8Array {
  const out: number[] = [];
  let cur = 0;
  let bits = 0;
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let size = minCode + 1;
  let next = eoi + 1;
  let dict = new Map<number, number>();
  const emit = (code: number): void => {
    cur |= code << bits;
    bits += size;
    while (bits >= 8) {
      out.push(cur & 255);
      cur >>>= 8;
      bits -= 8;
    }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const hit = dict.get(key);
    if (hit !== undefined) {
      prefix = hit;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << size && size < 12) size++;
    } else {
      emit(clear);
      dict = new Map();
      size = minCode + 1;
      next = eoi + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) out.push(cur & 255);
  return Uint8Array.from(out);
}

export function writeGif(frames: ImageData[], delaysMs: number[], loop: boolean, transparent: boolean): Blob {
  const w = new Writer();
  const W = frames[0].width;
  const H = frames[0].height;
  w.str('GIF89a');
  const le16 = (v: number): void => {
    w.u8(v & 255);
    w.u8(v >> 8);
  };
  le16(W);
  le16(H);
  w.u8(0);
  w.u8(0);
  w.u8(0);
  if (loop) {
    w.u8(0x21);
    w.u8(0xff);
    w.u8(11);
    w.str('NETSCAPE2.0');
    w.u8(3);
    w.u8(1);
    le16(0);
    w.u8(0);
  }
  frames.forEach((f, fi) => {
    const pal = quantize(f.data, transparent ? 255 : 256);
    const cache = new Map<number, number>();
    const idx = new Uint8Array(W * H);
    const T = pal.length;
    for (let i = 0; i < W * H; i++) {
      const r = f.data[i * 4];
      const g = f.data[i * 4 + 1];
      const b = f.data[i * 4 + 2];
      if (transparent && f.data[i * 4 + 3] < 128) {
        idx[i] = T;
        continue;
      }
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      let best = cache.get(key);
      if (best === undefined) {
        let bd = Infinity;
        best = 0;
        for (let p = 0; p < pal.length; p++) {
          const d = (pal[p][0] - r) ** 2 + (pal[p][1] - g) ** 2 + (pal[p][2] - b) ** 2;
          if (d < bd) {
            bd = d;
            best = p;
          }
        }
        cache.set(key, best);
      }
      idx[i] = best;
    }
    w.u8(0x21);
    w.u8(0xf9);
    w.u8(4);
    w.u8(transparent ? 0b1001 : 0b0100);
    le16(Math.round((delaysMs[fi] ?? 100) / 10));
    w.u8(transparent ? T : 0);
    w.u8(0);
    w.u8(0x2c);
    le16(0);
    le16(0);
    le16(W);
    le16(H);
    w.u8(0x80 | 7);
    for (let p = 0; p < 256; p++) {
      const c = pal[p] ?? [0, 0, 0];
      w.u8(c[0]);
      w.u8(c[1]);
      w.u8(c[2]);
    }
    w.u8(8);
    const data = lzw(idx, 8);
    for (let o = 0; o < data.length; o += 255) {
      const n = Math.min(255, data.length - o);
      w.u8(n);
      w.bytes(data.subarray(o, o + n));
    }
    w.u8(0);
  });
  w.u8(0x3b);
  return w.blob('image/gif');
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC[(c ^ p[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function writeApng(frames: ImageData[], delaysMs: number[], loop: boolean): Promise<Blob> {
  const W = frames[0].width;
  const H = frames[0].height;
  const parts: Uint8Array[] = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])];
  const be = (n: number): Uint8Array => Uint8Array.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  const be16 = (n: number): Uint8Array => Uint8Array.from([(n >>> 8) & 255, n & 255]);
  const chunk = (type: string, ...data: Uint8Array[]): void => {
    const t = new TextEncoder().encode(type);
    const len = data.reduce((s, d) => s + d.length, 0);
    parts.push(be(len), t, ...data, be(crc32([t, ...data])));
  };
  chunk('IHDR', be(W), be(H), Uint8Array.from([8, 6, 0, 0, 0]));
  chunk('acTL', be(frames.length), be(loop ? 0 : 1));
  let seq = 0;
  for (let i = 0; i < frames.length; i++) {
    const raw = new Uint8Array((W * 4 + 1) * H);
    for (let y = 0; y < H; y++) {
      raw[y * (W * 4 + 1)] = 0;
      raw.set(frames[i].data.subarray(y * W * 4, (y + 1) * W * 4), y * (W * 4 + 1) + 1);
    }
    const z = await deflate(raw);
    chunk('fcTL', be(seq++), be(W), be(H), be(0), be(0), be16(Math.round(delaysMs[i] ?? 100)), be16(1000), Uint8Array.from([0, 0]));
    if (i === 0) chunk('IDAT', z);
    else chunk('fdAT', be(seq++), z);
  }
  chunk('IEND');
  return new Blob(parts as BlobPart[], { type: 'image/png' });
}

export const VIDEO_TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

export function videoType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  return VIDEO_TYPES.find(t => MediaRecorder.isTypeSupported(t)) ?? '';
}

export async function recordFrames(draw: (i: number, g: CanvasRenderingContext2D) => void, count: number, fps: number, w: number, h: number, onProgress?: (p: number) => void): Promise<Blob> {
  const type = videoType();
  if (!type) throw new Error('This browser cannot record video.');
  const c = makeCanvas(w, h);
  c.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px';
  document.body.append(c);
  const g = ctx2d(c);
  draw(0, g);
  const stream = c.captureStream(fps);
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 12e6 });
  const chunks: Blob[] = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise<void>(r => (rec.onstop = () => r()));
  rec.start(250);
  const t0 = performance.now();
  for (let i = 0; i < count; i++) {
    draw(i, g);
    onProgress?.(i / count);
    const wait = t0 + ((i + 1) * 1000) / fps - performance.now();
    await new Promise(r => setTimeout(r, Math.max(0, wait)));
  }
  rec.stop();
  await done;
  stream.getTracks().forEach(t => t.stop());
  c.remove();
  return new Blob(chunks, { type: type.split(';')[0] });
}

export function imageLayer(doc: { width: number; height: number }, img: CanvasImageSource & { width: number; height: number }, name: string, fit: boolean): Layer {
  const layer = newLayer(doc, name);
  const g = ctx2d(layer.canvas);
  const s = fit ? Math.min(1, doc.width / img.width, doc.height / img.height) : 1;
  const w = img.width * s;
  const h = img.height * s;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, (doc.width - w) / 2, (doc.height - h) / 2, w, h);
  layer.id = uid();
  return layer;
}
