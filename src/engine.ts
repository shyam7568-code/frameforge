import { ensureSegmenter, segment, segmenterStatus, type ModelState } from './ai';
import { maskAt, maskSet } from './cutout';
import { valueAt } from './keys';
import { GLSL_LOOKS, STYLES, aiOf, blendIndex, cropOf, cutoutOf, fxOf, lookIndex, mixOf, poseAt, secondaryOf, speedOf } from './looks';
import { store } from './state';
import { isActive, roleAt, type TransitionMods } from './transitions';
import type { Clip, Grade, Wheel } from './types';
import { clamp } from './util';

const VERT = `#version 300 es
in vec2 aPos;
uniform vec4 uRect;
uniform vec4 uCrop;
uniform vec2 uFlip;
uniform float uAspect;
uniform float uRot;
out vec2 vUv;
out vec2 vScreen;
void main() {
  vec2 uv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  vec2 cuv = vec2(mix(uCrop.x, 1.0 - uCrop.y, uv.x), mix(uCrop.z, 1.0 - uCrop.w, uv.y));
  vec2 p = vec2(cuv.x * 2.0 - 1.0, 1.0 - cuv.y * 2.0) * uRect.zw;
  p.x *= uAspect;
  float c = cos(uRot);
  float s = sin(uRot);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  p.x /= uAspect;
  vUv = vec2(uFlip.x < 0.0 ? 1.0 - cuv.x : cuv.x, uFlip.y < 0.0 ? 1.0 - cuv.y : cuv.y);
  vec2 pos = uRect.xy + p;
  vScreen = pos * 0.5 + 0.5;
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vScreen;
uniform sampler2D uTex;
uniform sampler2D uDst;
uniform sampler2D uMask;
uniform sampler2D uCutMask;
uniform sampler2D uPlate;
uniform int uCut, uCutShow, uPlateOn, uStyle;
uniform float uStyleAmt;
uniform vec2 uCutTexel;
uniform float uOpacity, uExposure, uContrast, uSat, uTemp, uTint, uShadows, uHighlights;
uniform vec3 uLift, uGamma, uGain, uOffset;
uniform int uLook, uBlend, uAi, uWipe, uWinShape, uSecOn, uQualOn, uShowMask;
uniform float uLookAmt, uVignette, uGrain, uBlur, uSharpen, uTime, uLens, uDenoise, uFlare, uAiAmt, uWipeP, uAspect;
uniform vec2 uTexel, uFlarePos;
uniform vec4 uQual, uQualSL, uWin, uSec;
uniform vec3 uWinOpt;
out vec4 outColor;
${GLSL_LOOKS}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hueRotate(vec3 c, float a) {
  const mat3 toYiq = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  const mat3 toRgb = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
  vec3 yiq = toYiq * c;
  float cs = cos(a), sn = sin(a);
  yiq.yz = vec2(yiq.y * cs - yiq.z * sn, yiq.y * sn + yiq.z * cs);
  return toRgb * yiq;
}
vec2 lensUv(vec2 uv) {
  if (abs(uLens) < 0.001) return uv;
  vec2 r = uv - 0.5;
  float k = uLens * 0.5;
  return 0.5 + r * (1.0 + k * dot(r, r) * 4.0) / (1.0 + max(k, 0.0) * 2.0);
}
vec4 blurAt(vec2 uv, float radius) {
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int x = -3; x <= 3; x++) {
    for (int y = -3; y <= 3; y++) {
      float w = exp(-float(x * x + y * y) / 8.0);
      sum += texture(uTex, uv + vec2(float(x), float(y)) * uTexel * radius) * w;
      total += w;
    }
  }
  return sum / total;
}
vec4 denoiseAt(vec2 uv) {
  vec4 c0 = texture(uTex, uv);
  float sigma = 0.03 + uDenoise * 0.15;
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int x = -2; x <= 2; x++) {
    for (int y = -2; y <= 2; y++) {
      vec4 c = texture(uTex, uv + vec2(float(x), float(y)) * uTexel * 1.5);
      vec3 d = c.rgb - c0.rgb;
      float w = exp(-float(x * x + y * y) / 4.5) * exp(-dot(d, d) / (2.0 * sigma * sigma));
      sum += c * w;
      total += w;
    }
  }
  return mix(c0, sum / total, clamp(uDenoise * 1.5, 0.0, 1.0));
}
float secondaryMask(vec3 c, vec2 uv) {
  float m = 1.0;
  if (uQualOn == 1) {
    vec3 hsv = rgb2hsv(clamp(c, 0.0, 1.0));
    float soft = max(uQual.z, 0.001);
    float dh = abs(fract(hsv.x - uQual.x + 0.5) - 0.5);
    float mh = 1.0 - smoothstep(uQual.y, uQual.y + soft, dh);
    float ms = smoothstep(uQualSL.x - soft, uQualSL.x, hsv.y) * (1.0 - smoothstep(uQualSL.y, uQualSL.y + soft, hsv.y));
    float l = luma(clamp(c, 0.0, 1.0));
    float ml = smoothstep(uQualSL.z - soft, uQualSL.z, l) * (1.0 - smoothstep(uQualSL.w, uQualSL.w + soft, l));
    m *= mh * ms * ml;
  }
  if (uWinShape > 0) {
    vec2 d = uv - uWin.xy;
    float cs = cos(uWinOpt.x), sn = sin(uWinOpt.x);
    d = vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
    float soft = max(uWinOpt.y, 0.001);
    float w;
    if (uWinShape == 1) {
      float r = length(d / max(uWin.zw, vec2(0.001)));
      w = 1.0 - smoothstep(1.0 - soft, 1.0 + soft, r);
    } else if (uWinShape == 2) {
      vec2 q = abs(d) / max(uWin.zw, vec2(0.001));
      w = 1.0 - smoothstep(1.0 - soft, 1.0 + soft, max(q.x, q.y));
    } else {
      w = smoothstep(-soft * 0.5, soft * 0.5, -d.y);
    }
    if (uWinOpt.z > 0.5) w = 1.0 - w;
    m *= w;
  }
  return m;
}
float wipeMask() {
  if (uWipe == 0) return 1.0;
  float p = uWipeP;
  float s = 0.015;
  if (uWipe == 1) return smoothstep(1.0 - p - s, 1.0 - p + s, vScreen.x);
  if (uWipe == 2) return 1.0 - smoothstep(p - s, p + s, vScreen.x);
  if (uWipe == 3) return 1.0 - smoothstep(p - s, p + s, vScreen.y);
  if (uWipe == 4) return smoothstep(1.0 - p - s, 1.0 - p + s, vScreen.y);
  vec2 d = (vScreen - 0.5) * vec2(uAspect, 1.0);
  float r = p * 0.5 * sqrt(uAspect * uAspect + 1.0) * 1.02;
  return 1.0 - smoothstep(r - s, r + s, length(d));
}
vec3 px(vec2 uv) { return texture(uTex, uv).rgb; }
float lumAt(vec2 uv) { return luma(texture(uTex, uv).rgb); }
float edgeAt(vec2 uv, vec2 t) {
  float tl = lumAt(uv - t), tc = lumAt(uv + vec2(0.0, -t.y)), tr = lumAt(uv + vec2(t.x, -t.y));
  float ml = lumAt(uv + vec2(-t.x, 0.0)), mr = lumAt(uv + vec2(t.x, 0.0));
  float bl = lumAt(uv + vec2(-t.x, t.y)), bc = lumAt(uv + vec2(0.0, t.y)), br = lumAt(uv + t);
  float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
  float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
  return length(vec2(gx, gy));
}
vec3 smoothColor(vec2 uv, vec2 st, float sigma) {
  vec3 c0 = px(uv);
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int x = -2; x <= 2; x++) {
    for (int y = -2; y <= 2; y++) {
      vec3 c = px(uv + vec2(float(x), float(y)) * st * 1.5);
      vec3 d = c - c0;
      float w = exp(-float(x * x + y * y) / 6.0) * exp(-dot(d, d) / (2.0 * sigma * sigma));
      sum += c * w;
      total += w;
    }
  }
  return sum / total;
}
vec3 kuwahara(vec2 uv, vec2 st) {
  vec3 m0 = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0), m3 = vec3(0.0);
  vec3 q0 = vec3(0.0), q1 = vec3(0.0), q2 = vec3(0.0), q3 = vec3(0.0);
  for (int j = 0; j <= 2; j++) {
    for (int i = 0; i <= 2; i++) {
      vec2 o = vec2(float(i), float(j)) * st;
      vec3 a = px(uv - o); m0 += a; q0 += a * a;
      vec3 b = px(uv + vec2(o.x, -o.y)); m1 += b; q1 += b * b;
      vec3 c = px(uv + vec2(-o.x, o.y)); m2 += c; q2 += c * c;
      vec3 d = px(uv + o); m3 += d; q3 += d * d;
    }
  }
  m0 /= 9.0; m1 /= 9.0; m2 /= 9.0; m3 /= 9.0;
  vec3 v0 = abs(q0 / 9.0 - m0 * m0), v1 = abs(q1 / 9.0 - m1 * m1), v2 = abs(q2 / 9.0 - m2 * m2), v3 = abs(q3 / 9.0 - m3 * m3);
  float s0 = v0.r + v0.g + v0.b, s1 = v1.r + v1.g + v1.b, s2 = v2.r + v2.g + v2.b, s3 = v3.r + v3.g + v3.b;
  vec3 r = m0; float best = s0;
  if (s1 < best) { best = s1; r = m1; }
  if (s2 < best) { best = s2; r = m2; }
  if (s3 < best) { r = m3; }
  return r;
}
vec3 satur(vec3 c, float k) { return mix(vec3(luma(c)), c, k); }
vec3 pencil(vec2 uv, vec2 st) {
  float g = lumAt(uv);
  float b = 0.0;
  float total = 0.0;
  for (int x = -2; x <= 2; x++) {
    for (int y = -2; y <= 2; y++) {
      float w = exp(-float(x * x + y * y) / 4.0);
      b += (1.0 - lumAt(uv + vec2(float(x), float(y)) * st * 2.5)) * w;
      total += w;
    }
  }
  b /= total;
  float d = clamp(g / max(1.0 - b, 0.02), 0.0, 1.0);
  d = pow(d, 3.2);
  return vec3(d) * (0.94 + 0.06 * hash(floor(uv / st)));
}
vec3 stylize(int id, vec2 uv) {
  vec2 st = vec2(uTexel.x / uTexel.y, 1.0) / 720.0;
  if (id == 1) {
    vec3 c = smoothColor(uv, st, 0.12);
    c = floor(c * 6.0 + 0.5) / 6.0;
    float e = smoothstep(0.3, 0.6, edgeAt(uv, st * 1.4));
    return satur(c, 1.25) * (1.0 - e * 0.9);
  }
  if (id == 2) {
    vec3 c = kuwahara(uv, st * 1.4);
    float l = luma(c);
    float band = l < 0.28 ? 0.2 : l < 0.62 ? 0.55 : 0.9;
    c = satur(c * (band + 0.12) / max(l, 0.06), 1.35);
    float e = smoothstep(0.35, 0.7, edgeAt(uv, st));
    return mix(clamp(c, 0.0, 1.0), vec3(0.08, 0.06, 0.1), e * 0.85);
  }
  if (id == 3) return pencil(uv, st) * vec3(1.0, 0.98, 0.94);
  if (id == 4) return pencil(uv, st) * mix(vec3(1.0), satur(px(uv), 1.3) * 1.15, 0.75);
  if (id == 5) {
    vec3 c = kuwahara(uv, st * 2.6);
    float relief = lumAt(uv - st * 2.0) - lumAt(uv + st * 2.0);
    return satur(c, 1.2) + relief * 0.12;
  }
  if (id == 6) {
    vec3 c = kuwahara(uv, st * 2.0);
    float e = edgeAt(uv, st * 2.0);
    float paper = 0.93 + 0.07 * hash(floor(uv / (st * 3.0)));
    c = satur(c * 0.9 + 0.12, 1.15) * (1.0 - smoothstep(0.1, 0.8, e) * 0.3);
    return mix(c, vec3(1.0), smoothstep(0.75, 1.0, luma(c)) * 0.5) * paper;
  }
  if (id == 7) {
    vec3 c = floor(smoothColor(uv, st, 0.15) * 4.0 + 0.5) / 4.0;
    vec2 cell = st * 7.0;
    vec2 f = fract(uv / cell) - 0.5;
    f.x *= cell.x / cell.y;
    float dotR = 0.5 * sqrt(clamp(1.0 - luma(c), 0.0, 1.0));
    float shade = length(f) < dotR ? 0.72 : 1.0;
    float e = smoothstep(0.3, 0.55, edgeAt(uv, st * 1.6));
    return satur(c, 1.4) * shade * (1.0 - e);
  }
  if (id == 8) {
    vec2 blk = st * 9.0;
    vec3 c = px((floor(uv / blk) + 0.5) * blk);
    return floor(satur(c, 1.2) * 5.0 + 0.5) / 5.0;
  }
  if (id == 9) {
    float e = smoothstep(0.12, 0.6, edgeAt(uv, st));
    vec3 hue = normalize(satur(px(uv), 2.5) + 0.05);
    return px(uv) * 0.1 + hue * e * 1.8;
  }
  return px(uv);
}
float cutAt(vec2 uv) { return texture(uCutMask, uv).r; }
vec3 eraseFill(vec2 uv) {
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int k = 0; k < 16; k++) {
    float ang = float(k) * 0.3926991;
    vec2 dir = vec2(cos(ang), sin(ang)) * uCutTexel * 2.0;
    for (int j = 1; j <= 64; j++) {
      vec2 q = uv + dir * float(j);
      if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) break;
      if (cutAt(q) < 0.04) {
        float w = 1.0 / float(j * j);
        sum += px(q) * w;
        wsum += w;
        break;
      }
    }
  }
  return wsum > 0.0 ? sum / wsum : px(uv);
}
vec3 blendMode(int m, vec3 b, vec3 s) {
  if (m == 1) return b + s;
  if (m == 2) return 1.0 - (1.0 - b) * (1.0 - s);
  if (m == 3) return b * s;
  if (m == 4) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
  if (m == 5) return mix(2.0 * b * s + b * b * (1.0 - 2.0 * s), sqrt(b) * (2.0 * s - 1.0) + 2.0 * b * (1.0 - s), step(0.5, s));
  if (m == 6) return max(b, s);
  if (m == 7) return min(b, s);
  if (m == 8) return abs(b - s);
  return s;
}
void main() {
  vec2 uv = lensUv(vUv);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
  float person = uAi > 0 ? texture(uMask, uv).r : 1.0;
  vec4 s;
  if (uBlur > 0.001) s = blurAt(uv, uBlur * 6.0);
  else if (uDenoise > 0.001) s = denoiseAt(uv);
  else s = texture(uTex, uv);
  if (uAi == 2) s = mix(blurAt(uv, 3.0 + uAiAmt * 16.0), s, smoothstep(0.25, 0.75, person));
  if (uStyle > 0) s.rgb = mix(s.rgb, stylize(uStyle, uv), uStyleAmt);
  float cut = uCut > 0 ? cutAt(uv) : 0.0;
  if (uCut == 2 && cut > 0.001) {
    vec4 plate = texture(uPlate, uv);
    vec3 fill = uPlateOn == 1 && plate.a > 0.5 ? plate.rgb : eraseFill(uv);
    s.rgb = mix(s.rgb, fill, cut);
  }
  if (uSharpen > 0.001) {
    vec4 n = texture(uTex, uv + vec2(uTexel.x, 0.0)) + texture(uTex, uv - vec2(uTexel.x, 0.0))
           + texture(uTex, uv + vec2(0.0, uTexel.y)) + texture(uTex, uv - vec2(0.0, uTexel.y));
    s.rgb = s.rgb + (s.rgb * 4.0 - n.rgb) * uSharpen;
  }
  vec3 c = s.rgb * exp2(uExposure);
  c += vec3(uTemp * 0.1 + uTint * 0.05, -uTint * 0.1, -uTemp * 0.1 + uTint * 0.05);
  c = uGain * (c + uLift * (1.0 - c));
  c = pow(max(c, 0.0), 1.0 / uGamma);
  c = (c - 0.5) * (1.0 + uContrast) + 0.5;
  float l = luma(c);
  c = mix(vec3(l), c, uSat);
  c += uShadows * 0.35 * (1.0 - smoothstep(0.0, 0.55, l)) + uHighlights * 0.35 * smoothstep(0.45, 1.0, l);
  c += uOffset;
  if (uSecOn == 1) {
    float m = secondaryMask(c, uv);
    vec3 cs = hueRotate(c * exp2(uSec.x), uSec.z);
    cs = mix(vec3(luma(cs)), cs, uSec.y) + vec3(uSec.w * 0.1, 0.0, -uSec.w * 0.1);
    c = uShowMask == 1 ? vec3(m) : mix(c, cs, m);
  }
  if (uAi == 3) c = mix(vec3(luma(c)), c, smoothstep(0.25, 0.75, person));
  if (uLook > 0) c = mix(c, applyLook(uLook, clamp(c, 0.0, 1.0)), uLookAmt);
  if (uVignette > 0.001) c *= 1.0 - uVignette * smoothstep(0.3, 0.85, length(uv - 0.5) * 1.35);
  if (uGrain > 0.001) c += (hash(uv * 1024.0 + uTime) - 0.5) * uGrain * 0.3;
  if (uFlare > 0.001) {
    vec2 a = vec2(uAspect, 1.0);
    vec2 p = vScreen * a;
    vec2 f = uFlarePos * a;
    float d = distance(p, f);
    vec3 glow = vec3(1.0, 0.86, 0.62) * exp(-d * 9.0) * 1.3 + vec3(1.0, 0.6, 0.3) * exp(-d * 2.5) * 0.25;
    float streak = exp(-abs(p.y - f.y) * 70.0) * exp(-abs(p.x - f.x) * 1.4) * 0.6;
    vec3 ghosts = vec3(0.0);
    vec2 dir = 0.5 * a - f;
    for (int i = 1; i <= 3; i++) {
      float gd = distance(p, f + dir * (0.65 * float(i)));
      ghosts += vec3(0.45, 0.65, 1.0) * exp(-gd * gd * 500.0 / float(i)) * 0.3;
    }
    float ring = exp(-pow((d - 0.2) * 45.0, 2.0)) * 0.12;
    c += (glow + streak * vec3(1.0, 0.8, 0.6) + ghosts + ring * vec3(0.6, 0.8, 1.0)) * uFlare;
  }
  if (uCutShow == 1 && uCut > 0) c = mix(c, vec3(1.0, 0.18, 0.3), cut * 0.55);
  float alpha = s.a * uOpacity * wipeMask();
  if (uCut == 1 && uCutShow == 0) alpha *= cut;
  if (uAi == 1) alpha *= smoothstep(0.3, 0.7, person);
  vec3 dst = texture(uDst, vScreen).rgb;
  vec3 mixed = clamp(blendMode(uBlend, dst, clamp(c, 0.0, 1.0)), 0.0, 1.0);
  outColor = vec4(mix(dst, mixed, clamp(alpha, 0.0, 1.0)), 1.0);
}`;

