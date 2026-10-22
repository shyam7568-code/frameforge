const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const HEAD = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform vec2 uSize;
out vec4 o;
vec3 unp(vec4 c) { return c.a > 0.0 ? c.rgb / c.a : vec3(0.0); }
vec4 pre(vec3 c, float a) { return vec4(clamp(c, 0.0, 1.0) * a, a); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
`;

const PROGRAMS: Record<string, string> = {
  copy: `void main() { o = texture(uTex, vUv); }`,
  hsb: `uniform vec3 uP;
void main() {
  vec4 c = texture(uTex, vUv);
  vec3 h = rgb2hsv(unp(c));
  h.x = fract(h.x + uP.x);
  h.y = clamp(h.y * uP.y, 0.0, 1.0);
  vec3 rgb = hsv2rgb(h);
  rgb = uP.z >= 0.0 ? mix(rgb, vec3(1.0), uP.z * 0.7) : rgb * (1.0 + uP.z);
  o = pre(rgb, c.a);
}`,
  balance: `uniform vec3 uS; uniform vec3 uM; uniform vec3 uH;
void main() {
  vec4 c = texture(uTex, vUv);
  vec3 rgb = unp(c);
  float l = luma(rgb);
  float ws = 1.0 - smoothstep(0.0, 0.5, l);
  float wh = smoothstep(0.5, 1.0, l);
  float wm = 1.0 - ws - wh;
  rgb += (uS * ws + uM * wm + uH * wh) * 0.4;
  o = pre(rgb, c.a);
}`,
  lut: `uniform sampler2D uLut;
void main() {
  vec4 c = texture(uTex, vUv);
  vec3 rgb = unp(c);
  vec3 m = vec3(texture(uLut, vec2(rgb.r, 0.5)).a, texture(uLut, vec2(rgb.g, 0.5)).a, texture(uLut, vec2(rgb.b, 0.5)).a);
  vec3 r = vec3(texture(uLut, vec2(m.r, 0.5)).r, texture(uLut, vec2(m.g, 0.5)).g, texture(uLut, vec2(m.b, 0.5)).b);
  o = pre(r, c.a);
}`,
  gradmap: `uniform sampler2D uLut; uniform float uAmt;
void main() {
  vec4 c = texture(uTex, vUv);
  vec3 rgb = unp(c);
  vec3 g = texture(uLut, vec2(luma(rgb), 0.5)).rgb;
  o = pre(mix(rgb, g, uAmt), c.a);
}`,
  blur: `uniform vec2 uDir; uniform float uSigma;
void main() {
  if (uSigma < 0.3) { o = texture(uTex, vUv); return; }
  float step = max(1.0, uSigma * 3.0 / 24.0);
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int i = -24; i <= 24; i++) {
    float x = float(i) * step;
    float w = exp(-x * x / (2.0 * uSigma * uSigma));
    sum += texture(uTex, vUv + uDir * uTexel * x) * w;
    total += w;
  }
  o = sum / total;
}`,
  zoomblur: `uniform vec2 uCenter; uniform float uAmt;
void main() {
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 32; i++) {
    float t = float(i) / 31.0;
    sum += texture(uTex, mix(vUv, uCenter, t * uAmt));
  }
  o = sum / 32.0;
}`,
  noise: `uniform vec3 uP;
void main() {
  vec4 c = texture(uTex, vUv);
  vec2 p = vUv * uSize / max(1.0, uP.y);
  float n = vnoise(p) * 0.5 + vnoise(p * 2.1) * 0.3 + vnoise(p * 4.3) * 0.2;
  vec3 rgb = unp(c) + (n - 0.5) * uP.x;
  if (uP.z > 0.5) rgb += (vec3(vnoise(p + 13.0), vnoise(p + 29.0), vnoise(p + 41.0)) - 0.5) * uP.x * 0.6;
  o = pre(rgb, c.a);
}`,
  sharpen: `uniform float uAmt;
