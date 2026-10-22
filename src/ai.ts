const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const SEGMENT_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
const OBJECT_MODEL = 'https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite';
const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';

interface ConfidenceMask {
  width: number;
  height: number;
  getAsFloat32Array(): Float32Array;
}

interface Segmenter {
  segmentForVideo(src: TexImageSource, ts: number, cb: (r: { confidenceMasks?: ConfidenceMask[] }) => void): void;
}

export interface Mask {
  data: Uint8Array;
  width: number;
  height: number;
}

export type ModelState = 'idle' | 'loading' | 'ready' | 'error';

let segmenter: Segmenter | null = null;
let segmenterLoading: Promise<void> | null = null;
let segmenterState: ModelState = 'idle';
let segmenterError = '';
let lastTs = 0;

export const segmenterStatus = (): { state: ModelState; error: string } => ({ state: segmenterState, error: segmenterError });

export function ensureSegmenter(onChange: () => void): void {
  if (segmenter || segmenterLoading) return;
  segmenterState = 'loading';
  onChange();
  segmenterLoading = (async () => {
    try {
      const vision = await import(/* @vite-ignore */ `${VISION}/vision_bundle.mjs`);
      const files = await vision.FilesetResolver.forVisionTasks(`${VISION}/wasm`);
      segmenter = (await vision.ImageSegmenter.createFromOptions(files, {
        baseOptions: { modelAssetPath: SEGMENT_MODEL, delegate: 'CPU' },
        runningMode: 'VIDEO',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      })) as Segmenter;
      segmenterState = 'ready';
    } catch (e) {
      segmenterState = 'error';
      segmenterError = (e as Error).message || 'Could not load the AI model. Check your internet connection.';
      segmenterLoading = null;
    }
    onChange();
  })();
}

export function segment(src: HTMLVideoElement | HTMLImageElement): Mask | null {
  if (!segmenter) return null;
  lastTs = Math.max(lastTs + 1, Math.round(performance.now()));
  let mask: Mask | null = null;
  try {
    segmenter.segmentForVideo(src, lastTs, r => {
      const m = r.confidenceMasks?.[0];
      if (!m) return;
      const f = m.getAsFloat32Array();
      const data = new Uint8Array(f.length);
      for (let i = 0; i < f.length; i++) data[i] = Math.min(255, Math.max(0, f[i] * 255));
      mask = { data, width: m.width, height: m.height };
    });
  } catch {
    return null;
  }
  return mask;
}

interface PointSegmenter {
  segment(src: TexImageSource, roi: { keypoint: { x: number; y: number } }, cb: (r: { confidenceMasks?: ConfidenceMask[] }) => void): void;
}

let objectModel: Promise<PointSegmenter> | null = null;

export function loadObjectModel(): Promise<PointSegmenter> {
  objectModel ??= (async () => {
    const vision = await import(/* @vite-ignore */ `${VISION}/vision_bundle.mjs`);
    const files = await vision.FilesetResolver.forVisionTasks(`${VISION}/wasm`);
    return (await vision.InteractiveSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: OBJECT_MODEL, delegate: 'CPU' },
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    })) as PointSegmenter;
  })();
  objectModel.catch(() => (objectModel = null));
  return objectModel;
}

export function objectAt(model: PointSegmenter, src: TexImageSource, x: number, y: number): { data: Float32Array; width: number; height: number } | null {
  let out: { data: Float32Array; width: number; height: number } | null = null;
  model.segment(src, { keypoint: { x, y } }, r => {
    const masks = r.confidenceMasks ?? [];
    const m = masks[masks.length - 1];
    if (!m) return;
    const data = m.getAsFloat32Array().slice();
    const at = data[Math.min(m.height - 1, Math.floor(y * m.height)) * m.width + Math.min(m.width - 1, Math.floor(x * m.width))];
    if (at < 0.5 && masks.length === 1) for (let i = 0; i < data.length; i++) data[i] = 1 - data[i];
    out = { data, width: m.width, height: m.height };
  });
  return out;
}

export interface Caption {
  text: string;
  start: number;
  end: number;
}

type Asr = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ chunks?: { text: string; timestamp: [number | null, number | null] }[] }>;
const pipelines = new Map<string, Promise<Asr>>();

async function decode16k(blob: Blob, from: number, to: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, 1, 16000);
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  const a = Math.max(0, Math.floor(from * 16000));
  const b = Math.min(buf.length, Math.ceil(to * 16000));
  const out = new Float32Array(Math.max(0, b - a));
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < out.length; i++) out[i] += data[a + i] / buf.numberOfChannels;
  }
  return out;
}

export async function transcribe(blob: Blob, from: number, to: number, multilingual: boolean, onStatus: (s: string) => void): Promise<Caption[]> {
  const model = multilingual ? 'Xenova/whisper-tiny' : 'Xenova/whisper-tiny.en';
  let asr = pipelines.get(model);
  if (!asr) {
    onStatus('Loading the speech model…');
    asr = (async () => {
      const tf = await import(/* @vite-ignore */ TRANSFORMERS);
      return tf.pipeline('automatic-speech-recognition', model, {
        progress_callback: (p: { status: string; progress?: number; file?: string }) => {
          if (p.status === 'progress' && p.progress !== undefined) onStatus(`Downloading the speech model… ${Math.round(p.progress)}%`);
        },
      }) as Promise<Asr>;
    })();
    pipelines.set(model, asr);
    asr.catch(() => pipelines.delete(model));
  }
  const run = await asr;
  onStatus('Preparing the audio…');
  const samples = await decode16k(blob, from, to);
  if (!samples.length) return [];
  onStatus('Transcribing… this can take a while for long clips');
  const result = await run(samples, { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 });
  return (result.chunks ?? [])
    .map(c => {
      const start = c.timestamp[0] ?? 0;
      return { text: c.text.trim(), start, end: c.timestamp[1] ?? start + 2 };
    })
    .filter(c => c.text && c.end > c.start);
}

export function toSrt(captions: Caption[]): string {
  const ts = (t: number): string => {
    const ms = Math.round(t * 1000);
    const p = (n: number, w = 2): string => String(n).padStart(w, '0');
    return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  return captions.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n');
}
