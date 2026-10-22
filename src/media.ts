import { putBlob } from './persist';
import { store } from './state';
import type { MediaKind } from './types';
import { clamp, uid } from './util';

interface Analysis {
  duration: number;
  width: number;
  height: number;
  thumb: string;
  peaks: string;
  hasAudio: boolean;
}

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|ogv)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i;
const MAX_DECODE_BYTES = 400 * 1024 * 1024;

export function kindOf(file: File): MediaKind | null {
  if (file.type.startsWith('video/') || VIDEO_EXT.test(file.name)) return 'video';
  if (file.type.startsWith('audio/') || AUDIO_EXT.test(file.name)) return 'audio';
  if (file.type.startsWith('image/') || IMAGE_EXT.test(file.name)) return 'image';
  return null;
}

function once(el: HTMLMediaElement, ok: string): Promise<void> {
  return new Promise((resolve, reject) => {
    el.addEventListener(ok, () => resolve(), { once: true });
    el.addEventListener('error', () => reject(new Error('This file format is not supported by your browser.')), { once: true });
  });
}

function snapshot(src: CanvasImageSource, w: number, h: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 108;
  const ctx = canvas.getContext('2d');
  if (!ctx || !w || !h) return '';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 192, 108);
  const s = Math.min(192 / w, 108 / h);
  ctx.drawImage(src, (192 - w * s) / 2, (108 - h * s) / 2, w * s, h * s);
  return canvas.toDataURL('image/jpeg', 0.75);
}

async function waveform(blob: Blob): Promise<{ peaks: string; hasAudio: boolean }> {
  if (blob.size > MAX_DECODE_BYTES) return { peaks: '', hasAudio: true };
  try {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const width = clamp(Math.round(audio.duration * 40), 200, 4000);
    const height = 64;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d');
    if (!g) return { peaks: '', hasAudio: true };
    const channels = Array.from({ length: Math.min(2, audio.numberOfChannels) }, (_, i) => audio.getChannelData(i));
    const step = Math.max(1, Math.floor(audio.length / width));
    g.fillStyle = '#9fe0bb';
    for (let x = 0; x < width; x++) {
      let peak = 0;
      const from = x * step;
      for (let i = from; i < from + step && i < audio.length; i += 4) {
        for (const ch of channels) peak = Math.max(peak, Math.abs(ch[i]));
      }
      const bar = Math.max(1, peak * (height - 4));
      g.fillRect(x, (height - bar) / 2, 1, bar);
    }
    return { peaks: canvas.toDataURL('image/png'), hasAudio: true };
  } catch {
    return { peaks: '', hasAudio: false };
  }
}

export async function analyze(kind: MediaKind, url: string, blob: Blob): Promise<Analysis> {
  if (kind === 'image') {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { duration: 0, width: img.naturalWidth, height: img.naturalHeight, thumb: snapshot(img, img.naturalWidth, img.naturalHeight), peaks: '', hasAudio: false };
  }
  if (kind === 'audio') {
    const a = document.createElement('audio');
    a.preload = 'metadata';
    a.src = url;
    await once(a, 'loadedmetadata');
    const wave = await waveform(blob);
    return { duration: a.duration, width: 0, height: 0, thumb: '', peaks: wave.peaks, hasAudio: true };
  }
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = url;
  await once(v, 'loadeddata');
  const duration = v.duration;
  const seek = once(v, 'seeked');
  v.currentTime = Math.min(1, duration * 0.1);
  await seek;
  const thumb = snapshot(v, v.videoWidth, v.videoHeight);
  const wave = await waveform(blob);
  const info = { duration, width: v.videoWidth, height: v.videoHeight, thumb, peaks: wave.peaks, hasAudio: wave.hasAudio };
  v.removeAttribute('src');
  v.load();
  return info;
}

export async function importFiles(files: File[]): Promise<string[]> {
  const ids: string[] = [];
  const errors: string[] = [];
  for (const file of files) {
    const kind = kindOf(file);
    if (!kind) {
      errors.push(`${file.name}: not a video, audio or image file`);
      continue;
    }
    const url = URL.createObjectURL(file);
    try {
      const info = await analyze(kind, url, file);
      const offline = store.project.media.find(m => m.name === file.name && m.kind === kind && !store.runtime.has(m.id));
      const id = offline?.id ?? uid();
      const meta = { id, name: file.name, kind, duration: info.duration, width: info.width, height: info.height, hasAudio: info.hasAudio, size: file.size };
      if (offline) Object.assign(offline, meta);
      else store.project.media.push(meta);
      store.runtime.set(id, { url, thumb: info.thumb, peaks: info.peaks, blob: file });
      ids.push(id);
      putBlob(id, file).catch(() => undefined);
      store.emit('media');
      store.emit('project');
    } catch (e) {
      URL.revokeObjectURL(url);
      errors.push(`${file.name}: ${(e as Error).message}`);
    }
  }
  if (errors.length) alert(`Some files could not be imported:\n\n${errors.join('\n')}`);
  return ids;
}