void main() {
  vec4 c = texture(uTex, vUv);
  vec4 n = texture(uTex, vUv + vec2(uTexel.x, 0.0)) + texture(uTex, vUv - vec2(uTexel.x, 0.0)) + texture(uTex, vUv + vec2(0.0, uTexel.y)) + texture(uTex, vUv - vec2(0.0, uTexel.y));
  vec4 r = c + (c * 4.0 - n) * uAmt;
  o = vec4(clamp(r.rgb, 0.0, r.a), c.a);
}`,
  threshold: `uniform float uT;
void main() {
  vec4 c = texture(uTex, vUv);
  vec3 rgb = unp(c);
  float k = smoothstep(uT, uT + 0.15, luma(rgb));
  o = pre(rgb * k, c.a * k);
}`,
  add: `uniform sampler2D uB; uniform float uAmt;
void main() {
  vec4 glow = texture(uTex, vUv);
  vec4 s = texture(uB, vUv);
  float a = max(s.a, min(1.0, glow.a * uAmt));
  o = vec4(min(s.rgb + glow.rgb * uAmt, vec3(a)), a);
}`,
  glitch: `uniform vec4 uP;
void main() {
  float mode = uP.x;
  float amt = uP.y;
  float block = max(2.0, uP.z);
  float seed = uP.w;
  vec2 uv = vUv;
  vec2 cell = floor(uv * uSize / block);
  if (mode < 0.5) {
    float r = hash(cell + seed);
    if (r < amt * 0.6) uv += (vec2(hash(cell + seed + 7.0), hash(cell + seed + 3.0)) - 0.5) * amt * 0.08;
    o = texture(uTex, uv);
  } else if (mode < 1.5) {
    uv.x += sin(uv.y * 40.0 + seed) * amt * 0.02;
    uv.y += sin(uv.x * 25.0 + seed * 1.7) * amt * 0.01;
    o = texture(uTex, uv);
  } else if (mode < 2.5) {
    float row = floor(uv.y * uSize.y / block);
    float r = hash(vec2(row, seed));
    if (r < amt * 0.5) uv.x += (hash(vec2(row, seed + 9.0)) - 0.5) * amt * 0.2;
    vec4 c = texture(uTex, uv);
    o = vec4(texture(uTex, uv + vec2(amt * 0.01, 0.0)).r, c.g, texture(uTex, uv - vec2(amt * 0.01, 0.0)).b, c.a);
  } else {
    vec2 d = (uv - 0.5) * amt * 0.04;
    vec4 c = texture(uTex, uv);
    o = vec4(texture(uTex, uv + d).r, c.g, texture(uTex, uv - d).b, c.a);
  }
}`,
  halftone: `uniform vec2 uP;
vec2 rot(vec2 v, float a) { return vec2(cos(a) * v.x - sin(a) * v.y, sin(a) * v.x + cos(a) * v.y); }
float dotAt(vec2 px, float ang, float val) {
  vec2 r = rot(px, ang);
  vec2 cell = fract(r / uP.y) - 0.5;
  return 1.0 - smoothstep(0.0, 0.08, length(cell) - sqrt(max(val, 0.0)) * 0.55);
}
void main() {
  vec4 c = texture(uTex, vUv);
  vec3 rgb = unp(c);
  vec2 px = vUv * uSize;
  if (uP.x < 0.5) {
    vec3 cmy = 1.0 - rgb;
    float k = min(cmy.r, min(cmy.g, cmy.b));
    vec3 inkc = vec3(dotAt(px, 0.26, cmy.r), dotAt(px, 1.31, cmy.g), dotAt(px, 0.0, cmy.b));
    float inkk = dotAt(px, 0.79, k);
    vec3 outc = (1.0 - inkc) * (1.0 - inkk);
    o = pre(outc, c.a);
  } else if (uP.x < 1.5) {
    float l = luma(rgb);
    float d = dotAt(px, 0.79, 1.0 - l);
    o = pre(mix(vec3(1.0), rgb * 0.6, d), c.a);
  } else {
    float l = luma(rgb);
    float d = dotAt(px, 0.79, 1.0 - l);
    o = pre(vec3(1.0 - d), c.a);
  }
}`,
  chroma: `uniform vec3 uP;