const UNIFORMS = [
  'uRect', 'uCrop', 'uFlip', 'uAspect', 'uRot', 'uTex', 'uDst', 'uMask', 'uOpacity', 'uExposure', 'uContrast', 'uSat', 'uTemp', 'uTint',
  'uShadows', 'uHighlights', 'uLift', 'uGamma', 'uGain', 'uOffset', 'uLook', 'uBlend', 'uAi', 'uWipe', 'uWinShape', 'uSecOn', 'uQualOn',
  'uShowMask', 'uLookAmt', 'uVignette', 'uGrain', 'uBlur', 'uSharpen', 'uTime', 'uLens', 'uDenoise', 'uFlare', 'uAiAmt', 'uWipeP',
  'uTexel', 'uFlarePos', 'uQual', 'uQualSL', 'uWin', 'uSec', 'uWinOpt', 'uCutMask', 'uPlate', 'uCut', 'uCutShow', 'uPlateOn', 'uCutTexel',
  'uStyle', 'uStyleAmt',
] as const;
type Uniform = (typeof UNIFORMS)[number];
type Vec3 = [number, number, number];

const MIME_TYPES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

function wheelDir(w: Wheel): Vec3 {
  const a = Math.atan2(w.y, w.x);
  const r = Math.min(1, Math.hypot(w.x, w.y));
  return [Math.cos(a) * r, Math.cos(a - 2.0944) * r, Math.cos(a + 2.0944) * r];
}

