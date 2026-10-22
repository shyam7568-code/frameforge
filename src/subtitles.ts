import { toSrt, transcribe } from './ai';
import { clearRange, makeClip } from './edit';
import { speedOf } from './looks';
import { store } from './state';
import type { Track } from './types';
import { downloadBlob, uid } from './util';

const TRACK_NAME = 'Subtitles';

function subtitleTrack(create: boolean): Track | undefined {
  let track = store.project.tracks.find(t => t.kind === 'video' && t.name === TRACK_NAME);
  if (!track && create) {
    track = { id: `ST-${uid().slice(0, 5)}`, kind: 'video', name: TRACK_NAME, muted: false, hidden: false, locked: false };
    store.project.tracks.unshift(track);
  }
  return track;
}

export async function generateSubtitles(clipId: string, multilingual: boolean, onStatus: (s: string) => void): Promise<number> {
  const clip = store.clip(clipId);
  const blob = clip?.mediaId ? store.runtime.get(clip.mediaId)?.blob : undefined;
  if (!clip || !blob) throw new Error('This clip has no media to transcribe.');
  const speed = speedOf(clip);
  const captions = await transcribe(blob, clip.offset, clip.offset + clip.duration * speed, multilingual, onStatus);
  if (!captions.length) return 0;
  store.checkpoint();
  const track = subtitleTrack(true)!;
  for (const cap of captions) {
    const start = clip.start + cap.start / speed;
    const duration = Math.max(0.3, (cap.end - cap.start) / speed);
    clearRange(track.id, start, start + duration, new Set());
    store.project.clips.push(
      makeClip({
        trackId: track.id,
        kind: 'text',
        name: 'Subtitle',
        start,
        duration,
        y: -0.78,
        text: { content: cap.text, size: 52, color: '#ffffff', bold: false, box: true },
      }),
    );
  }
  store.emit('project');
  return captions.length;
}

export function hasSubtitles(): boolean {
  const track = subtitleTrack(false);
  return !!track && store.project.clips.some(c => c.trackId === track.id);
}

export function exportSrt(): void {
  const track = subtitleTrack(false);
  if (!track) return;
  const captions = store.project.clips
    .filter(c => c.trackId === track.id && c.text)
    .sort((a, b) => a.start - b.start)
    .map(c => ({ text: c.text!.content, start: c.start, end: c.start + c.duration }));
  downloadBlob(new Blob([toSrt(captions)], { type: 'text/plain' }), `${store.project.name || 'subtitles'}.srt`);
}