void main() {
  vec2 d = (vUv - uP.xy) * uP.z * 0.03;
  vec4 c = texture(uTex, vUv);
  vec4 r = texture(uTex, vUv + d);
  vec4 b = texture(uTex, vUv - d);
  o = vec4(r.r, c.g, b.b, max(c.a, max(r.a, b.a)));
}`,
  displace: `uniform sampler2D uDisp;
void main() {
  vec2 d = texture(uDisp, vec2(vUv.x, 1.0 - vUv.y)).rg;
  o = texture(uTex, vUv + vec2(d.x, -d.y));
}`,
  invert: `void main() { vec4 c = texture(uTex, vUv); o = pre(1.0 - unp(c), c.a); }`,
};

interface Prog {
  p: WebGLProgram;
  u: Map<string, WebGLUniformLocation | null>;
}

export type Uniforms = Record<string, number | number[] | WebGLTexture | 'src'>;

export class Filters {
  readonly canvas = document.createElement('canvas');
  private readonly gl: WebGL2RenderingContext;
  private readonly progs = new Map<string, Prog>();
  private tex: WebGLTexture[] = [];
  private fbs: WebGLFramebuffer[] = [];
  private w = 0;
  private h = 0;

  constructor() {
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, alpha: true, antialias: false });
    if (!gl) throw new Error('WebGL2 is not available.');
    this.gl = gl;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.disable(gl.BLEND);
  }

  private program(name: string): Prog {
    let pr = this.progs.get(name);
    if (pr) return pr;
    const gl = this.gl;
    const sh = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type) as WebGLShader;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`${name}: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram() as WebGLProgram;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, HEAD + PROGRAMS[name]));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    pr = { p, u: new Map() };
    this.progs.set(name, pr);
    return pr;
  }

  private texture(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private size(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    this.canvas.width = w;
    this.canvas.height = h;
    this.tex.forEach(t => gl.deleteTexture(t));
    this.fbs.forEach(f => gl.deleteFramebuffer(f));
    this.tex = [0, 1, 2].map(() => {
      const t = this.texture();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      return t;
    });
    this.fbs = this.tex.map(t => {
      const f = gl.createFramebuffer() as WebGLFramebuffer;
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return f;
    });
    this.w = w;
    this.h = h;
  }

  lutTexture(data: Uint8Array): WebGLTexture {
    const gl = this.gl;
    const t = this.texture();
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    return t;
  }

  dispTexture(field: Float32Array, w: number, h: number, prev?: WebGLTexture): WebGLTexture {
    const gl = this.gl;
    const t = prev ?? this.texture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, w, h, 0, gl.RG, gl.FLOAT, field);
    return t;
  }

  release(t: WebGLTexture): void {
    this.gl.deleteTexture(t);
  }

  run(src: TexImageSource & { width: number; height: number }, passes: { prog: string; uniforms?: Uniforms; input?: 'src' | 'prev' | number }[], keep?: number): HTMLCanvasElement {
    const gl = this.gl;
    const w = src.width;
    const h = src.height;
    this.size(w, h);
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[2]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    let input = this.tex[2];
    let flip = 0;
    passes.forEach((pass, i) => {
      const last = i === passes.length - 1;
      const pr = this.program(pass.prog);
      gl.useProgram(pr.p);
      const loc = (n: string): WebGLUniformLocation | null => {
        if (!pr.u.has(n)) pr.u.set(n, gl.getUniformLocation(pr.p, n));
        return pr.u.get(n) ?? null;
      };
      const tin = pass.input === 'src' ? this.tex[2] : typeof pass.input === 'number' ? this.tex[pass.input] : input;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tin);
      gl.uniform1i(loc('uTex'), 0);
      gl.uniform2f(loc('uTexel'), 1 / w, 1 / h);
      gl.uniform2f(loc('uSize'), w, h);
      let unit = 1;
      for (const [k, v] of Object.entries(pass.uniforms ?? {})) {
        const l = loc(k);
        if (v === 'src' || v instanceof WebGLTexture) {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, v === 'src' ? this.tex[2] : v);
          gl.uniform1i(l, unit++);
        } else if (typeof v === 'number') gl.uniform1f(l, v);
        else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
        else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
        else if (v.length === 4) gl.uniform4f(l, v[0], v[1], v[2], v[3]);
      }
      const toScreen = last && keep === undefined;
      const outIdx = keep !== undefined && last ? keep : flip;
      gl.bindFramebuffer(gl.FRAMEBUFFER, toScreen ? null : this.fbs[outIdx]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (!toScreen) {
        input = this.tex[outIdx];
        flip = 1 - flip;
      }
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this.canvas;
  }

  blurPasses(sigma: number): { prog: string; uniforms: Uniforms }[] {
    const passes: { prog: string; uniforms: Uniforms }[] = [];
    let remaining = sigma;
    while (remaining > 0.3) {
      const s = Math.min(remaining, 40);
      passes.push({ prog: 'blur', uniforms: { uDir: [1, 0], uSigma: s } }, { prog: 'blur', uniforms: { uDir: [0, 1], uSigma: s } });
      remaining = Math.sqrt(Math.max(0, remaining * remaining - s * s));
    }
    return passes.length ? passes : [{ prog: 'copy', uniforms: {} }];
  }
}

