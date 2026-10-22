import { ctx2d, makeCanvas } from './doc';

export interface Mesh {
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

interface Part {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  material: string;
}

interface MaterialInfo {
  color: [number, number, number, number];
  image: Blob | null;
}

export interface ImportedModel {
  mesh: Mesh;
  texture: HTMLCanvasElement;
}

export const PRIMITIVES = ['Sphere', 'Cube', 'Cylinder', 'Cone', 'Torus', 'Plane'] as const;
export type Primitive = (typeof PRIMITIVES)[number];

function computeNormals(pos: ArrayLike<number>, idx: ArrayLike<number>): Float32Array {
  const n = new Float32Array(pos.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3;
    const b = idx[i + 1] * 3;
    const c = idx[i + 2] * 3;
    const ux = pos[b] - pos[a];
    const uy = pos[b + 1] - pos[a + 1];
    const uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a];
    const vy = pos[c + 1] - pos[a + 1];
    const vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) {
      n[k] += nx;
      n[k + 1] += ny;
      n[k + 2] += nz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l;
    n[i + 1] /= l;
    n[i + 2] /= l;
  }
  return n;
}

function finish(name: string, positions: number[], uvs: number[], indices: number[], normals?: number[]): Mesh {
  const pos = new Float32Array(positions);
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    min = min.map((m, k) => Math.min(m, pos[i + k]));
    max = max.map((m, k) => Math.max(m, pos[i + k]));
  }
  const c = min.map((m, k) => (m + max[k]) / 2);
  const s = 2 / Math.max(1e-6, ...max.map((m, k) => m - min[k]));
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) pos[i + k] = (pos[i + k] - c[k]) * s;
  const idx = new Uint32Array(indices);
  const nrm = normals && normals.length === positions.length ? new Float32Array(normals) : computeNormals(pos, idx);
  return { name, positions: pos, normals: nrm, uvs: new Float32Array(uvs), indices: idx };
}

export function primitive(kind: Primitive): Mesh {
  const P: number[] = [];
  const U: number[] = [];
  const I: number[] = [];
  const N: number[] = [];
  const grid = (seg: number, rings: number, f: (u: number, v: number) => [number, number, number], nf?: (u: number, v: number) => [number, number, number], uvRect = [0, 0, 1, 1]): void => {
    const base = P.length / 3;
    for (let j = 0; j <= rings; j++)
      for (let i = 0; i <= seg; i++) {
        const u = i / seg;
        const v = j / rings;
        P.push(...f(u, v));
        if (nf) N.push(...nf(u, v));
        U.push(uvRect[0] + u * uvRect[2], uvRect[1] + v * uvRect[3]);
      }
    for (let j = 0; j < rings; j++)
      for (let i = 0; i < seg; i++) {
        const a = base + j * (seg + 1) + i;
        const b = a + 1;
        const c = a + seg + 1;
        const d = c + 1;
        I.push(a, c, b, b, c, d);
      }
  };
  const TAU = Math.PI * 2;
  switch (kind) {
    case 'Sphere':
      grid(96, 48, (u, v) => [Math.cos(u * TAU) * Math.sin(v * Math.PI), Math.cos(v * Math.PI), Math.sin(u * TAU) * Math.sin(v * Math.PI)], (u, v) => [Math.cos(u * TAU) * Math.sin(v * Math.PI), Math.cos(v * Math.PI), Math.sin(u * TAU) * Math.sin(v * Math.PI)]);
      break;
    case 'Cube': {
      const faces: [number[], number[], number[]][] = [
        [[1, 0, 0], [0, 0, -1], [0, -1, 0]],
        [[-1, 0, 0], [0, 0, 1], [0, -1, 0]],
        [[0, 1, 0], [1, 0, 0], [0, 0, 1]],
        [[0, -1, 0], [1, 0, 0], [0, 0, -1]],
        [[0, 0, 1], [1, 0, 0], [0, -1, 0]],
        [[0, 0, -1], [-1, 0, 0], [0, -1, 0]],
      ];
      faces.forEach(([n, a, b], k) => {
        const rect = [(k % 3) / 3, Math.floor(k / 3) / 2, 1 / 3, 1 / 2];
        grid(16, 16, (u, v) => [n[0] + a[0] * (u * 2 - 1) + b[0] * (v * 2 - 1), n[1] + a[1] * (u * 2 - 1) + b[1] * (v * 2 - 1), n[2] + a[2] * (u * 2 - 1) + b[2] * (v * 2 - 1)], () => n as [number, number, number], [rect[0] + 0.005, rect[1] + 0.005, rect[2] - 0.01, rect[3] - 0.01]);
      });
      break;
    }
    case 'Cylinder':
    case 'Cone': {
      const top = kind === 'Cone' ? 0.001 : 1;
      grid(96, 24, (u, v) => {
        const r = top + (1 - top) * v;
        return [Math.cos(u * TAU) * r, 1 - v * 2, Math.sin(u * TAU) * r];
      }, undefined, [0, 0, 1, 0.66]);
      grid(48, 8, (u, v) => [Math.cos(u * TAU) * (1 - v), -1, Math.sin(u * TAU) * (1 - v)], () => [0, -1, 0], [0, 0.68, 0.5, 0.32]);
      if (kind === 'Cylinder') grid(48, 8, (u, v) => [Math.cos(-u * TAU) * (1 - v), 1, Math.sin(-u * TAU) * (1 - v)], () => [0, 1, 0], [0.5, 0.68, 0.5, 0.32]);
      break;
    }
    case 'Torus':
      grid(128, 48, (u, v) => {
        const a = u * TAU;
        const b = v * TAU;
        return [Math.cos(a) * (1 + 0.42 * Math.cos(b)), 0.42 * Math.sin(b), Math.sin(a) * (1 + 0.42 * Math.cos(b))];
      }, (u, v) => {
        const a = u * TAU;
        const b = v * TAU;
        return [Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)];
      });
      break;
    default:
      grid(32, 32, (u, v) => [u * 2 - 1, 0, v * 2 - 1], () => [0, 1, 0]);
  }
  return finish(kind, P, U, I, N.length === P.length ? N : undefined);
}

