import type { App } from './app';
import type { Pt } from './engine';
import type { Mesh } from './mesh';

type M4 = Float32Array;

function perspective(fovy: number, aspect: number, near: number, far: number): M4 {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

function lookAt(eye: number[], center: number[], up: number[]): M4 {
  const z = eye.map((v, i) => v - center[i]);
  const zl = Math.hypot(...z);
  z.forEach((_, i) => (z[i] /= zl));
  const x = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]];
  const xl = Math.hypot(...x) || 1;
  x.forEach((_, i) => (x[i] /= xl));
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]), -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]), -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]), 1]);
}

function mul(a: M4, b: M4): M4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

const VS = `#version 300 es
in vec3 aPos;
in vec3 aNrm;
in vec2 aUv;
uniform mat4 uMvp;
out vec3 vNrm;
out vec2 vUv;
out vec3 vPos;
void main() {
  vNrm = aNrm;
  vUv = aUv;
  vPos = aPos;
  gl_Position = uMvp * vec4(aPos, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vNrm;
in vec2 vUv;
in vec3 vPos;
uniform sampler2D uTex;
uniform vec3 uLight;
uniform vec3 uEye;
uniform float uIntensity;
uniform float uAmbient;
out vec4 o;
void main() {
  vec3 n = normalize(vNrm);
  if (!gl_FrontFacing) n = -n;
  vec3 base = texture(uTex, vUv).rgb;
  float diff = max(dot(n, normalize(uLight)), 0.0);
  float fill = max(dot(n, normalize(vec3(-uLight.x, 0.4, -uLight.z))), 0.0) * 0.25;
  vec3 v = normalize(uEye - vPos);
  vec3 hlf = normalize(normalize(uLight) + v);
  float spec = pow(max(dot(n, hlf), 0.0), 40.0) * 0.18;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.12;
  vec3 c = base * (uAmbient + (diff + fill) * uIntensity) + vec3(spec + rim) * uIntensity;
  o = vec4(pow(c, vec3(1.0)), 1.0);
}`;