let shared: Filters | null = null;

export function filters(): Filters {
  shared ??= new Filters();
  return shared;
}

export function curveLut(points: Record<'m' | 'r' | 'g' | 'b', [number, number][]>): Uint8Array {
  const evalCurve = (pts: [number, number][]): Float32Array => {
    const p = [...pts].sort((a, b) => a[0] - b[0]);
    const out = new Float32Array(256);
    const n = p.length;
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = p[Math.max(0, i - 1)];
      const b = p[Math.min(n - 1, i + 1)];
      d[i] = b[0] - a[0] > 0 ? (b[1] - a[1]) / (b[0] - a[0]) : 0;
    }
    for (let x = 0; x < 256; x++) {
      const t = x / 255;
      let k = 0;
      while (k < n - 2 && t > p[k + 1][0]) k++;
      const [x0, y0] = p[k];
      const [x1, y1] = p[Math.min(n - 1, k + 1)];
      const hgt = x1 - x0 || 1;
      const s = Math.min(1, Math.max(0, (t - x0) / hgt));
      const h00 = 2 * s ** 3 - 3 * s ** 2 + 1;
      const h10 = s ** 3 - 2 * s ** 2 + s;
      const h01 = -2 * s ** 3 + 3 * s ** 2;
      const h11 = s ** 3 - s ** 2;
      out[x] = Math.min(1, Math.max(0, h00 * y0 + h10 * hgt * d[k] + h01 * y1 + h11 * hgt * d[Math.min(n - 1, k + 1)]));
    }
    return out;
  };
  const m = evalCurve(points.m);
  const r = evalCurve(points.r);
  const g = evalCurve(points.g);
  const b = evalCurve(points.b);
  const lut = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    lut[i * 4] = r[i] * 255;
    lut[i * 4 + 1] = g[i] * 255;
    lut[i * 4 + 2] = b[i] * 255;
    lut[i * 4 + 3] = m[i] * 255;
  }
  return lut;
}

export function gradientLut(stops: { at: number; color: string }[]): Uint8Array {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 1;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grad = g.createLinearGradient(0, 0, 256, 0);
  stops.forEach(s => grad.addColorStop(s.at, s.color));
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 1);
  return new Uint8Array(g.getImageData(0, 0, 256, 1).data.buffer);
}