function buildParts(parts: Part[], materials: Map<string, MaterialInfo>, size: number, name: string): Promise<ImportedModel> {
  const used = parts.filter(p => p.indices.length);
  const keys = [...new Set(used.map(p => p.material))];
  const g = Math.ceil(Math.sqrt(Math.max(1, keys.length)));
  const tex = makeCanvas(size, size);
  const tg = ctx2d(tex);
  tg.fillStyle = '#d8d8d8';
  tg.fillRect(0, 0, size, size);
  const P: number[] = [];
  const U: number[] = [];
  const N: number[] = [];
  const I: number[] = [];
  let hasNormals = true;
  const tasks: Promise<void>[] = [];
  keys.forEach((key, k) => {
    const cx = k % g;
    const cy = Math.floor(k / g);
    const cell = size / g;
    const m = materials.get(key);
    const col = m?.color ?? [0.85, 0.85, 0.85, 1];
    tg.fillStyle = `rgb(${col.slice(0, 3).map(v => Math.round(v * 255)).join(',')})`;
    tg.fillRect(cx * cell, cy * cell, cell, cell);
    if (m?.image) {
      tasks.push(
        createImageBitmap(m.image)
          .then(bmp => {
            tg.save();
            tg.beginPath();
            tg.rect(cx * cell, cy * cell, cell, cell);
            tg.clip();
            tg.drawImage(bmp, cx * cell, cy * cell, cell, cell);
            if (col.slice(0, 3).some(v => v < 0.999)) {
              tg.globalCompositeOperation = 'multiply';
              tg.fillRect(cx * cell, cy * cell, cell, cell);
            }
            tg.restore();
            bmp.close();
          })
          .catch(() => undefined),
      );
    }
    for (const part of used.filter(p => p.material === key)) {
      const base = P.length / 3;
      P.push(...part.positions);
      if (part.normals.length !== part.positions.length) hasNormals = false;
      else N.push(...part.normals);
      for (let i = 0; i < part.uvs.length; i += 2) {
        let u = part.uvs[i];
        let v = part.uvs[i + 1];
        u = u - Math.floor(u);
        v = v - Math.floor(v);
        if (part.uvs[i] === 1) u = 1;
        if (part.uvs[i + 1] === 1) v = 1;
        U.push((cx + 0.002 + u * 0.996) / g, (cy + 0.002 + v * 0.996) / g);
      }
      for (const ix of part.indices) I.push(base + ix);
    }
  });
  return Promise.all(tasks).then(() => ({ mesh: finish(name, P, U, I, hasNormals ? N : undefined), texture: tex }));
}