function gradeVectors(g: Grade): { lift: Vec3; gamma: Vec3; gain: Vec3; offset: Vec3 } {
  const map = (w: Wheel, f: (d: number) => number): Vec3 => wheelDir(w).map(f) as Vec3;
  const off = g.offset ?? { x: 0, y: 0, m: 0 };
  return {
    lift: map(g.lift, d => d * 0.15 + g.lift.m * 0.3),
    gamma: map(g.gamma, d => Math.max(0.1, 1 + g.gamma.m * 0.7 + d * 0.35)),
    gain: map(g.gain, d => Math.max(0, 1 + g.gain.m * 0.8 + d * 0.4)),
    offset: map(off, d => d * 0.12 + off.m * 0.25),
  };
}

function fade(c: Clip, t: number): number {
  const local = t - c.start;
  let f = 1;
  if (c.fadeIn > 0) f = Math.min(f, local / c.fadeIn);
  if (c.fadeOut > 0) f = Math.min(f, (c.duration - local) / c.fadeOut);
  return clamp(f, 0, 1);
}

interface Bus {
  input: GainNode;
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
  pan: StereoPannerNode;
  meter: AnalyserNode;
}

interface Target {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
}

export interface ExportOptions {
  mimeType: string;
  bitrate: number;
  signal: AbortSignal;
  onProgress: (p: number) => void;
}