const PICK_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out uvec4 o;
void main() {
  o = uvec4(uint(clamp(vUv.x, 0.0, 1.0) * 65535.0), uint(clamp(vUv.y, 0.0, 1.0) * 65535.0), 1u, 0u);
}`;

const LINE_FS = `#version 300 es
precision highp float;
out vec4 o;
void main() { o = vec4(0.25, 0.55, 1.0, 0.55); }`;

interface Prog {
  p: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

export interface Lighting {
  az: number;
  el: number;
  intensity: number;
  ambient: number;
  wire: boolean;
}

export const defaultLighting = (): Lighting => ({ az: 40, el: 35, intensity: 0.9, ambient: 0.35, wire: false });

export class Model3D {
  readonly canvas = document.createElement('canvas');
  private readonly gl: WebGL2RenderingContext;
  private readonly shade: Prog;
  private readonly pickProg: Prog;
  private readonly lineProg: Prog;
  private vao: WebGLVertexArrayObject | null = null;
  private lineBuf: WebGLBuffer | null = null;
  private lineCount = 0;
  private count = 0;
  private readonly tex: WebGLTexture;
  private pickFb: WebGLFramebuffer | null = null;
  private pickTex: WebGLTexture | null = null;
  private pickDepth: WebGLRenderbuffer | null = null;
  private pickW = 0;
  private pickH = 0;
  private pickValid = false;
  yaw = 0.6;
  pitch = 0.25;
  dist = 3.2;
  panX = 0;
  panY = 0;
  orbitLock = false;
  private dirty = true;
  private texDirty = true;
  private raf = 0;
  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number; type: string; t0: number; moved: number }>();
  private mode: 'idle' | 'draw' | 'orbit' | 'pan' | 'gesture' | 'eyedrop' = 'idle';
  private lastUv: { u: number; v: number } | null = null;
  private gesture: { d0: number; c0: { x: number; y: number }; yaw: number; pitch: number; dist: number; panX: number; panY: number; t0: number; count: number; maxMove: number } | null = null;
  private holdTimer = 0;
  private penSeen = false;
  active = false;
  eyedropArmed = false;
  mesh: Mesh | null = null;
  onPicked: () => void = () => undefined;

  constructor(private readonly app: App) {
    this.canvas.className = 'p3d hidden';
    const gl = this.canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true, alpha: false });
    if (!gl) throw new Error('WebGL2 is not available for 3D painting.');
    this.gl = gl;
    const make = (fs: string, uniforms: string[]): Prog => {
      const sh = (t: number, src: string): WebGLShader => {
        const s = gl.createShader(t) as WebGLShader;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
        return s;
      };
      const p = gl.createProgram() as WebGLProgram;
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, 'aPos');
      gl.bindAttribLocation(p, 1, 'aNrm');
      gl.bindAttribLocation(p, 2, 'aUv');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
      return { p, u: Object.fromEntries(uniforms.map(n => [n, gl.getUniformLocation(p, n)])) };
    };
    this.shade = make(FS, ['uMvp', 'uTex', 'uLight', 'uEye', 'uIntensity', 'uAmbient']);
    this.pickProg = make(PICK_FS, ['uMvp']);
    this.lineProg = make(LINE_FS, ['uMvp']);
    this.tex = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.enable(gl.DEPTH_TEST);
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    this.canvas.addEventListener('pointerdown', e => this.down(e));
    this.canvas.addEventListener('pointermove', e => this.move(e));
    this.canvas.addEventListener('pointerup', e => this.up(e));
    this.canvas.addEventListener('pointercancel', e => this.up(e, true));
    this.canvas.addEventListener('wheel', e => this.wheel(e), { passive: false });
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    for (const ev of ['gesturestart', 'gesturechange', 'touchmove']) this.canvas.addEventListener(ev, e => e.preventDefault(), { passive: false });
    app.on(w => {
      if (w === 'render' || w === 'layers' || w === 'doc') this.texDirty = true;
      if (w === 'lighting') this.dirty = true;
    });
  }

  setMesh(m: Mesh | null): void {
    this.mesh = m;
    const gl = this.gl;
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.vao = null;
    if (!m) return;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const attr = (loc: number, data: Float32Array, size: number): void => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    attr(0, m.positions, 3);
    attr(1, m.normals, 3);
    attr(2, m.uvs, 2);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.STATIC_DRAW);
    this.count = m.indices.length;
    const edges = new Set<number>();
    const lines: number[] = [];
    const n = m.positions.length / 3;
    for (let i = 0; i < m.indices.length; i += 3)
      for (let k = 0; k < 3; k++) {
        const a = m.indices[i + k];
        const b = m.indices[i + ((k + 1) % 3)];
        const key = Math.min(a, b) * n + Math.max(a, b);
        if (edges.has(key) || lines.length > 600000) continue;
        edges.add(key);
        lines.push(a, b);
      }
    this.lineBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.lineBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(lines), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    this.lineCount = lines.length;
    gl.bindVertexArray(null);
    let r = 0;
    for (let i = 0; i < m.positions.length; i += 3) r = Math.max(r, Math.hypot(m.positions[i], m.positions[i + 1], m.positions[i + 2]));
    this.fitDist = Math.max(1.6, (r / Math.sin((19 * Math.PI) / 180)) * 1.1);
    this.resetView();
  }

  private fitDist = 3.2;

  resetView(): void {
    this.yaw = 0.6;
    this.pitch = 0.25;
    this.dist = this.fitDist;
    this.panX = 0;
    this.panY = 0;
    this.changed();
  }

  show(on: boolean): void {
    this.active = on;
    this.canvas.classList.toggle('hidden', !on);
    if (on) {
      this.texDirty = true;
      this.resize();
      this.loop();
    } else cancelAnimationFrame(this.raf);
  }

  private changed(): void {
    this.dirty = true;
    this.pickValid = false;
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.changed();
    }
  }

  private eye(): number[] {
    const cp = Math.cos(this.pitch);
    return [Math.sin(this.yaw) * cp * this.dist, Math.sin(this.pitch) * this.dist, Math.cos(this.yaw) * cp * this.dist];
  }

  private mvp(aspect: number): M4 {
    const view = lookAt(this.eye(), [0, 0, 0], [0, 1, 0]);
    const shift = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, this.panX, this.panY, 0, 1]);
    return mul(perspective((38 * Math.PI) / 180, aspect, 0.05, 50), mul(shift, view));
  }

  private loop = (): void => {
    if (!this.active) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.app.pendingRect) {
      this.app.pendingRect = null;
      this.texDirty = true;
    }
    if (this.texDirty) {
      this.upload();
      this.texDirty = false;
      this.dirty = true;
    }
    if (this.dirty) {
      this.dirty = false;
      this.draw();
    }
  };

  private upload(): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this.app.composite);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  draw(target?: { w: number; h: number }): void {
    const gl = this.gl;
    if (!this.vao || !this.mesh) return;
    const w = target?.w ?? this.canvas.width;
    const h = target?.h ?? this.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    const light = this.app.prefs.light;
    gl.clearColor(light ? 0.86 : 0.12, light ? 0.86 : 0.12, light ? 0.88 : 0.14, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const m = this.mvp(w / h);
    const L = this.app.doc.model?.light ?? defaultLighting();
    const az = (L.az * Math.PI) / 180;
    const el = (L.el * Math.PI) / 180;
    gl.useProgram(this.shade.p);
    gl.uniformMatrix4fv(this.shade.u.uMvp, false, m);
    gl.uniform3f(this.shade.u.uLight, Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    gl.uniform3fv(this.shade.u.uEye, this.eye());
    gl.uniform1f(this.shade.u.uIntensity, L.intensity);
    gl.uniform1f(this.shade.u.uAmbient, L.ambient);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.shade.u.uTex, 0);
    gl.bindVertexArray(this.vao);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    if (L.wire && this.lineBuf) {
      gl.useProgram(this.lineProg.p);
      gl.uniformMatrix4fv(this.lineProg.u.uMvp, false, m);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.lineBuf);
      gl.drawElements(gl.LINES, this.lineCount, gl.UNSIGNED_INT, 0);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  }

  snapshot(w: number, h: number): HTMLCanvasElement {
    const prevW = this.canvas.width;
    const prevH = this.canvas.height;
    this.canvas.width = w;
    this.canvas.height = h;
    this.upload();
    this.draw();
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    out.getContext('2d')?.drawImage(this.canvas, 0, 0);
    this.canvas.width = prevW;
    this.canvas.height = prevH;
    this.changed();
    return out;
  }

  turntable(w: number, h: number, frame: number, frames: number): HTMLCanvasElement {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.upload();
    }
    const yaw = this.yaw;
    this.yaw = yaw + (frame / frames) * Math.PI * 2;
    this.draw();
    this.yaw = yaw;
    return this.canvas;
  }

  endTurntable(): void {
    this.resize();
    this.changed();
  }

  private ensurePick(): void {
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (!this.pickFb || this.pickW !== w || this.pickH !== h) {
      if (this.pickFb) gl.deleteFramebuffer(this.pickFb);
      if (this.pickTex) gl.deleteTexture(this.pickTex);
      if (this.pickDepth) gl.deleteRenderbuffer(this.pickDepth);
      this.pickTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.pickTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16UI, w, h, 0, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.pickDepth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.pickDepth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      this.pickFb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pickTex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.pickDepth);
      this.pickW = w;
      this.pickH = h;
      this.pickValid = false;
    }
    if (this.pickValid || !this.vao) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFb);
    gl.viewport(0, 0, w, h);
    gl.clearBufferuiv(gl.COLOR, 0, new Uint32Array([0, 0, 0, 0]));
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.pickProg.p);
    gl.uniformMatrix4fv(this.pickProg.u.uMvp, false, this.mvp(w / h));
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.pickValid = true;
  }

  pick(clientX: number, clientY: number): { u: number; v: number } | null {
    this.ensurePick();
    const gl = this.gl;
    const r = this.canvas.getBoundingClientRect();
    const dpr = this.canvas.width / r.width;
    const x = Math.floor((clientX - r.left) * dpr);
    const y = this.canvas.height - 1 - Math.floor((clientY - r.top) * dpr);
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return null;
    const out = new Uint32Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFb);
    gl.readPixels(x, y, 1, 1, gl.RGBA_INTEGER, gl.UNSIGNED_INT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out[2] ? { u: out[0] / 65535, v: out[1] / 65535 } : null;
  }

  private docPt(e: PointerEvent, uv: { u: number; v: number }): Pt {
    const d = this.app.doc;
    const tilt = e.pointerType === 'pen' ? Math.min(1, Math.hypot(e.tiltX || 0, e.tiltY || 0) / 70) : 0;
    return { x: uv.u * d.width, y: uv.v * d.height, p: e.pointerType === 'pen' ? e.pressure || 0.5 : 1, tilt, t: e.timeStamp };
  }

  private sampleColor(e: PointerEvent): void {
    const gl = this.gl;
    const r = this.canvas.getBoundingClientRect();
    const dpr = this.canvas.width / r.width;
    const px = new Uint8Array(4);
    gl.readPixels(Math.floor((e.clientX - r.left) * dpr), this.canvas.height - 1 - Math.floor((e.clientY - r.top) * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const uv = this.pick(e.clientX, e.clientY);
    const texColor = uv ? this.app.sample(uv.u * this.app.doc.width, uv.v * this.app.doc.height) : null;
    this.app.setColor(texColor ?? [px[0] / 255, px[1] / 255, px[2] / 255]);
    this.onPicked();
  }

  private down(e: PointerEvent): void {
    if (e.pointerType === 'pen') this.penSeen = true;
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, type: e.pointerType, t0: performance.now(), moved: 0 });
    const touches = [...this.pointers.values()].filter(p => p.type === 'touch');
    if (touches.length >= 2) {
      if (this.mode === 'draw') this.app.cancelStroke();
      this.startGesture();
      return;
    }
    if (this.mode === 'gesture') return;
    const orbitTouch = e.pointerType === 'touch' && (this.orbitLock || this.penSeen || !this.app.prefs.touchPaint);
    if (e.button === 2 || e.button === 1 || (e.button === 0 && (this.orbitLock || e.shiftKey && e.altKey)) || orbitTouch) {
      this.mode = e.button === 1 || (e.button === 0 && e.shiftKey && e.altKey) ? 'pan' : 'orbit';
      if (orbitTouch) this.armHold(e);
      return;
    }
    if (e.altKey || this.eyedropArmed) {
      this.eyedropArmed = false;
      this.mode = 'eyedrop';
      this.sampleColor(e);
      return;
    }
    if (!['brush', 'smudge', 'erase', 'adjust'].includes(this.app.tool)) {
      this.mode = 'orbit';
      return;
    }
    const uv = this.pick(e.clientX, e.clientY);
    if (!uv) {
      this.mode = 'orbit';
      return;
    }
    if (!this.app.beginStroke(this.docPt(e, uv), undefined, e.pointerType)) {
      this.mode = 'idle';
      return;
    }
    this.lastUv = uv;
    this.mode = 'draw';
    if (e.pointerType === 'touch') this.armHold(e);
  }

  private armHold(e: PointerEvent): void {
    clearTimeout(this.holdTimer);
    const id = e.pointerId;
    this.holdTimer = window.setTimeout(() => {
      const p = this.pointers.get(id);
      if (!p || p.moved > 8 || this.pointers.size !== 1) return;
      if (this.mode === 'draw') this.app.cancelStroke();
      this.mode = 'eyedrop';
      this.sampleColor(new PointerEvent('pointermove', { clientX: p.x, clientY: p.y }));
    }, this.app.prefs.holdDelay);
  }

  private startGesture(): void {
    const ts = [...this.pointers.values()].filter(p => p.type === 'touch');
    const c = { x: (ts[0].x + ts[1].x) / 2, y: (ts[0].y + ts[1].y) / 2 };
    this.gesture = { d0: Math.hypot(ts[0].x - ts[1].x, ts[0].y - ts[1].y) || 1, c0: c, yaw: this.yaw, pitch: this.pitch, dist: this.dist, panX: this.panX, panY: this.panY, t0: this.gesture?.t0 ?? performance.now(), count: Math.max(this.gesture?.count ?? 0, ts.length), maxMove: this.gesture?.maxMove ?? 0 };
    this.mode = 'gesture';
    clearTimeout(this.holdTimer);
  }

  private move(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    p.moved = Math.max(p.moved, Math.hypot(p.x - p.sx, p.y - p.sy));
    if (this.mode === 'orbit') {
      this.yaw -= dx * 0.008;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + dy * 0.008));
      this.changed();
    } else if (this.mode === 'pan') {
      this.panX += (dx / this.canvas.clientHeight) * this.dist * 0.8;
      this.panY -= (dy / this.canvas.clientHeight) * this.dist * 0.8;
      this.changed();
    } else if (this.mode === 'gesture' && this.gesture) {
      const g = this.gesture;
      const ts = [...this.pointers.values()].filter(q => q.type === 'touch');
      for (const t of ts) g.maxMove = Math.max(g.maxMove, t.moved);
      if (ts.length < 2) return;
      const c = { x: (ts[0].x + ts[1].x) / 2, y: (ts[0].y + ts[1].y) / 2 };
      const d = Math.hypot(ts[0].x - ts[1].x, ts[0].y - ts[1].y);
      this.dist = Math.max(0.6, Math.min(30, (g.dist * g.d0) / Math.max(10, d)));
      this.yaw = g.yaw - (c.x - g.c0.x) * 0.008;
      this.pitch = Math.max(-1.45, Math.min(1.45, g.pitch + (c.y - g.c0.y) * 0.008));
      this.changed();
    } else if (this.mode === 'eyedrop') this.sampleColor(e);
    else if (this.mode === 'draw') {
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
      const list = events.length > 4 ? [events[Math.floor(events.length / 3)], events[Math.floor((2 * events.length) / 3)], events[events.length - 1]] : events.length ? events : [e];
      for (const ev of list) {
        const uv = this.pick(ev.clientX, ev.clientY);
        if (!uv) {
          this.lastUv = null;
          continue;
        }
        const pt = this.docPt(ev, uv);
        const jump = !this.lastUv || Math.hypot(uv.u - this.lastUv.u, uv.v - this.lastUv.v) > 0.06;
        if (jump) this.app.stroke?.jump(pt);
        else this.app.moveStroke([pt]);
        this.lastUv = uv;
      }
    }
  }

  private up(e: PointerEvent, cancelled = false): void {
    this.pointers.delete(e.pointerId);
    clearTimeout(this.holdTimer);
    if (this.mode === 'gesture') {
      if (![...this.pointers.values()].some(q => q.type === 'touch') && this.gesture) {
        const g = this.gesture;
        if (performance.now() - g.t0 < 320 && g.maxMove < 14 && this.app.prefs.fingerGestures) {
          if (g.count === 2) this.app.undo();
          else if (g.count === 3) this.app.redo();
        }
        this.gesture = null;
        this.mode = 'idle';
      }
      return;
    }
    if (this.mode === 'draw') {
      if (cancelled) this.app.cancelStroke();
      else this.app.endStroke();
    }
    if (this.mode === 'eyedrop') this.app.pushRecent();
    if (this.pointers.size === 0) this.mode = 'idle';
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) this.dist = Math.max(0.6, Math.min(30, this.dist * Math.exp(e.deltaY * 0.0015)));
    else this.yaw -= e.deltaX * 0.004;
    this.changed();
  }

  zoom(k: number): void {
    this.dist = Math.max(0.6, Math.min(30, this.dist / k));
    this.changed();
  }

}