function autoUv(part: Part): void {
  const p = part.positions;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i];
    const y = p[i + 1];
    const z = p[i + 2];
    const r = Math.hypot(x, y, z) || 1;
    part.uvs.push(0.5 + Math.atan2(z, x) / (2 * Math.PI), 0.5 - Math.asin(Math.max(-1, Math.min(1, y / r))) / Math.PI);
  }
}

export async function parseObj(files: File[], size: number): Promise<ImportedModel> {
  const objFile = files.find(f => /\.obj$/i.test(f.name));
  if (!objFile) throw new Error('Choose an .obj file (and its .mtl and textures if you have them).');
  const byName = new Map(files.map(f => [f.name.toLowerCase(), f]));
  const findFile = (path: string): File | undefined => byName.get(path.replace(/\\/g, '/').split('/').pop()!.toLowerCase());
  const text = await objFile.text();
  const v: number[] = [];
  const vt: number[] = [];
  const vn: number[] = [];
  const parts: Part[] = [];
  const materials = new Map<string, MaterialInfo>();
  let part: Part = { positions: [], normals: [], uvs: [], indices: [], material: 'default' };
  let map = new Map<string, number>();
  parts.push(part);
  const mtlNames: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const [tag, ...rest] = line.split(/\s+/);
    if (tag === 'v') v.push(+rest[0], +rest[1], +rest[2]);
    else if (tag === 'vt') vt.push(+rest[0], 1 - +(rest[1] ?? 0));
    else if (tag === 'vn') vn.push(+rest[0], +rest[1], +rest[2]);
    else if (tag === 'mtllib') mtlNames.push(rest.join(' '));
    else if (tag === 'usemtl') {
      part = { positions: [], normals: [], uvs: [], indices: [], material: rest.join(' ') };
      map = new Map();
      parts.push(part);
    } else if (tag === 'f') {
      const ids = rest.map(tok => {
        const hit = map.get(tok);
        if (hit !== undefined) return hit;
        const [a, b, c] = tok.split('/');
        const fix = (n: string, len: number): number => {
          const k = parseInt(n, 10);
          return k < 0 ? len + k : k - 1;
        };
        const pi = fix(a, v.length / 3);
        part.positions.push(v[pi * 3], v[pi * 3 + 1], v[pi * 3 + 2]);
        if (b) {
          const ti = fix(b, vt.length / 2);
          part.uvs.push(vt[ti * 2] ?? 0, vt[ti * 2 + 1] ?? 0);
        } else part.uvs.push(NaN, NaN);
        if (c) {
          const ni = fix(c, vn.length / 3);
          part.normals.push(vn[ni * 3], vn[ni * 3 + 1], vn[ni * 3 + 2]);
        }
        const id = part.positions.length / 3 - 1;
        map.set(tok, id);
        return id;
      });
      for (let i = 1; i < ids.length - 1; i++) part.indices.push(ids[0], ids[i], ids[i + 1]);
    }
  }
  if (!v.length) throw new Error('This OBJ file has no geometry.');
  for (const name of mtlNames) {
    const f = findFile(name) ?? files.find(x => /\.mtl$/i.test(x.name));
    if (!f) continue;
    let cur = '';
    for (const raw of (await f.text()).split('\n')) {
      const [tag, ...rest] = raw.trim().split(/\s+/);
      if (tag === 'newmtl') {
        cur = rest.join(' ');
        materials.set(cur, { color: [0.85, 0.85, 0.85, 1], image: null });
      } else if (tag === 'Kd' && cur) materials.get(cur)!.color = [+rest[0], +rest[1], +rest[2], 1];
      else if (tag === 'map_Kd' && cur) materials.get(cur)!.image = findFile(rest[rest.length - 1]) ?? null;
    }
  }
  const lone = files.find(f => /\.(png|jpe?g|webp)$/i.test(f.name));
  if (lone && ![...materials.values()].some(m => m.image)) {
    for (const p of parts) if (!materials.has(p.material)) materials.set(p.material, { color: [1, 1, 1, 1], image: lone });
    for (const m of materials.values()) m.image ??= lone;
  }
  for (const p of parts) {
    if (p.uvs.some(x => Number.isNaN(x))) {
      p.uvs = [];
      autoUv(p);
    }
    if (p.normals.length && p.normals.length !== p.positions.length) p.normals = [];
  }
  return buildParts(parts, materials, size, objFile.name.replace(/\.[^.]+$/, ''));
}