export class Engine {
  readonly canvas = document.createElement('canvas');
  onFrame: ((canvas: HTMLCanvasElement) => void) | null = null;
  onAiStatus: ((state: ModelState, error: string) => void) | null = null;
  private readonly gl: WebGL2RenderingContext;
  private readonly prog: WebGLProgram;
  private readonly u = {} as Record<Uniform, WebGLUniformLocation | null>;
  private readonly videos = new Map<string, HTMLVideoElement>();
  private readonly audios = new Map<string, HTMLAudioElement>();
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly texts = new Map<string, { key: string; canvas: HTMLCanvasElement; dirty: boolean }>();
  private readonly textures = new Map<string, WebGLTexture>();
  private readonly masks = new Map<string, WebGLTexture>();
  private readonly cutTex = new Map<string, { tex: WebGLTexture; key: string }>();
  private readonly plates = new Map<string, WebGLTexture>();
  private readonly lastSize = new Map<string, [number, number]>();
  private readonly buses = new Map<string, Bus>();
  private readonly sources = new Map<HTMLMediaElement, { node: MediaElementAudioSourceNode; bus: string }>();
  private targets: Target[] = [];
  private targetSize = '';
  private audioCtx: AudioContext | null = null;
  private master: GainNode | null = null;
  private masterMeter: AnalyserNode | null = null;
  private speakers: GainNode | null = null;
  private recordDest: MediaStreamAudioDestinationNode | null = null;
  private readonly meterBuf = new Float32Array(1024);
  private raf = 0;
  private pending = false;
  private clockStart = 0;
  private clockT = 0;
  private exportDone: (() => void) | null = null;

  static mimeTypes(): string[] {
    if (typeof MediaRecorder === 'undefined') return [];
    return MIME_TYPES.filter(m => MediaRecorder.isTypeSupported(m));
  }

