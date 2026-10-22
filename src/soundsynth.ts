const SR = 44100;
const TAU = Math.PI * 2;

export interface SynthSound {
  id: string;
  cat: string;
  label: string;
  dur: number;
  make: (s: Studio) => void;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type FilterType = 'lp' | 'hp' | 'bp' | 'peak';

class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(
    private readonly type: FilterType,
    f: number,
    q = 0.707,
    private readonly gain = 0,
  ) {
    this.set(f, q);
  }

  set(f: number, q = 0.707): void {
    const w = (TAU * Math.min(f, SR * 0.45)) / SR;
    const cs = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    let b0: number;
    let b1: number;
    let b2: number;
    let a0: number;
    let a1: number;
    let a2: number;
    if (this.type === 'lp') {
      b0 = (1 - cs) / 2;
      b1 = 1 - cs;
      b2 = b0;
      a0 = 1 + alpha;
      a1 = -2 * cs;
      a2 = 1 - alpha;
    } else if (this.type === 'hp') {
      b0 = (1 + cs) / 2;
      b1 = -(1 + cs);
      b2 = b0;
      a0 = 1 + alpha;
      a1 = -2 * cs;
      a2 = 1 - alpha;
    } else if (this.type === 'bp') {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cs;
      a2 = 1 - alpha;
    } else {
      const A = Math.pow(10, this.gain / 40);
      b0 = 1 + alpha * A;
      b1 = -2 * cs;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cs;
      a2 = 1 - alpha / A;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

class Noise {
  private b = [0, 0, 0, 0, 0, 0, 0];
  private brownV = 0;

  constructor(private readonly rnd: () => number) {}

  white(): number {
    return this.rnd() * 2 - 1;
  }

  pink(): number {
    const w = this.white();
    const b = this.b;
    b[0] = 0.99886 * b[0] + w * 0.0555179;
    b[1] = 0.99332 * b[1] + w * 0.0750759;
    b[2] = 0.969 * b[2] + w * 0.153852;
    b[3] = 0.8665 * b[3] + w * 0.3104856;
    b[4] = 0.55 * b[4] + w * 0.5329522;
    b[5] = -0.7616 * b[5] - w * 0.016898;
    const out = b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362;
    b[6] = w * 0.115926;
    return out * 0.11;
  }

  brown(): number {
    this.brownV = (this.brownV + 0.02 * this.white()) / 1.02;
    return this.brownV * 3.5;
  }
}

class Drift {
  private v = 0;
  private target = 0;
  private left = 0;

  constructor(
    private readonly rnd: () => number,
    private readonly rate: number,
  ) {
    this.v = rnd();
    this.target = rnd();
  }

  next(): number {
    if (this.left-- <= 0) {
      this.target = this.rnd();
      this.left = Math.round((SR / this.rate) * (0.5 + this.rnd()));
    }
    this.v += (this.target - this.v) * (this.rate / SR) * 3;
    return this.v;
  }
}

export class Studio {
  readonly L: Float32Array;
  readonly R: Float32Array;
  readonly n: number;
  readonly rnd: () => number;
  readonly noise: Noise;

  constructor(
    readonly dur: number,
    seed: number,
  ) {
    this.n = Math.round(dur * SR);
    this.L = new Float32Array(this.n);
    this.R = new Float32Array(this.n);
    this.rnd = mulberry(seed);
    this.noise = new Noise(this.rnd);
  }

  rand(a: number, b: number): number {
    return a + (b - a) * this.rnd();
  }

  bed(gain: number, fn: (i: number, t: number, ch: number) => number): void {
    for (let i = 0; i < this.n; i++) {
      const t = i / SR;
      this.L[i] += fn(i, t, 0) * gain;
      this.R[i] += fn(i, t, 1) * gain;
    }
  }

  stereoBed(gain: number, make: () => (i: number, t: number) => number): void {
    const l = make();
    const r = make();
    for (let i = 0; i < this.n; i++) {
      const t = i / SR;
      this.L[i] += l(i, t) * gain;
      this.R[i] += r(i, t) * gain;
    }
  }

  event(at: number, len: number, gain: number, pan: number, fn: (t: number, i: number) => number): void {
    const start = Math.round(at * SR);
    const count = Math.round(len * SR);
    const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
    const gr = gain * Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
    for (let k = 0; k < count; k++) {
      const i = start + k;
      if (i < 0) continue;
      if (i >= this.n) break;
      const v = fn(k / SR, k);
      this.L[i] += v * gl;
      this.R[i] += v * gr;
    }
  }

  scatter(rate: number, fn: (at: number) => void, from = 0, to = this.dur): void {
    let t = from;
    while (true) {
      t += -Math.log(1 - this.rnd()) / rate;
      if (t >= to) break;
      fn(t);
    }
  }

  reverb(mix: number, size = 1): void {
    const combs = [1557, 1617, 1491, 1422, 1277, 1356].map(d => Math.round(d * size));
    const process = (input: Float32Array, spread: number): Float32Array => {
      const out = new Float32Array(input.length);
      for (const d0 of combs) {
        const d = d0 + spread;
        const buf = new Float32Array(d);
        let idx = 0;
        let low = 0;
        for (let i = 0; i < input.length; i++) {
          const y = buf[idx];
          low = y * 0.6 + low * 0.4;
          buf[idx] = input[i] + low * 0.82;
          idx = (idx + 1) % d;
          out[i] += y / combs.length;
        }
      }
      for (const d of [225, 556]) {
        const buf = new Float32Array(d + spread);
        let idx = 0;
        for (let i = 0; i < out.length; i++) {
          const b = buf[idx];
          const y = -out[i] + b;
          buf[idx] = out[i] + b * 0.5;
          out[i] = y;
          idx = (idx + 1) % buf.length;
        }
      }
      return out;
    };
    const wl = process(this.L, 0);
    const wr = process(this.R, 23);
    for (let i = 0; i < this.n; i++) {
      this.L[i] = this.L[i] * (1 - mix * 0.5) + wl[i] * mix;
      this.R[i] = this.R[i] * (1 - mix * 0.5) + wr[i] * mix;
    }
  }

  bp(f: number, q = 1): Biquad {
    return new Biquad('bp', f, q);
  }

  lp(f: number, q = 0.707): Biquad {
    return new Biquad('lp', f, q);
  }

  hp(f: number, q = 0.707): Biquad {
    return new Biquad('hp', f, q);
  }

  drift(rate: number): Drift {
    return new Drift(this.rnd, rate);
  }
}

const decay = (t: number, d: number): number => Math.exp(-t / d);
const attack = (t: number, a: number, d: number): number => Math.min(1, t / a) * Math.exp(-Math.max(0, t - a) / d);
const bell = (t: number, len: number): number => Math.sin(Math.PI * Math.min(1, Math.max(0, t / len))) ** 2;

function burst(s: Studio, at: number, len: number, gain: number, pan: number, f: number, q: number): void {
  const flt = s.bp(f, q);
  s.event(at, len * 6, gain, pan, t => flt.run(s.noise.white() * decay(t, len)));
}

function drop(s: Studio, at: number, gain: number, pan: number, f0 = s.rand(700, 2200)): void {
  const rise = s.rand(1.3, 2.2);
  const len = s.rand(0.015, 0.05);
  let ph = 0;
  s.event(at, len * 5, gain, pan, t => {
    ph += (TAU * f0 * (1 + (rise - 1) * Math.min(1, t / len))) / SR;
    return Math.sin(ph) * decay(t, len);
  });
}

function chirp(s: Studio, at: number, base: number, gain: number, pan: number): void {
  const notes = Math.floor(s.rand(2, 7));
  let t0 = at;
  const sweep = s.rand(-1, 1) * base * 0.6;
  for (let k = 0; k < notes; k++) {
    const len = s.rand(0.05, 0.14);
    const f = base * s.rand(0.85, 1.25);
    let ph = 0;
    s.event(t0, len, gain, pan, t => {
      ph += (TAU * (f + sweep * (t / len) + Math.sin(TAU * 38 * t) * 180)) / SR;
      return Math.sin(ph) * bell(t, len);
    });
    t0 += len + s.rand(0.02, 0.09);
  }
}

function engineTone(s: Studio, at: number, len: number, gain: number, freq: (t: number) => number, pan: (t: number) => number, amp: (t: number) => number, cutoff = 900): void {
  const lp = s.lp(cutoff, 1.2);
  const rumble = s.lp(220);
  let ph = 0;
  const start = Math.round(at * SR);
  for (let k = 0; k < Math.round(len * SR); k++) {
    const i = start + k;
    if (i >= s.n) break;
    if (i < 0) continue;
    const t = k / SR;
    const f = freq(t);
    ph = (ph + f / SR) % 1;
    const saw = ph * 2 - 1;
    const pulse = ph < 0.18 ? 1 : 0;
    const v = lp.run(saw * 0.5 + pulse * 0.6 + s.noise.white() * 0.25) + rumble.run(s.noise.brown()) * 0.5;
    const a = amp(t) * gain;
    const p = pan(t);
    s.L[i] += v * a * Math.cos(((p + 1) * Math.PI) / 4) * Math.SQRT2;
    s.R[i] += v * a * Math.sin(((p + 1) * Math.PI) / 4) * Math.SQRT2;
  }
}

function pass(s: Studio, at: number, len: number, gain: number, dir: 1 | -1, pitch = s.rand(70, 110)): void {
  const tire = s.bp(900, 0.7);
  const mid = len / 2;
  engineTone(
    s,
    at,
    len,
    gain,
    t => pitch * (t < mid ? 1.07 : 0.93),
    t => dir * Math.tanh((t - mid) * 2.2),
    t => 1 / (1 + ((t - mid) * 1.6) ** 2),
  );
  s.event(at, len, gain * 1.6, 0, t => tire.run(s.noise.pink()) / (1 + ((t - mid) * 1.6) ** 2));
}

function voiceBabble(s: Studio, voices: number, gain: number, loud = false): void {
  const vowels = [
    [800, 1200],
    [400, 2000],
    [300, 2300],
    [500, 900],
    [350, 800],
    [650, 1700],
  ];
  for (let v = 0; v < voices; v++) {
    const f0 = s.rand(95, 230);
    const pan = s.rand(-0.9, 0.9);
    const g = gain * s.rand(0.4, 1);
    let t = s.rand(0, 1.5);
    while (t < s.dur) {
      const words = Math.floor(s.rand(3, 9));
      for (let w = 0; w < words && t < s.dur; w++) {
        const len = s.rand(0.09, loud ? 0.4 : 0.22);
        const [a, b] = vowels[Math.floor(s.rand(0, vowels.length))];
        const f1 = s.bp(a, 6);
        const f2 = s.bp(b, 8);
        const voiced = s.rnd() > 0.2;
        let ph = 0;
        const pitch = f0 * s.rand(0.9, 1.15);
        s.event(t, len, g, pan, (tt) => {
          ph = (ph + (pitch * (1 + 0.08 * Math.sin(TAU * 5 * tt))) / SR) % 1;
          const src = voiced ? (ph < 0.1 ? 1 : -0.11) + s.noise.white() * 0.05 : s.noise.white() * 0.4;
          return (f1.run(src) + f2.run(src) * 0.6) * bell(tt, len);
        });
        t += len + s.rand(0.01, 0.08);
      }
      t += s.rand(0.3, 2.2);
    }
  }
}

function claps(s: Studio, people: number, gain: number, env: (t: number) => number): void {
  for (let p = 0; p < people; p++) {
    const rate = s.rand(3, 5.5);
    const pan = s.rand(-1, 1);
    const f = s.rand(900, 2600);
    let t = s.rand(0, 0.4);
    while (t < s.dur) {
      const e = env(t);
      if (e > 0.02 && s.rnd() < e) burst(s, t, s.rand(0.004, 0.012), gain * s.rand(0.5, 1), pan, f * s.rand(0.85, 1.15), 1.2);
      t += (1 / rate) * s.rand(0.85, 1.15);
    }
  }
}

function bellTone(s: Studio, at: number, f: number, gain: number, pan: number, length = 6): void {
  const partials = [
    [0.5, 1, 1.2],
    [1, 0.8, 1],
    [1.19, 0.5, 0.7],
    [1.5, 0.45, 0.55],
    [2, 0.4, 0.5],
    [2.51, 0.25, 0.35],
    [3.01, 0.2, 0.25],
    [4.17, 0.12, 0.18],
  ];
  s.event(at, length, gain, pan, t => {
    let v = 0;
    for (const [ratio, amp, d] of partials) v += Math.sin(TAU * f * ratio * t) * amp * decay(t, d * length * 0.35);
    return v * Math.min(1, t * 400);
  });
}

function step(s: Studio, at: number, gain: number, pan: number, gravel: boolean): void {
  const thud = s.lp(140);
  s.event(at, 0.12, gain, pan, t => thud.run(s.noise.white()) * attack(t, 0.004, 0.035) * 3);
  if (gravel) for (let k = 0; k < 18; k++) burst(s, at + s.rand(0.01, 0.12), 0.003, gain * 0.25, pan, s.rand(1500, 5000), 1.5);
  else burst(s, at + 0.01, 0.02, gain * 0.25, pan, 2500, 0.8);
}

export const SYNTH: SynthSound[] = [
  {
    id: 'rain',
    cat: 'nature',
    label: 'Rain',
    dur: 20,
    make: s => {
      s.stereoBed(0.5, () => {
        const hp = s.hp(500);
        const lp = s.lp(7000);
        return () => lp.run(hp.run(s.noise.pink()));
      });
      s.scatter(90, at => burst(s, at, s.rand(0.002, 0.006), s.rand(0.05, 0.25), s.rand(-1, 1), s.rand(2000, 7000), 1.5));
      s.scatter(10, at => drop(s, at, 0.05, s.rand(-1, 1)));
    },
  },
  {
    id: 'heavy-rain',
    cat: 'nature',
    label: 'Heavy rain',
    dur: 20,
    make: s => {
      s.stereoBed(0.9, () => {
        const lp = s.lp(5000);
        return () => lp.run(s.noise.pink());
      });
      s.stereoBed(0.5, () => {
        const lp = s.lp(250);
        return () => lp.run(s.noise.brown());
      });
      s.scatter(260, at => burst(s, at, s.rand(0.002, 0.008), s.rand(0.05, 0.3), s.rand(-1, 1), s.rand(1500, 6000), 1.2));
    },
  },
  {
    id: 'thunderstorm',
    cat: 'nature',
    label: 'Thunderstorm',
    dur: 24,
    make: s => {
      s.stereoBed(0.45, () => {
        const lp = s.lp(5000);
        return () => lp.run(s.noise.pink());
      });
      for (const at of [1.5, 12]) {
        const crack = s.lp(4000);
        const rumble = s.lp(110);
        const mod = s.drift(3);
        s.event(at, 9, 1, s.rand(-0.4, 0.4), t => {
          crack.set(Math.max(200, 4000 * decay(t, 0.25)));
          const c = crack.run(s.noise.white()) * decay(t, 0.4) * 0.8;
          const r = rumble.run(s.noise.brown()) * attack(t, 0.15, 2.8) * (0.4 + mod.next()) * 6;
          return c + r;
        });
      }
    },
  },
  {
    id: 'wind',
    cat: 'nature',
    label: 'Wind',
    dur: 20,
    make: s => {
      const gust = s.drift(0.25);
      const values: number[] = [];
      for (let i = 0; i < s.n; i++) values.push(gust.next());
      s.stereoBed(1.6, () => {
        const bp = s.bp(500, 1.2);
        const whistle = s.bp(1400, 12);
        return i => {
          const g = values[i];
          if (i % 64 === 0) {
            bp.set(250 + g * 900, 1.2);
            whistle.set(1100 + g * 900, 14);
          }
          return (bp.run(s.noise.pink()) * (0.25 + g) + whistle.run(s.noise.white()) * g * g * 0.25) * 1.2;
        };
      });
    },
  },
  {
    id: 'fire',
    cat: 'nature',
    label: 'Campfire crackling',
    dur: 20,
    make: s => {
      const roar = s.drift(1.5);
      s.stereoBed(0.7, () => {
        const lp = s.lp(260);
        return () => lp.run(s.noise.brown()) * (0.4 + roar.next() * 0.6);
      });
      s.scatter(22, at => burst(s, at, s.rand(0.0008, 0.003), Math.pow(s.rnd(), 3) * 0.9 + 0.05, s.rand(-0.6, 0.6), s.rand(1500, 6000), 0.8));
      s.scatter(2.5, at => burst(s, at, 0.012, 0.45, s.rand(-0.5, 0.5), s.rand(600, 1600), 4));
    },
  },
  {
    id: 'crickets',
    cat: 'animals',
    label: 'Crickets at night',
    dur: 20,
    make: s => {
      s.stereoBed(0.05, () => {
        const lp = s.lp(600);
        return () => lp.run(s.noise.pink());
      });
      for (let c = 0; c < 5; c++) {
        const f = s.rand(4200, 5200);
        const pan = s.rand(-0.9, 0.9);
        const period = s.rand(0.45, 0.8);
        const pulses = Math.floor(s.rand(2, 5));
        const gain = s.rand(0.08, 0.2);
        for (let t = s.rand(0, 1); t < s.dur; t += period * s.rand(0.95, 1.05)) {
          for (let p = 0; p < pulses; p++) s.event(t + p * 0.03, 0.02, gain, pan, tt => Math.sin(TAU * f * tt) * bell(tt, 0.02));
        }
      }
    },
  },
  {
    id: 'birds',
    cat: 'animals',
    label: 'Birds chirping',
    dur: 20,
    make: s => {
      s.stereoBed(0.15, () => {
        const bp = s.bp(500, 0.6);
        return () => bp.run(s.noise.pink());
      });
      for (let b = 0; b < 4; b++) {
        const base = s.rand(2400, 5200);
        const pan = s.rand(-0.9, 0.9);
        s.scatter(0.45, at => chirp(s, at, base, s.rand(0.08, 0.22), pan));
      }
      s.reverb(0.15);
    },
  },
  {
    id: 'forest',
    cat: 'outdoors',
    label: 'Forest ambience',
    dur: 24,
    make: s => {
      const gust = s.drift(0.2);
      s.stereoBed(0.5, () => {
        const bp = s.bp(400, 0.8);
        return () => bp.run(s.noise.pink()) * (0.3 + gust.next() * 0.7);
      });
      for (let b = 0; b < 3; b++) {
        const base = s.rand(2000, 4500);
        const pan = s.rand(-0.9, 0.9);
        s.scatter(0.25, at => chirp(s, at, base, s.rand(0.05, 0.12), pan));
      }
      s.reverb(0.25, 1.2);
    },
  },
  {
    id: 'stream',
    cat: 'water',
    label: 'Babbling brook',
    dur: 20,
    make: s => {
      s.stereoBed(0.25, () => {
        const bp = s.bp(1800, 0.6);
        return () => bp.run(s.noise.pink());
      });
      s.scatter(120, at => drop(s, at, s.rand(0.03, 0.12), s.rand(-0.8, 0.8), s.rand(500, 1800)));
    },
  },
  {
    id: 'ocean',
    cat: 'water',
    label: 'Ocean waves',
    dur: 28,
    make: s => {
      const waves: [number, number][] = [];
      for (let t = 0; t < s.dur; t += s.rand(6, 9)) waves.push([t, s.rand(0.7, 1)]);
      const env = (t: number): number => {
        let v = 0.12;
        for (const [at, g] of waves) {
          const d = t - at;
          if (d < 0) continue;
          v += g * (d < 2.4 ? (d / 2.4) ** 2 : Math.exp(-(d - 2.4) / 2.2));
        }
        return v;
      };
      s.stereoBed(0.9, () => {
        const lp = s.lp(800);
        const hiss = s.hp(2500);
        return (i, t) => {
          const e = env(t);
          if (i % 64 === 0) lp.set(300 + e * 2600);
          return lp.run(s.noise.pink()) * e + hiss.run(s.noise.white()) * Math.max(0, e - 0.7) * 0.25;
        };
      });
    },
  },
  {
    id: 'waterfall',
    cat: 'water',
    label: 'Waterfall',
    dur: 20,
    make: s => {
      const mod = s.drift(0.6);
      s.stereoBed(0.9, () => {
        const lp = s.lp(3500);
        const low = s.lp(180);
        return () => (lp.run(s.noise.pink()) + low.run(s.noise.brown()) * 0.6) * (0.85 + mod.next() * 0.15);
      });
    },
  },
  {
    id: 'drips',
    cat: 'water',
    label: 'Cave drips',
    dur: 16,
    make: s => {
      s.scatter(1.6, at => drop(s, at, s.rand(0.3, 0.6), s.rand(-0.8, 0.8), s.rand(600, 1500)));
      s.reverb(0.6, 1.6);
    },
  },
  {
    id: 'underwater',
    cat: 'water',
    label: 'Underwater bubbles',
    dur: 16,
    make: s => {
      s.stereoBed(0.8, () => {
        const lp = s.lp(300);
        return () => lp.run(s.noise.brown());
      });
      s.scatter(12, at => {
        const n = Math.floor(s.rand(1, 6));
        const pan = s.rand(-0.8, 0.8);
        for (let k = 0; k < n; k++) drop(s, at + k * s.rand(0.03, 0.08), s.rand(0.1, 0.3), pan, s.rand(250, 900));
      });
    },
  },
  {
    id: 'splash',
    cat: 'water',
    label: 'Splash',
    dur: 2.5,
    make: s => {
      const hp = s.hp(600);
      s.event(0.02, 1.2, 0.9, 0, t => hp.run(s.noise.white()) * attack(t, 0.005, 0.25));
      for (let k = 0; k < 25; k++) drop(s, s.rand(0.1, 1.6), s.rand(0.05, 0.2), s.rand(-0.7, 0.7), s.rand(500, 2000));
    },
  },
  {
    id: 'engine',
    cat: 'vehicles',
    label: 'Car engine idle',
    dur: 12,
    make: s => {
      const wobble = s.drift(2);
      engineTone(s, 0, s.dur, 0.8, () => 46 + wobble.next() * 4, () => 0, t => Math.min(1, t * 3), 600);
    },
  },
  {
    id: 'car-start',
    cat: 'vehicles',
    label: 'Car start and rev',
    dur: 7,
    make: s => {
      engineTone(s, 0, 0.9, 0.6, t => 12 + 6 * Math.sin(TAU * 9 * t), () => 0, () => 0.7, 400);
      engineTone(s, 0.9, 6, 0.9, t => (t < 1.5 ? 45 : t < 3 ? 45 + (t - 1.5) * 70 : Math.max(45, 150 - (t - 3) * 80)), () => 0, t => Math.min(1, t * 6), 1200);
    },
  },
  {
    id: 'car-pass',
    cat: 'vehicles',
    label: 'Car passing by',
    dur: 6,
    make: s => pass(s, 0, 6, 0.9, 1),
  },
  {
    id: 'traffic',
    cat: 'vehicles',
    label: 'Traffic',
    dur: 24,
    make: s => {
      s.stereoBed(0.7, () => {
        const lp = s.lp(140);
        return () => lp.run(s.noise.brown());
      });
      for (let t = 0; t < s.dur; t += s.rand(1.2, 3)) pass(s, t - 1, s.rand(4, 7), s.rand(0.2, 0.6), s.rnd() > 0.5 ? 1 : -1);
    },
  },
  {
    id: 'horn',
    cat: 'vehicles',
    label: 'Car horn',
    dur: 2.4,
    make: s => {
      for (const [at, len] of [[0.05, 0.35], [0.6, 1.1]]) {
        const lp = s.lp(2500);
        s.event(at, len, 0.6, 0, t => lp.run((Math.sin(TAU * 415 * t) > 0 ? 1 : -1) + (Math.sin(TAU * 523 * t) > 0 ? 1 : -1)) * Math.min(1, t * 80, (len - t) * 80));
      }
    },
  },
  {
    id: 'siren',
    cat: 'vehicles',
    label: 'Emergency siren',
    dur: 12,
    make: s => {
      let ph = 0;
      s.event(0, s.dur, 0.5, 0, t => {
        const f = 650 + 750 * (0.5 - 0.5 * Math.cos((TAU * t) / 4));
        ph += (TAU * f) / SR;
        return (Math.sin(ph) + Math.sin(ph * 2) * 0.3 + Math.sin(ph * 3) * 0.15) * Math.min(1, t * 4, (s.dur - t) * 2);
      });
      s.reverb(0.3, 1.4);
    },
  },
  {
    id: 'jet',
    cat: 'vehicles',
    label: 'Airplane flyover',
    dur: 16,
    make: s => {
      const mid = 8;
      s.stereoBed(1, () => {
        const bp = s.bp(800, 0.5);
        return (i, t) => {
          if (i % 64 === 0) bp.set(300 + 1600 / (1 + ((t - mid) / 2.5) ** 2), 0.5);
          return bp.run(s.noise.pink()) * (0.05 + 1 / (1 + ((t - mid) / 2.2) ** 2));
        };
      });
      let ph = 0;
      s.event(0, s.dur, 0.06, 0, t => {
        ph += (TAU * 2600 * (t < mid ? 1.06 : 0.94)) / SR;
        return Math.sin(ph) / (1 + ((t - mid) / 2) ** 2);
      });
    },
  },
  {
    id: 'helicopter',
    cat: 'vehicles',
    label: 'Helicopter',
    dur: 14,
    make: s => {
      for (let t = 0; t < s.dur; t += 1 / 11) {
        const amp = Math.min(1, t / 3, (s.dur - t) / 3);
        const lp = s.lp(700);
        s.event(t, 0.08, amp * 0.9, Math.sin(t * 0.4) * 0.5, tt => lp.run(s.noise.white()) * attack(tt, 0.003, 0.02) * 3);
      }
      s.stereoBed(0.3, () => {
        const lp = s.lp(200);
        return (_, t) => lp.run(s.noise.brown()) * Math.min(1, t / 3, (s.dur - t) / 3);
      });
    },
  },
  {
    id: 'train',
    cat: 'vehicles',
    label: 'Train on tracks',
    dur: 18,
    make: s => {
      s.stereoBed(0.9, () => {
        const lp = s.lp(160);
        return () => lp.run(s.noise.brown());
      });
      for (let t = 0.2; t < s.dur; t += 1.1) {
        for (const off of [0, 0.13, 0.62, 0.75]) {
          const lp = s.lp(900);
          s.event(t + off, 0.15, 0.7, 0, tt => lp.run(s.noise.white()) * attack(tt, 0.002, 0.03) * 2.5);
        }
      }
      for (const f of [311, 370]) {
        s.event(0.5, 1.6, 0.18, -0.2, t => Math.sin(TAU * f * t) * Math.min(1, t * 10, (1.6 - t) * 10));
      }
    },
  },
  {
    id: 'motorbike',
    cat: 'vehicles',
    label: 'Motorbike revving',
    dur: 8,
    make: s => engineTone(s, 0, 8, 0.8, t => 55 + 90 * Math.max(0, Math.sin((TAU * t) / 4)) ** 2, () => 0, t => Math.min(1, t * 4, (8 - t) * 2), 1800),
  },
  {
    id: 'city',
    cat: 'outdoors',
    label: 'City street',
    dur: 24,
    make: s => {
      s.stereoBed(0.6, () => {
        const lp = s.lp(160);
        return () => lp.run(s.noise.brown());
      });
      for (let t = 0; t < s.dur; t += s.rand(2, 4)) pass(s, t - 1, s.rand(4, 7), s.rand(0.12, 0.35), s.rnd() > 0.5 ? 1 : -1);
      voiceBabble(s, 6, 0.08);
      s.scatter(0.15, at => {
        const lp = s.lp(2000);
        s.event(at, 0.4, 0.08, s.rand(-1, 1), t => lp.run(Math.sin(TAU * 440 * t) > 0 ? 1 : -1) * Math.min(1, t * 60, (0.4 - t) * 60));
      });
      s.reverb(0.2, 1.3);
    },
  },
  {
    id: 'crowd',
    cat: 'humans',
    label: 'Crowd talking',
    dur: 20,
    make: s => {
      voiceBabble(s, 22, 0.18);
      s.reverb(0.35, 1.3);
    },
  },
  {
    id: 'cheer',
    cat: 'humans',
    label: 'Crowd cheering',
    dur: 10,
    make: s => {
      voiceBabble(s, 30, 0.22, true);
      claps(s, 40, 0.25, t => Math.min(1, t / 0.8) * Math.min(1, (10 - t) / 3));
      s.reverb(0.35, 1.4);
    },
  },
  {
    id: 'applause',
    cat: 'humans',
    label: 'Applause',
    dur: 10,
    make: s => {
      claps(s, 60, 0.35, t => Math.min(1, t / 1.2) * Math.min(1, (10 - t) / 3.5));
      s.reverb(0.25, 1.3);
    },
  },
  {
    id: 'footsteps',
    cat: 'humans',
    label: 'Footsteps on gravel',
    dur: 10,
    make: s => {
      for (let t = 0.2, k = 0; t < s.dur - 0.3; t += s.rand(0.5, 0.6), k++) step(s, t, 0.9, k % 2 ? 0.15 : -0.15, true);
    },
  },
  {
    id: 'footsteps-hall',
    cat: 'humans',
    label: 'Footsteps in a hallway',
    dur: 10,
    make: s => {
      for (let t = 0.2, k = 0; t < s.dur - 0.3; t += s.rand(0.5, 0.6), k++) step(s, t, 0.9, k % 2 ? 0.15 : -0.15, false);
      s.reverb(0.45, 1.5);
    },
  },
  {
    id: 'heartbeat',
    cat: 'humans',
    label: 'Heartbeat',
    dur: 10,
    make: s => {
      for (let t = 0.2; t < s.dur; t += 60 / 68) {
        for (const [off, g] of [[0, 1], [0.28, 0.7]]) s.event(t + off, 0.3, g, 0, tt => Math.sin(TAU * (55 - tt * 40) * tt) * attack(tt, 0.01, 0.06));
      }
    },
  },
  {
    id: 'whistle',
    cat: 'humans',
    label: 'Wolf whistle',
    dur: 2.2,
    make: s => {
      let ph = 0;
      s.event(0.05, 2, 0.5, 0, t => {
        const f = t < 0.45 ? 1200 + (t / 0.45) * 1400 : t < 0.7 ? 0 : 1800 + Math.min(1, (t - 0.7) / 0.3) * 900 - Math.max(0, t - 1) * 1300;
        if (!f) return 0;
        ph += (TAU * f) / SR;
        const seg = t < 0.45 ? bell(t, 0.45) : bell(t - 0.7, 1.3);
        return (Math.sin(ph) + s.noise.white() * 0.05) * seg;
      });
      s.reverb(0.15);
    },
  },
  {
    id: 'bees',
    cat: 'animals',
    label: 'Buzzing bees',
    dur: 12,
    make: s => {
      for (let b = 0; b < 5; b++) {
        const f0 = s.rand(190, 260);
        const lp = s.bp(f0 * 3, 1.5);
        const wob = s.drift(1.5);
        let ph = 0;
        const panRate = s.rand(0.1, 0.4);
        s.event(0, s.dur, s.rand(0.15, 0.3), 0, t => {
          ph = (ph + (f0 * (1 + 0.04 * Math.sin(TAU * 7 * t) + wob.next() * 0.05)) / SR) % 1;
          return lp.run(ph * 2 - 1) * (0.5 + 0.5 * Math.sin(TAU * panRate * t));
        });
      }
    },
  },
  {
    id: 'owl',
    cat: 'animals',
    label: 'Owl hooting',
    dur: 10,
    make: s => {
      for (const at of [0.5, 5]) {
        for (const [off, len] of [[0, 0.35], [0.55, 0.2], [0.85, 0.7]]) {
          let ph = 0;
          s.event(at + off, len, 0.5, -0.3, t => {
            ph += (TAU * (390 - t * 60)) / SR;
            return (Math.sin(ph) + s.noise.white() * 0.04) * bell(t, len);
          });
        }
      }
      s.reverb(0.5, 1.5);
    },
  },
  {
    id: 'frogs',
    cat: 'animals',
    label: 'Frogs croaking',
    dur: 14,
    make: s => {
      for (let f = 0; f < 4; f++) {
        const pitch = s.rand(350, 800);
        const pan = s.rand(-0.8, 0.8);
        s.scatter(0.6, at => {
          const bp = s.bp(pitch, 5);
          const len = s.rand(0.25, 0.5);
          s.event(at, len, 0.5, pan, t => bp.run((t * 22) % 1 < 0.2 ? s.noise.white() : 0) * bell(t, len) * 3);
        });
      }
    },
  },
  {
    id: 'purr',
    cat: 'animals',
    label: 'Cat purring',
    dur: 10,
    make: s => {
      const lp = s.lp(350);
      s.event(0, s.dur, 1.3, 0, t => lp.run(s.noise.white()) * (0.3 + 0.7 * Math.max(0, Math.sin(TAU * 26 * t))) * (0.6 + 0.4 * Math.sin((TAU * t) / 2.4)));
    },
  },
  {
    id: 'church-bell',
    cat: 'outdoors',
    label: 'Church bell',
    dur: 14,
    make: s => {
      for (let t = 0.1; t < 9; t += 2.6) bellTone(s, t, 220, 0.25, 0, 7);
      s.reverb(0.4, 1.6);
    },
  },
  {
    id: 'chimes',
    cat: 'outdoors',
    label: 'Wind chimes',
    dur: 16,
    make: s => {
      const notes = [1046, 1174, 1318, 1568, 1760, 2093];
      s.scatter(1.8, at => bellTone(s, at, notes[Math.floor(s.rand(0, notes.length))] / 2, 0.12, s.rand(-0.8, 0.8), 4));
      s.reverb(0.3, 1.2);
    },
  },
  {
    id: 'clock',
    cat: 'objects',
    label: 'Clock ticking',
    dur: 10,
    make: s => {
      for (let t = 0.1, k = 0; t < s.dur; t += 0.5, k++) burst(s, t, 0.002, 0.8, 0, k % 2 ? 2600 : 3200, 6);
    },
  },
  {
    id: 'knock',
    cat: 'objects',
    label: 'Knock on a door',
    dur: 2.4,
    make: s => {
      for (const at of [0.1, 0.32, 0.54]) {
        const lp = s.lp(1200);
        s.event(at, 0.2, 0.9, 0, t => (Math.sin(TAU * 140 * t) * 0.8 + lp.run(s.noise.white()) * 0.6) * attack(t, 0.001, 0.035));
      }
      s.reverb(0.2);
    },
  },
  {
    id: 'whoosh',
    cat: 'objects',
    label: 'Whoosh',
    dur: 1.6,
    make: s => {
      const bp = s.bp(400, 1.2);
      s.event(0, 1.4, 1.2, 0, (t, i) => {
        if (i % 32 === 0) bp.set(300 + 2400 * bell(t, 1.4), 1.2);
        return bp.run(s.noise.white()) * bell(t, 1.4);
      });
    },
  },
  {
    id: 'swish',
    cat: 'objects',
    label: 'Fast swish',
    dur: 0.8,
    make: s => {
      const bp = s.bp(1500, 1);
      s.event(0, 0.5, 1, 0, (t, i) => {
        if (i % 16 === 0) bp.set(800 + 4000 * (t / 0.5), 1);
        return bp.run(s.noise.white()) * bell(t, 0.5);
      });
    },
  },
  {
    id: 'pop',
    cat: 'objects',
    label: 'Pop',
    dur: 0.4,
    make: s => {
      let ph = 0;
      s.event(0, 0.12, 0.9, 0, t => {
        ph += (TAU * (650 * Math.exp(-t * 30) + 140)) / SR;
        return Math.sin(ph) * attack(t, 0.001, 0.03);
      });
    },
  },
  {
    id: 'ding',
    cat: 'objects',
    label: 'Notification ding',
    dur: 2,
    make: s => {
      for (const [at, f] of [[0, 1318], [0.18, 1760]]) s.event(at, 1.6, 0.35, 0, t => (Math.sin(TAU * f * t) + Math.sin(TAU * f * 2 * t) * 0.2) * attack(t, 0.002, 0.45));
    },
  },
  {
    id: 'phone',
    cat: 'objects',
    label: 'Phone ringing',
    dur: 6,
    make: s => {
      for (const at of [0.1, 3.1]) {
        s.event(at, 1.6, 0.3, 0, t => (Math.sin(TAU * ((t * 16) % 1 < 0.5 ? 1200 : 1600) * t) * Math.min(1, t * 40, (1.6 - t) * 40)));
      }
    },
  },
  {
    id: 'alarm',
    cat: 'objects',
    label: 'Alarm beeps',
    dur: 3,
    make: s => {
      for (let k = 0; k < 4; k++) {
        const lp = s.lp(5000);
        s.event(0.1 + k * 0.6, 0.3, 0.35, 0, t => lp.run(Math.sin(TAU * 2000 * t) > 0 ? 1 : -1) * Math.min(1, t * 200, (0.3 - t) * 200));
      }
    },
  },
  {
    id: 'glass',
    cat: 'objects',
    label: 'Glasses clinking',
    dur: 2.5,
    make: s => {
      for (const at of [0.1, 0.5]) {
        s.event(at, 1.8, 0.35, s.rand(-0.3, 0.3), t => (Math.sin(TAU * 2090 * t) + Math.sin(TAU * 4810 * t) * 0.6 + Math.sin(TAU * 6330 * t) * 0.4) * attack(t, 0.0005, 0.35));
      }
    },
  },
  {
    id: 'shutter',
    cat: 'objects',
    label: 'Camera shutter',
    dur: 0.6,
    make: s => {
      burst(s, 0.02, 0.004, 0.9, 0, 3500, 1);
      burst(s, 0.11, 0.006, 0.7, 0, 2200, 1);
      const bp = s.bp(1200, 2);
      s.event(0.03, 0.08, 0.3, 0, t => bp.run(s.noise.white()) * bell(t, 0.08));
    },
  },
  {
    id: 'typing',
    cat: 'objects',
    label: 'Keyboard typing',
    dur: 10,
    make: s => {
      for (let t = 0.1; t < s.dur - 0.2; t += s.rand(0.08, 0.28)) {
        const f = s.rand(2500, 4500);
        burst(s, t, 0.003, s.rand(0.4, 0.8), s.rand(-0.3, 0.3), f, 3);
        burst(s, t + s.rand(0.05, 0.09), 0.002, 0.25, 0, f * 1.2, 3);
        if (s.rnd() < 0.08) t += s.rand(0.4, 1);
      }
    },
  },
  {
    id: 'impact',
    cat: 'objects',
    label: 'Deep impact',
    dur: 3,
    make: s => {
      let ph = 0;
      const lp = s.lp(500);
      s.event(0.02, 2.8, 1, 0, t => {
        ph += (TAU * (40 + 90 * Math.exp(-t * 8))) / SR;
        return Math.sin(ph) * attack(t, 0.002, 0.6) + lp.run(s.noise.white()) * attack(t, 0.001, 0.12) * 0.8;
      });
      s.reverb(0.25, 1.3);
    },
  },
  {
    id: 'explosion',
    cat: 'objects',
    label: 'Explosion',
    dur: 6,
    make: s => {
      const lp = s.lp(3000);
      const rumble = s.lp(90);
      const mod = s.drift(4);
      s.event(0.02, 5.8, 1, 0, (t, i) => {
        if (i % 32 === 0) lp.set(150 + 3000 * Math.exp(-t * 3));
        return lp.run(s.noise.white()) * attack(t, 0.003, 0.7) + rumble.run(s.noise.brown()) * attack(t, 0.05, 1.8) * (0.5 + mod.next()) * 5;
      });
      s.reverb(0.3, 1.5);
    },
  },
];

function normalize(s: Studio): void {
  let peak = 0;
  for (let i = 0; i < s.n; i++) peak = Math.max(peak, Math.abs(s.L[i]), Math.abs(s.R[i]));
  const g = peak > 0 ? 0.89 / peak : 1;
  const fade = Math.min(s.n / 4, Math.round(SR * 0.03));
  for (let i = 0; i < s.n; i++) {
    const f = Math.min(1, i / fade, (s.n - 1 - i) / fade);
    s.L[i] *= g * f;
    s.R[i] *= g * f;
  }
}

function wav(s: Studio): Blob {
  const data = new DataView(new ArrayBuffer(44 + s.n * 4));
  const str = (o: number, v: string): void => [...v].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  data.setUint32(4, 36 + s.n * 4, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 2, true);
  data.setUint32(24, SR, true);
  data.setUint32(28, SR * 4, true);
  data.setUint16(32, 4, true);
  data.setUint16(34, 16, true);
  str(36, 'data');
  data.setUint32(40, s.n * 4, true);
  for (let i = 0; i < s.n; i++) {
    data.setInt16(44 + i * 4, Math.max(-1, Math.min(1, s.L[i])) * 0x7fff, true);
    data.setInt16(46 + i * 4, Math.max(-1, Math.min(1, s.R[i])) * 0x7fff, true);
  }
  return new Blob([data.buffer], { type: 'audio/wav' });
}

export function renderSynth(sound: SynthSound): Blob {
  let seed = 0;
  for (const ch of sound.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const s = new Studio(sound.dur, seed);
  sound.make(s);
  normalize(s);
  return wav(s);
}