type Mat4 = number[];
const ident = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function trs(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]): Mat4 {
  const [x, y, z, w] = q;
  return [
    (1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0,
    2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0,
    2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

interface Gltf {
  accessors: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers: { uri?: string; byteLength: number }[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number; material?: number; mode?: number }[] }[];
  nodes?: { mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  scenes?: { nodes: number[] }[];
  scene?: number;
  materials?: { pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: { index: number } } }[];
  textures?: { source?: number }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string }[];
}

export async function parseGltf(files: File[], size: number): Promise<ImportedModel> {
  const main = files.find(f => /\.(glb|gltf)$/i.test(f.name));
  if (!main) throw new Error('Choose a .glb or .gltf file.');
  const byName = new Map(files.map(f => [f.name.toLowerCase(), f]));
  let json: Gltf;
  let bin: Uint8Array | null = null;
  const bytes = new Uint8Array(await main.arrayBuffer());
  const dv = new DataView(bytes.buffer);
  if (dv.getUint32(0, true) === 0x46546c67) {
    let o = 12;
    json = {} as Gltf;
    while (o < bytes.length) {
      const len = dv.getUint32(o, true);
      const type = dv.getUint32(o + 4, true);
      const chunk = bytes.subarray(o + 8, o + 8 + len);
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
      else if (type === 0x004e4942) bin = chunk;
      o += 8 + len;
    }
  } else json = JSON.parse(new TextDecoder().decode(bytes));
  const loadUri = async (uri: string): Promise<Uint8Array> => {
    if (uri.startsWith('data:')) return new Uint8Array(await (await fetch(uri)).arrayBuffer());
    const f = byName.get(decodeURIComponent(uri).split('/').pop()!.toLowerCase());
    if (!f) throw new Error(`Missing file "${uri}". Select it together with the .gltf file.`);
    return new Uint8Array(await f.arrayBuffer());
  };
  const buffers: Uint8Array[] = [];
  for (const b of json.buffers ?? []) buffers.push(b.uri ? await loadUri(b.uri) : (bin ?? new Uint8Array(b.byteLength)));
  const sizeOf: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const read = (index: number): number[] => {
    const a = json.accessors[index];
    const n = sizeOf[a.type];
    const out = new Array(a.count * n).fill(0);
    if (a.bufferView === undefined) return out;
    const bv = json.bufferViews[a.bufferView];
    const buf = buffers[bv.buffer];
    const view = new DataView(buf.buffer, buf.byteOffset);
    const comp = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType] ?? 4;
    const stride = bv.byteStride || comp * n;
    const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    for (let i = 0; i < a.count; i++)
      for (let k = 0; k < n; k++) {
        const o = base + i * stride + k * comp;
        let val: number;
        switch (a.componentType) {
          case 5126: val = view.getFloat32(o, true); break;
          case 5125: val = view.getUint32(o, true); break;
          case 5123: val = view.getUint16(o, true); if (a.normalized) val /= 65535; break;
          case 5122: val = view.getInt16(o, true); if (a.normalized) val = Math.max(val / 32767, -1); break;
          case 5121: val = view.getUint8(o); if (a.normalized) val /= 255; break;
          default: val = view.getInt8(o); if (a.normalized) val = Math.max(val / 127, -1);
        }
        out[i * n + k] = val;
      }
    return out;
  };
  const materials = new Map<string, MaterialInfo>();
  for (const [mi, m] of (json.materials ?? []).entries()) {
    const pbr = m.pbrMetallicRoughness ?? {};
    let image: Blob | null = null;
    const ti = pbr.baseColorTexture?.index;
    const src = ti !== undefined ? json.textures?.[ti]?.source : undefined;
    const img = src !== undefined ? json.images?.[src] : undefined;
    if (img) {
      if (img.bufferView !== undefined) {
        const bv = json.bufferViews[img.bufferView];
        const buf = buffers[bv.buffer];
        image = new Blob([buf.slice((bv.byteOffset ?? 0), (bv.byteOffset ?? 0) + bv.byteLength)], { type: img.mimeType ?? 'image/png' });
      } else if (img.uri) image = new Blob([await loadUri(img.uri)]);
    }
    const c = pbr.baseColorFactor ?? [1, 1, 1, 1];
    materials.set(String(mi), { color: [c[0], c[1], c[2], c[3]], image });
  }
  const parts: Part[] = [];
  const visit = (ni: number, parent: Mat4): void => {
    const node = json.nodes![ni];
    const local = node.matrix ? node.matrix : trs(node.translation, node.rotation, node.scale);
    const m = mul(parent, local);
    if (node.mesh !== undefined) {
      for (const prim of json.meshes[node.mesh].primitives) {
        if ((prim.mode ?? 4) !== 4) continue;
        const pos = read(prim.attributes.POSITION);
        const nrm = prim.attributes.NORMAL !== undefined ? read(prim.attributes.NORMAL) : [];
        const uv = prim.attributes.TEXCOORD_0 !== undefined ? read(prim.attributes.TEXCOORD_0) : [];
        const count = pos.length / 3;
        const part: Part = { positions: [], normals: [], uvs: [], indices: prim.indices !== undefined ? read(prim.indices) : Array.from({ length: count }, (_, i) => i), material: String(prim.material ?? 'default') };
        for (let i = 0; i < count; i++) {
          const [x, y, z] = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
          part.positions.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
          if (nrm.length) {
            const [a, b, c] = [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]];
            part.normals.push(m[0] * a + m[4] * b + m[8] * c, m[1] * a + m[5] * b + m[9] * c, m[2] * a + m[6] * b + m[10] * c);
          }
        }
        if (uv.length) part.uvs = uv;
        else autoUv(part);
        parts.push(part);
      }
    }
    for (const c of node.children ?? []) visit(c, m);
  };
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? (json.nodes ?? []).map((_, i) => i);
  if (json.nodes) for (const r of roots) visit(r, ident());
  else
    for (const mesh of json.meshes ?? [])
      for (const prim of mesh.primitives) {
        const pos = read(prim.attributes.POSITION);
        const part: Part = { positions: pos, normals: prim.attributes.NORMAL !== undefined ? read(prim.attributes.NORMAL) : [], uvs: prim.attributes.TEXCOORD_0 !== undefined ? read(prim.attributes.TEXCOORD_0) : [], indices: prim.indices !== undefined ? read(prim.indices) : Array.from({ length: pos.length / 3 }, (_, i) => i), material: String(prim.material ?? 'default') };
        if (!part.uvs.length) autoUv(part);
        parts.push(part);
      }
  if (!parts.length) throw new Error('This file has no triangle meshes.');
  return buildParts(parts, materials, size, main.name.replace(/\.[^.]+$/, ''));
}