  constructor() {
    const gl = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false, alpha: false, antialias: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.prog = this.compile();
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const name of UNIFORMS) this.u[name] = gl.getUniformLocation(this.prog, name);
    gl.uniform1i(this.u.uTex, 0);
    gl.uniform1i(this.u.uDst, 1);
    gl.uniform1i(this.u.uMask, 2);
    gl.uniform1i(this.u.uCutMask, 3);
    gl.uniform1i(this.u.uPlate, 4);
    gl.disable(gl.BLEND);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.resize();
    store.on(c => {
      if (c === 'project') {
        this.resize();
        this.prune();
        this.applyMix();
      }
      if ((c === 'project' || c === 'playhead' || c === 'media') && !store.ui.playing) {
        this.sync(store.ui.playhead, false);
        this.requestRender();
      }
    });
  }

  private compile(): WebGLProgram {
    const gl = this.gl;
    const shader = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type);
      if (!s) throw new Error('Could not create a shader.');
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'Shader error');
      return s;
    };
    const prog = gl.createProgram();
    if (!prog) throw new Error('Could not create the render program.');
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'Link error');
    gl.useProgram(prog);
    return prog;
  }

  private resize(): void {
    const { width, height } = store.project;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  private ensureTargets(): void {
    const gl = this.gl;
    const { width: W, height: H } = this.canvas;
    const size = `${W}x${H}`;
    if (size === this.targetSize) return;
    this.targets.forEach(t => {
      gl.deleteFramebuffer(t.fb);
      gl.deleteTexture(t.tex);
    });
    this.targets = [0, 1].map(() => {
      const tex = gl.createTexture() as WebGLTexture;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer() as WebGLFramebuffer;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { fb, tex };
    });
    this.targetSize = size;
  }

  private prune(): void {
    const ids = new Set(store.project.clips.map(c => c.id));
    const media = new Set(store.project.media.map(m => m.id));
    const drop = (el: HTMLMediaElement): void => {
      el.pause();
      el.removeAttribute('src');
      el.load();
    };
    for (const [id, v] of this.videos) if (!ids.has(id)) { drop(v); this.videos.delete(id); this.freeTexture(id); this.lastSize.delete(id); }
    for (const [id, a] of this.audios) if (!ids.has(id)) { drop(a); this.audios.delete(id); }
    for (const id of this.texts.keys()) if (!ids.has(id)) { this.texts.delete(id); this.freeTexture(id); }
    for (const id of this.images.keys()) if (!media.has(id)) { this.images.delete(id); this.freeTexture(`img:${id}`); }
    for (const [id, tex] of this.masks) if (!ids.has(id)) { this.gl.deleteTexture(tex); this.masks.delete(id); }
    for (const [id, t] of this.cutTex) if (!ids.has(id)) { this.gl.deleteTexture(t.tex); this.cutTex.delete(id); }
    const live = new Set(store.project.clips.map(c => c.cutout?.maskId));
    for (const [id, tex] of this.plates) if (!live.has(id)) { this.gl.deleteTexture(tex); this.plates.delete(id); }
  }

  private freeTexture(key: string): void {
    const tex = this.textures.get(key);
    if (tex) this.gl.deleteTexture(tex);
    this.textures.delete(key);
  }

  private videoFor(c: Clip): HTMLVideoElement | null {
    const rt = store.runtime.get(c.mediaId ?? '');
    if (!rt) return null;
    let v = this.videos.get(c.id);
    if (!v || v.dataset.src !== rt.url) {
      v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.src = rt.url;
      v.dataset.src = rt.url;
      v.addEventListener('seeked', () => this.requestRender());
      v.addEventListener('loadeddata', () => this.requestRender());
      this.videos.set(c.id, v);
    }
    return v;
  }

  private audioFor(c: Clip): HTMLAudioElement | null {
    const rt = store.runtime.get(c.mediaId ?? '');
    if (!rt) return null;
    let a = this.audios.get(c.id);
    if (!a || a.dataset.src !== rt.url) {
      a = new Audio();
      a.preload = 'auto';
      a.src = rt.url;
      a.dataset.src = rt.url;
      this.audios.set(c.id, a);
    }
    return a;
  }

  private imageFor(mediaId?: string): HTMLImageElement | null {
    const rt = store.runtime.get(mediaId ?? '');
    if (!mediaId || !rt) return null;
    let img = this.images.get(mediaId);
    if (!img || img.dataset.src !== rt.url) {
      img = new Image();
      img.src = rt.url;
      img.dataset.src = rt.url;
      img.onload = () => {
        this.freeTexture(`img:${mediaId}`);
        this.requestRender();
      };
      this.images.set(mediaId, img);
    }
    return img;
  }

  private textFor(c: Clip): { canvas: HTMLCanvasElement; dirty: boolean } {
    const { width: W, height: H } = store.project;
    const key = JSON.stringify([c.text, W, H]);
    let entry = this.texts.get(c.id);
    if (!entry || entry.key !== key) {
      const canvas = entry?.canvas ?? document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (ctx && c.text) {
        const size = c.text.size * (H / 1080);
        ctx.clearRect(0, 0, W, H);
        ctx.font = `${c.text.bold ? 700 : 500} ${size}px "Inter", "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lines = c.text.content.split('\n');
        const lineH = size * 1.15;
        if (c.text.box) {
          const widest = Math.max(...lines.map(l => ctx.measureText(l).width));
          const bh = lines.length * lineH + size * 0.5;
          ctx.fillStyle = 'rgba(0,0,0,0.62)';
          ctx.beginPath();
          ctx.roundRect((W - widest) / 2 - size * 0.45, H / 2 - bh / 2, widest + size * 0.9, bh, size * 0.18);
          ctx.fill();
        } else {
          ctx.shadowColor = 'rgba(0,0,0,0.55)';
          ctx.shadowBlur = size * 0.12;
          ctx.shadowOffsetY = size * 0.04;
        }
        ctx.fillStyle = c.text.color;
        lines.forEach((line, i) => ctx.fillText(line, W / 2, H / 2 + (i - (lines.length - 1) / 2) * lineH));
      }
      entry = { key, canvas, dirty: true };
      this.texts.set(c.id, entry);
    }
    return entry;
  }

  private mediaTime(c: Clip, t: number): number {
    const m = store.media(c.mediaId);
    const max = m && m.kind !== 'image' ? Math.max(0, m.duration - 0.04) : Infinity;
    return clamp(c.offset + (t - c.start) * speedOf(c), 0, max);
  }

  private sync(t: number, playing: boolean): void {
    const fps = store.project.fps;
    for (const c of store.project.clips) {
      if (c.kind !== 'video' && c.kind !== 'audio') continue;
      const el = c.kind === 'video' ? this.videoFor(c) : this.audioFor(c);
      if (!el) continue;
      if (!isActive(c, t)) {
        if (!el.paused) el.pause();
        if (playing && c.start > t && c.start - t < 1.5 && Math.abs(el.currentTime - c.offset) > 0.2) el.currentTime = c.offset;
        continue;
      }
      const speed = speedOf(c);
      const local = this.mediaTime(c, t);
      if (el.playbackRate !== speed) el.playbackRate = speed;
      if (el instanceof HTMLAudioElement) {
        this.route(el, c.trackId);
        el.volume = store.track(c.trackId)?.muted ? 0 : clamp(c.volume * fade(c, t) * roleAt(c, t).mods.audio, 0, 1);
      }
      if (playing) {
        if (Math.abs(el.currentTime - local) > 0.25 * Math.max(1, speed)) el.currentTime = local;
        if (el.paused) void el.play().catch(() => undefined);
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - local) > 0.5 / fps) el.currentTime = local;
      }
    }
  }

  requestRender(): void {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      if (!store.ui.playing) this.render(store.ui.playhead);
    });
  }

  render(t: number): void {
    const gl = this.gl;
    const { width: W, height: H } = this.canvas;
    this.ensureTargets();
    gl.viewport(0, 0, W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[0].fb);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    let cur = 0;
    const tracks = store.project.tracks.filter(tr => tr.kind === 'video' && !tr.hidden).reverse();
    for (const tr of tracks) {
      const layers = store.project.clips
        .filter(c => c.trackId === tr.id && c.kind !== 'audio' && isActive(c, t))
        .map(c => ({ c, ...roleAt(c, t) }))
        .sort((a, b) => a.order - b.order);
      for (const layer of layers) {
        const next = 1 - cur;
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.targets[cur].fb);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.targets[next].fb);
        gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[next].fb);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.targets[cur].tex);
        gl.activeTexture(gl.TEXTURE0);
        if (this.drawClip(layer.c, t, layer.mods)) cur = next;
      }
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.targets[cur].fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.onFrame?.(this.canvas);
  }

  private source(c: Clip): { src: TexImageSource; w: number; h: number; key: string; upload: boolean; el?: HTMLVideoElement | HTMLImageElement } | null {
    const { width: W, height: H } = this.canvas;
    if (c.kind === 'video') {
      const v = this.videoFor(c);
      if (!v) return null;
      if (v.readyState >= 2 && !v.seeking) {
        this.lastSize.set(c.id, [v.videoWidth, v.videoHeight]);
        return { src: v, w: v.videoWidth, h: v.videoHeight, key: c.id, upload: true, el: v };
      }
      const size = this.lastSize.get(c.id);
      return size && this.textures.has(c.id) ? { src: v, w: size[0], h: size[1], key: c.id, upload: false } : null;
    }
    if (c.kind === 'image') {
      const img = this.imageFor(c.mediaId);
      return img?.complete && img.naturalWidth ? { src: img, w: img.naturalWidth, h: img.naturalHeight, key: `img:${c.mediaId}`, upload: false, el: img } : null;
    }
    if (c.kind === 'text') {
      const entry = this.textFor(c);
      const upload = entry.dirty;
      entry.dirty = false;
      return { src: entry.canvas, w: W, h: H, key: c.id, upload };
    }
    return null;
  }

  private personMask(c: Clip, el?: HTMLVideoElement | HTMLImageElement): boolean {
    const ai = aiOf(c);
    if (ai.mode === 'none' || !el) return false;
    const status = segmenterStatus();
    if (status.state !== 'ready') {
      ensureSegmenter(() => {
        const s = segmenterStatus();
        this.onAiStatus?.(s.state, s.error);
        this.requestRender();
      });
      return false;
    }
    const mask = segment(el);
    if (!mask) return this.masks.has(c.id);
    const gl = this.gl;
    let tex = this.masks.get(c.id);
    if (!tex) {
      tex = gl.createTexture() as WebGLTexture;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.masks.set(c.id, tex);
    }
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, mask.width, mask.height, 0, gl.RED, gl.UNSIGNED_BYTE, mask.data);
    gl.activeTexture(gl.TEXTURE0);
    return true;
  }

  private newTexture(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private cutoutMask(c: Clip, t: number): { mode: number; plate: boolean; texel: [number, number] } {
    const cut = cutoutOf(c);
    const none = { mode: 0, plate: false, texel: [0, 0] as [number, number] };
    if (cut.mode === 'off' || !cut.maskId) return none;
    const set = maskSet(cut.maskId);
    if (!set) return none;
    const gl = this.gl;
    let entry = this.cutTex.get(c.id);
    const m = maskAt(set, this.mediaTime(c, t), cut.mode === 'erase' ? Math.min(1, cut.expand + 0.35) : cut.expand, cut.feather, entry?.key ?? '');
    if (!m) return none;
    if (!entry) {
      entry = { tex: this.newTexture(), key: '' };
      this.cutTex.set(c.id, entry);
    }
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, entry.tex);
    if (m.data) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, set.width, set.height, 0, gl.RED, gl.UNSIGNED_BYTE, m.data);
      entry.key = m.key;
    }
    let plate = false;
    if (cut.mode === 'erase' && cut.plate && set.plate) {
      let tex = this.plates.get(set.id);
      gl.activeTexture(gl.TEXTURE4);
      if (!tex) {
        tex = this.newTexture();
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, set.width, set.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, set.plate);
        this.plates.set(set.id, tex);
      }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      plate = true;
    }
    gl.activeTexture(gl.TEXTURE0);
    return { mode: cut.mode === 'keep' ? 1 : 2, plate, texel: [1 / set.width, 1 / set.height] };
  }

  clipUv(c: Clip, t: number, u: number, v: number): { x: number; y: number } | null {
    const m = store.media(c.mediaId);
    const sw = m?.width || this.lastSize.get(c.id)?.[0] || 0;
    const sh = m?.height || this.lastSize.get(c.id)?.[1] || 0;
    if (!sw || !sh) return null;
    const { width: W, height: H } = this.canvas;
    const frameAspect = W / H;
    const aspect = sw / sh;
    const local = t - c.start;
    const pose = poseAt(c, t);
    const scale = valueAt(c, 'scale', local) * pose.scale;
    const hw = (aspect > frameAspect ? 1 : aspect / frameAspect) * scale;
    const hh = (aspect > frameAspect ? frameAspect / aspect : 1) * scale;
    const rot = -(valueAt(c, 'rotation', local) * Math.PI) / 180 - pose.rot;
    let px = u * 2 - 1 - (valueAt(c, 'x', local) + pose.dx);
    let py = 1 - v * 2 - (valueAt(c, 'y', local) + pose.dy);
    px *= frameAspect;
    const cs = Math.cos(-rot);
    const sn = Math.sin(-rot);
    [px, py] = [cs * px - sn * py, sn * px + cs * py];
    px /= frameAspect;
    let x = (px / hw + 1) / 2;
    let y = (1 - py / hh) / 2;
    const crop = cropOf(c);
    if (x < crop.l || x > 1 - crop.r || y < crop.t || y > 1 - crop.b) return null;
    if (c.flipH) x = 1 - x;
    if (c.flipV) y = 1 - y;
    return { x, y };
  }

  private drawClip(c: Clip, t: number, mods: TransitionMods): boolean {
    const gl = this.gl;
    const { width: W, height: H } = this.canvas;
    const s = this.source(c);
    if (!s || !s.w || !s.h) return false;
    let tex = this.textures.get(s.key);
    let upload = s.upload;
    if (!tex) {
      tex = gl.createTexture() as WebGLTexture;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.textures.set(s.key, tex);
      upload = true;
    }
    const hasMask = this.personMask(c, s.el);
    const cut = this.cutoutMask(c, t);
    if (hasMask) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.masks.get(c.id) ?? null);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (upload) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, s.src);

    const local = t - c.start;
    const key = (p: Parameters<typeof valueAt>[1]): number => valueAt(c, p, local);
    const frameAspect = W / H;
    const aspect = s.w / s.h;
    const hw = aspect > frameAspect ? 1 : aspect / frameAspect;
    const hh = aspect > frameAspect ? frameAspect / aspect : 1;
    const g = c.grade;
    const v = gradeVectors(g);
    const pose = poseAt(c, t);
    const crop = cropOf(c);
    const fx = fxOf(c);
    const sec = secondaryOf(c);
    const ai = aiOf(c);
    const scale = key('scale') * pose.scale * mods.scale;
    const u = this.u;
    gl.uniform4f(u.uRect, key('x') + pose.dx + mods.dx, key('y') + pose.dy + mods.dy, hw * scale, hh * scale);
    gl.uniform4f(u.uCrop, crop.l, crop.r, crop.t, crop.b);
    gl.uniform2f(u.uFlip, c.flipH ? -1 : 1, c.flipV ? -1 : 1);
    gl.uniform1f(u.uAspect, frameAspect);
    gl.uniform1f(u.uRot, -(key('rotation') * Math.PI) / 180 - pose.rot - mods.rot);
    gl.uniform1i(u.uLook, lookIndex(fx.look));
    gl.uniform1f(u.uLookAmt, fx.amount);
    gl.uniform1f(u.uVignette, fx.vignette);
    gl.uniform1f(u.uGrain, fx.grain);
    gl.uniform1f(u.uBlur, clamp(fx.blur + pose.blur + mods.blur, 0, 2));
    gl.uniform1f(u.uSharpen, fx.sharpen);
    gl.uniform1f(u.uLens, fx.lens ?? 0);
    gl.uniform1f(u.uDenoise, fx.denoise ?? 0);
    gl.uniform1f(u.uFlare, fx.flare ?? 0);
    gl.uniform2f(u.uFlarePos, fx.flareX ?? 0.25, 1 - (fx.flareY ?? 0.25));
    gl.uniform1f(u.uTime, (t * 37.0) % 1000);
    gl.uniform2f(u.uTexel, 1 / s.w, 1 / s.h);
    gl.uniform1f(u.uOpacity, clamp(key('opacity') * fade(c, t) * pose.opacity * mods.opacity, 0, 1));
    gl.uniform1f(u.uExposure, key('exposure'));
    gl.uniform1f(u.uContrast, key('contrast'));
    gl.uniform1f(u.uSat, key('saturation'));
    gl.uniform1f(u.uTemp, key('temperature'));
    gl.uniform1f(u.uTint, key('tint'));
    gl.uniform1f(u.uShadows, g.shadows ?? 0);
    gl.uniform1f(u.uHighlights, g.highlights ?? 0);
    gl.uniform3fv(u.uLift, v.lift);
    gl.uniform3fv(u.uGamma, v.gamma);
    gl.uniform3fv(u.uGain, v.gain);
    gl.uniform3fv(u.uOffset, v.offset);
    gl.uniform1i(u.uBlend, blendIndex(c.blend));
    gl.uniform1i(u.uWipe, mods.wipe[0]);
    gl.uniform1f(u.uWipeP, mods.wipe[1]);
    gl.uniform1i(u.uAi, hasMask ? { none: 0, remove: 1, defocus: 2, mono: 3 }[ai.mode] : 0);
    gl.uniform1f(u.uAiAmt, ai.amount);
    gl.uniform1i(u.uCut, cut.mode);
    gl.uniform1i(u.uCutShow, cut.mode && cutoutOf(c).show ? 1 : 0);
    gl.uniform1i(u.uPlateOn, cut.plate ? 1 : 0);
    gl.uniform2f(u.uCutTexel, cut.texel[0], cut.texel[1]);
    gl.uniform1i(u.uStyle, Math.max(0, STYLES.findIndex(st => st.id === (fx.style ?? 'none'))));
    gl.uniform1f(u.uStyleAmt, fx.styleAmt ?? 1);
    gl.uniform1i(u.uSecOn, sec.enabled ? 1 : 0);
    gl.uniform1i(u.uShowMask, sec.enabled && sec.showMask ? 1 : 0);
    gl.uniform1i(u.uQualOn, sec.qual.on ? 1 : 0);
    gl.uniform4f(u.uQual, sec.qual.hue / 360, sec.qual.hueWidth, sec.qual.soft, 0);
    gl.uniform4f(u.uQualSL, sec.qual.satLow, sec.qual.satHigh, sec.qual.lumLow, sec.qual.lumHigh);
    gl.uniform1i(u.uWinShape, { none: 0, circle: 1, rect: 2, linear: 3 }[sec.win.shape]);
    gl.uniform4f(u.uWin, sec.win.x, sec.win.y, sec.win.w, sec.win.h);
    gl.uniform3f(u.uWinOpt, (sec.win.rot * Math.PI) / 180, sec.win.soft, sec.win.invert ? 1 : 0);
    gl.uniform4f(u.uSec, sec.exposure, sec.saturation, (sec.hue * Math.PI) / 180, sec.temperature);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }

  play(): void {
    if (store.ui.playing || store.duration() <= 0) return;
    this.ensureAudio();
    if (store.ui.playhead >= store.duration() - 1e-3) store.ui.playhead = 0;
    store.ui.playing = true;
    this.clockT = store.ui.playhead;
    this.clockStart = performance.now();
    store.emit('ui');
    this.loop();
  }

  pause(): void {
    if (!store.ui.playing) return;
    store.ui.playing = false;
    cancelAnimationFrame(this.raf);
    this.videos.forEach(v => v.pause());
    this.audios.forEach(a => a.pause());
    store.emit('ui');
    this.sync(store.ui.playhead, false);
    this.requestRender();
    this.exportDone?.();
  }

  toggle(): void {
    if (store.ui.playing) this.pause();
    else this.play();
  }

  private loop = (): void => {
    const end = store.duration();
    const t = Math.min(end, this.clockT + (performance.now() - this.clockStart) / 1000);
    store.ui.playhead = t;
    store.emit('playhead');
    if (t >= end) {
      this.pause();
      return;
    }
    this.sync(t, true);
    this.render(t);
    this.raf = requestAnimationFrame(this.loop);
  };

  private ensureAudio(): void {
    if (!this.audioCtx) {
      const ctx = new AudioContext();
      this.audioCtx = ctx;
      this.master = ctx.createGain();
      this.masterMeter = ctx.createAnalyser();
      this.masterMeter.fftSize = 1024;
      this.speakers = ctx.createGain();
      this.recordDest = ctx.createMediaStreamDestination();
      this.master.connect(this.masterMeter);
      this.master.connect(this.speakers).connect(ctx.destination);
      this.master.connect(this.recordDest);
      this.applyMix();
    }
    if (this.audioCtx.state === 'suspended') void this.audioCtx.resume();
  }

  private bus(trackId: string): Bus | null {
    const ctx = this.audioCtx;
    if (!ctx || !this.master) return null;
    let b = this.buses.get(trackId);
    if (!b) {
      const input = ctx.createGain();
      const low = ctx.createBiquadFilter();
      low.type = 'lowshelf';
      low.frequency.value = 150;
      const mid = ctx.createBiquadFilter();
      mid.type = 'peaking';
      mid.frequency.value = 1200;
      mid.Q.value = 0.9;
      const high = ctx.createBiquadFilter();
      high.type = 'highshelf';
      high.frequency.value = 6000;
      const pan = ctx.createStereoPanner();
      const meter = ctx.createAnalyser();
      meter.fftSize = 1024;
      input.connect(low).connect(mid).connect(high).connect(pan).connect(meter);
      pan.connect(this.master);
      b = { input, low, mid, high, pan, meter };
      this.buses.set(trackId, b);
      this.applyMix();
    }
    return b;
  }

  private route(el: HTMLMediaElement, trackId: string): void {
    const ctx = this.audioCtx;
    if (!ctx) return;
    const b = this.bus(trackId);
    if (!b) return;
    let s = this.sources.get(el);
    if (!s) {
      s = { node: ctx.createMediaElementSource(el), bus: '' };
      this.sources.set(el, s);
    }
    if (s.bus !== trackId) {
      s.node.disconnect();
      s.node.connect(b.input);
      s.bus = trackId;
    }
  }

  applyMix(): void {
    const ctx = this.audioCtx;
    if (!ctx) return;
    const tracks = store.project.tracks.filter(t => t.kind === 'audio');
    const anySolo = tracks.some(t => mixOf(t).solo);
    for (const track of tracks) {
      const b = this.buses.get(track.id);
      if (!b) continue;
      const m = mixOf(track);
      const silent = track.muted || (anySolo && !m.solo);
      b.input.gain.setTargetAtTime(silent ? 0 : Math.pow(10, m.volume / 20), ctx.currentTime, 0.015);
      b.pan.pan.setTargetAtTime(m.pan, ctx.currentTime, 0.015);
      b.low.gain.setTargetAtTime(m.low, ctx.currentTime, 0.015);
      b.mid.gain.setTargetAtTime(m.mid, ctx.currentTime, 0.015);
      b.high.gain.setTargetAtTime(m.high, ctx.currentTime, 0.015);
    }
    const master = store.project.masterVolume ?? 0;
    this.master?.gain.setTargetAtTime(Math.pow(10, master / 20), ctx.currentTime, 0.015);
  }

  private peak(an: AnalyserNode): number {
    an.getFloatTimeDomainData(this.meterBuf);
    let p = 0;
    for (let i = 0; i < this.meterBuf.length; i++) p = Math.max(p, Math.abs(this.meterBuf[i]));
    return p > 0 ? 20 * Math.log10(p) : -Infinity;
  }

  levels(): Record<string, number> {
    const out: Record<string, number> = {};
    if (!this.audioCtx) return out;
    this.buses.forEach((b, id) => (out[id] = this.peak(b.meter)));
    if (this.masterMeter) out.master = this.peak(this.masterMeter);
    return out;
  }

  private waitForFrames(): Promise<void> {
    const t = store.ui.playhead;
    const pending = store.project.clips
      .filter(c => c.kind === 'video' && isActive(c, t))
      .map(c => this.videoFor(c))
      .filter((v): v is HTMLVideoElement => !!v && (v.seeking || v.readyState < 2))
      .map(v => new Promise<void>(r => v.addEventListener('seeked', () => r(), { once: true })));
    return Promise.race([Promise.all(pending).then(() => undefined), new Promise<void>(r => setTimeout(r, 3000))]);
  }

  snapshot(): Promise<Blob> {
    this.render(store.ui.playhead);
    return new Promise((resolve, reject) => this.canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not capture the frame.'))), 'image/png'));
  }

  async exportVideo(opts: ExportOptions): Promise<Blob> {
    const duration = store.duration();
    if (duration <= 0) throw new Error('The timeline is empty. Add some clips first.');
    this.pause();
    this.ensureAudio();
    store.setPlayhead(0);
    this.sync(0, false);
    await this.waitForFrames();
    this.render(0);
    const stream = this.canvas.captureStream(store.project.fps);
    this.recordDest?.stream.getAudioTracks().forEach(track => stream.addTrack(track));
    const recorder = new MediaRecorder(stream, { mimeType: opts.mimeType, videoBitsPerSecond: opts.bitrate, audioBitsPerSecond: 192_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = e => {
      if (e.data.size) chunks.push(e.data);
    };
    const stopped = new Promise<void>(r => (recorder.onstop = () => r()));
    const finished = new Promise<void>(r => (this.exportDone = r));
    const off = store.on(c => {
      if (c === 'playhead') opts.onProgress(store.ui.playhead / duration);
    });
    opts.signal.addEventListener('abort', () => this.pause(), { once: true });
    if (this.speakers) this.speakers.gain.value = 0;
    recorder.start(500);
    this.play();
    await finished;
    this.exportDone = null;
    off();
    recorder.stop();
    await stopped;
    stream.getVideoTracks().forEach(track => track.stop());
    if (this.speakers) this.speakers.gain.value = 1;
    if (opts.signal.aborted) throw new DOMException('Render cancelled', 'AbortError');
    return new Blob(chunks, { type: opts.mimeType.split(';')[0] });
  }
}