export function packMesh(m: Mesh): Blob {
  const head = new TextEncoder().encode(JSON.stringify({ name: m.name, p: m.positions.length, n: m.normals.length, u: m.uvs.length, i: m.indices.length }));
  const pad = (4 - ((4 + head.length) % 4)) % 4;
  return new Blob([new Uint32Array([head.length + pad]), head, new Uint8Array(pad).fill(32), m.positions, m.normals, m.uvs, m.indices] as BlobPart[]);
}

export async function unpackMesh(b: Blob): Promise<Mesh> {
  const buf = await b.arrayBuffer();
  const len = new DataView(buf).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len))) as { name: string; p: number; n: number; u: number; i: number };
  let o = 4 + len;
  const take = <T extends Float32Array | Uint32Array>(C: new (b: ArrayBuffer, o: number, n: number) => T, n: number): T => {
    const out = new C(buf.slice(o, o + n * 4), 0, n);
    o += n * 4;
    return out;
  };
  return { name: head.name, positions: take(Float32Array, head.p), normals: take(Float32Array, head.n), uvs: take(Float32Array, head.u), indices: take(Uint32Array, head.i) };
}

async function png(c: HTMLCanvasElement): Promise<Uint8Array> {
  const b = await new Promise<Blob>((res, rej) => c.toBlob(x => (x ? res(x) : rej(new Error('encode'))), 'image/png'));
  return new Uint8Array(await b.arrayBuffer());
}

export async function writeGlb(m: Mesh, texture: HTMLCanvasElement): Promise<Blob> {
  const img = await png(texture);
  const align = (n: number): number => (n + 3) & ~3;
  const chunks = [m.positions, m.normals, m.uvs, m.indices].map(a => new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  const views: { buffer: number; byteOffset: number; byteLength: number; target?: number }[] = [];
  let off = 0;
  chunks.forEach((c, i) => {
    views.push({ buffer: 0, byteOffset: off, byteLength: c.length, target: i === 3 ? 34963 : 34962 });
    off = align(off + c.length);
  });
  views.push({ buffer: 0, byteOffset: off, byteLength: img.length });
  const total = align(off + img.length);
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3) {
    min = min.map((v, k) => Math.min(v, m.positions[i + k]));
    max = max.map((v, k) => Math.max(v, m.positions[i + k]));
  }
  const json = {
    asset: { version: '2.0', generator: 'Frameforge Paint' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: m.name }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ name: 'Painted', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.8 } }],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9987 }],
    images: [{ bufferView: 4, mimeType: 'image/png' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: m.positions.length / 3, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: m.normals.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: m.uvs.length / 2, type: 'VEC2' },
      { bufferView: 3, componentType: 5125, count: m.indices.length, type: 'SCALAR' },
    ],
    bufferViews: views,
    buffers: [{ byteLength: total }],
  };
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jpad = align(jsonBytes.length) - jsonBytes.length;
  jsonBytes = Uint8Array.from([...jsonBytes, ...new Array(jpad).fill(32)]);
  const binBytes = new Uint8Array(total);
  chunks.forEach((c, i) => binBytes.set(c, views[i].byteOffset));
  binBytes.set(img, views[4].byteOffset);
  const header = new DataView(new ArrayBuffer(12));
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, 12 + 8 + jsonBytes.length + 8 + binBytes.length, true);
  const ch = (len: number, type: number): ArrayBuffer => {
    const d = new DataView(new ArrayBuffer(8));
    d.setUint32(0, len, true);
    d.setUint32(4, type, true);
    return d.buffer;
  };
  return new Blob([header.buffer, ch(jsonBytes.length, 0x4e4f534a), jsonBytes, ch(binBytes.length, 0x004e4942), binBytes] as BlobPart[], { type: 'model/gltf-binary' });
}

export function writeObj(m: Mesh, name: string): { obj: string; mtl: string } {
  const lines = [`# Frameforge Paint`, `mtllib ${name}.mtl`, `o ${name}`];
  for (let i = 0; i < m.positions.length; i += 3) lines.push(`v ${m.positions[i].toFixed(6)} ${m.positions[i + 1].toFixed(6)} ${m.positions[i + 2].toFixed(6)}`);
  for (let i = 0; i < m.uvs.length; i += 2) lines.push(`vt ${m.uvs[i].toFixed(6)} ${(1 - m.uvs[i + 1]).toFixed(6)}`);
  for (let i = 0; i < m.normals.length; i += 3) lines.push(`vn ${m.normals[i].toFixed(5)} ${m.normals[i + 1].toFixed(5)} ${m.normals[i + 2].toFixed(5)}`);
  lines.push('usemtl Painted');
  for (let i = 0; i < m.indices.length; i += 3) {
    const [a, b, c] = [m.indices[i] + 1, m.indices[i + 1] + 1, m.indices[i + 2] + 1];
    lines.push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`);
  }
  return { obj: lines.join('\n'), mtl: `newmtl Painted\nKd 1 1 1\nmap_Kd ${name}.png\n` };
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

function crc(d: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(files: { name: string; data: Uint8Array }[], align64 = false): Blob {
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = new TextEncoder().encode(f.name);
    const headerLen = 30 + name.length;
    const pad = align64 ? (64 - ((offset + headerLen + 4) % 64)) % 64 : 0;
    const extraLen = align64 ? 4 + pad : 0;
    const local = new DataView(new ArrayBuffer(30));
    const sum = crc(f.data);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint32(14, sum, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, extraLen, true);
    parts.push(local.buffer, name);
    if (extraLen) {
      const extra = new DataView(new ArrayBuffer(extraLen));
      extra.setUint16(0, 0x1986, true);
      extra.setUint16(2, pad, true);
      parts.push(extra.buffer);
    }
    parts.push(f.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint32(16, sum, true);
    cd.setUint32(20, f.data.length, true);
    cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    const entry = new Uint8Array(46 + name.length);
    entry.set(new Uint8Array(cd.buffer));
    entry.set(name, 46);
    central.push(entry);
    offset += headerLen + extraLen + f.data.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

export async function writeObjZip(m: Mesh, texture: HTMLCanvasElement, name: string): Promise<Blob> {
  const { obj, mtl } = writeObj(m, name);
  const enc = new TextEncoder();
  return zipStore([
    { name: `${name}.obj`, data: enc.encode(obj) },
    { name: `${name}.mtl`, data: enc.encode(mtl) },
    { name: `${name}.png`, data: await png(texture) },
  ]);
}

export async function writeUsdz(m: Mesh, texture: HTMLCanvasElement): Promise<Blob> {
  const f = (a: Float32Array, n: number, flipV = false): string => {
    const out: string[] = [];
    for (let i = 0; i < a.length; i += n) {
      const v = Array.from(a.subarray(i, i + n));
      if (flipV) v[1] = 1 - v[1];
      out.push(`(${v.map(x => +x.toFixed(6)).join(', ')})`);
    }
    return out.join(', ');
  };
  const counts = new Array(m.indices.length / 3).fill(3).join(', ');
  const usda = `#usda 1.0
(
    defaultPrim = "Model"
    metersPerUnit = 1
    upAxis = "Y"
)

def Xform "Model" (
    kind = "component"
)
{
    def Mesh "Mesh"
    {
        uniform bool doubleSided = 1
        int[] faceVertexCounts = [${counts}]
        int[] faceVertexIndices = [${Array.from(m.indices).join(', ')}]
        point3f[] points = [${f(m.positions, 3)}]
        normal3f[] normals = [${f(m.normals, 3)}] (
            interpolation = "vertex"
        )
        texCoord2f[] primvars:st = [${f(m.uvs, 2, true)}] (
            interpolation = "vertex"
        )
        rel material:binding = </Model/Material>
        uniform token subdivisionScheme = "none"
    }

    def Material "Material"
    {
        token outputs:surface.connect = </Model/Material/Surface.outputs:surface>

        def Shader "Surface"
        {
            uniform token info:id = "UsdPreviewSurface"
            color3f inputs:diffuseColor.connect = </Model/Material/Texture.outputs:rgb>
            float inputs:roughness = 0.8
            float inputs:metallic = 0
            token outputs:surface
        }

        def Shader "Reader"
        {
            uniform token info:id = "UsdPrimvarReader_float2"
            token inputs:varname = "st"
            float2 outputs:result
        }

        def Shader "Texture"
        {
            uniform token info:id = "UsdUVTexture"
            asset inputs:file = @texture.png@
            float2 inputs:st.connect = </Model/Material/Reader.outputs:result>
            token inputs:wrapS = "repeat"
            token inputs:wrapT = "repeat"
            float3 outputs:rgb
        }
    }
}
`;
  return zipStore(
    [
      { name: 'model.usda', data: new TextEncoder().encode(usda) },
      { name: 'texture.png', data: await png(texture) },
    ],
    true,
  ).slice(0, undefined, 'model/vnd.usdz+zip');
}
